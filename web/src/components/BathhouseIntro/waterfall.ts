import { STREAM_LEFT, STREAM_RIGHT, STREAM_Y0, STREAM_Y1 } from './streamEdges'

/**
 * 오른쪽 출수구 물줄기만 움직이는 Canvas 렌더러. 좌표는 모두 원본 일러스트(1536×1024) 기준이다.
 *
 * - 물줄기 안쪽: 원본 물줄기를 곡선을 따라 펴 둔 띠(stream-strip.png)를 위에서 아래로 흘려 보낸다.
 *   곡선 바깥 윤곽(STREAM_LEFT/RIGHT)은 고정이고, 가장자리만 작게 흔들리며 아래로 갈수록 조금 퍼진다.
 *   줄마다 흐르는 속도가 다르고, 두 장을 반 주기 어긋나게 섞어서(flow map) 이음매 없이 반복된다.
 * - 그 위에 밝은 선·물방울이 굵기·길이·속도를 달리해 곡선을 따라 흐른다.
 * - 물이 닿는 곳: 튀는 물방울, 생겼다 사라지는 포말, 수면에 납작하게 퍼지는 파문.
 * 모든 주기는 12초의 약수라서 12초마다 처음과 똑같아진다.
 */

export const LOOP_SECONDS = 12
export const CANVAS_BOX = { x: 1230, y: 484, w: 306, h: 276 } // 캔버스가 덮는 원본 좌표 영역

const TAU = Math.PI * 2
const H = STREAM_Y1 - STREAM_Y0
const SS = 2 // 물줄기 안쪽을 그리는 해상도 배율(원본 1px당 2칸)
const BOX = { x: 1360, y: STREAM_Y0 - 2, w: 136, h: H + 6 } // 물줄기 안쪽을 계산하는 영역
const FLOW_CYCLE = 2 // 흐름 한 주기(초). 12초의 약수
const FLOW_DIST = 110 // 한 주기에 질감이 내려가는 거리(원본 px)
const SPLASH = { x: 1412, y: 668 } // 물줄기가 거품에 닿는 곳
const WATER = { x: 1415, y: 700 } // 파문이 퍼지는 중심

const COLOR = {
  cream: '#fcf2e3',
  creamShade: '#e3d2c2',
  blueShade: '#b7cfda',
  spray: '#eef8fc',
  streakWarm: '255, 247, 232',
  streakCool: '226, 243, 251',
  ripple: '238, 252, 255',
}

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v)
const smooth = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}
const frac = (v: number) => v - Math.floor(v)
const easeOut = (p: number) => 1 - Math.pow(1 - p, 3)

function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// 물줄기 맨 위(출수구 안쪽의 어두운 부분)와 맨 아래(거품에 가려진 부분)는 흘려 보내지 않고, 그 사이 구간을 접어서(거울처럼 되돌려서) 쓴다.
const FOLD_A = STREAM_Y0 + 10
const FOLD_B = STREAM_Y1 - 8
const fold = (v: number) => {
  const len = FOLD_B - FOLD_A
  let m = (v - FOLD_A) % (2 * len)
  if (m < 0) m += 2 * len
  if (m > len) m = 2 * len - m
  return FOLD_A + m
}

const baseEdge = (arr: number[], y: number) => {
  const k = clamp(y - STREAM_Y0, 0, H)
  const i = Math.min(Math.floor(k), H - 1)
  const f = k - i
  return arr[i] * (1 - f) + arr[i + 1] * f
}

/** 높이 y에서 물줄기의 왼쪽·오른쪽 가장자리. 고정 윤곽 + 작은 흔들림 + 아래로 갈수록 퍼짐 */
function edgesAt(y: number, tau: number): [number, number] {
  const f = clamp((y - STREAM_Y0) / H, 0, 1)
  const l0 = baseEdge(STREAM_LEFT, y)
  const r0 = baseEdge(STREAM_RIGHT, y)
  const c = (l0 + r0) / 2
  const w = r0 - l0
  const g = 1 + 0.14 * Math.pow(f, 1.3)
  const amp = 0.35 + 0.65 * f
  const dl = amp * 0.9 * (Math.sin(TAU * (y * 0.055 + 2 * tau)) + 0.5 * Math.sin(TAU * (y * 0.13 - 3 * tau + 0.27)))
  const dr = amp * 0.7 * (Math.sin(TAU * (y * 0.047 - 2 * tau + 0.4)) + 0.5 * Math.sin(TAU * (y * 0.11 + 4 * tau + 0.6)))
  const sway = -0.8 * f
  return [c - (w * g) / 2 + dl + sway, c + (w * g) / 2 + dr + sway]
}

/** 줄(가로 위치 u)마다 다른 속도 배율 */
const lane = (u: number) => 1 + 0.24 * Math.sin(TAU * (1.1 * u + 0.15)) + 0.12 * Math.sin(TAU * (2.1 * u + 0.6))

type Streak = { u: number; len: number; width: number; period: number; phase: number; warm: boolean; alpha: number }
type Drop = { u: number; r: number; period: number; phase: number; alpha: number }
type Blob = { x: number; y: number; r: number; period: number; phase: number; parts: [number, number, number][] }
type Spark = { x: number; vx: number; vy: number; r: number; period: number; phase: number; cool: boolean }

export type Waterfall = {
  draw: (ctx: CanvasRenderingContext2D, t: number, k: number) => void
}

/** strip: stream-strip.png를 읽은 픽셀(폭 w, 높이 h) */
export function createWaterfall(strip: ImageData): Waterfall {
  const { data: tex, width: TW, height: TH } = strip

  // --- 물줄기 안쪽 픽셀 ---
  const pw = BOX.w * SS
  const ph = BOX.h * SS
  const off = document.createElement('canvas')
  off.width = pw
  off.height = ph
  const octx = off.getContext('2d')!
  const img = octx.createImageData(pw, ph)
  const px = img.data

  const sample = (u: number, v: number, out: number[]) => {
    const x = clamp(u, 0, 1) * (TW - 1.001)
    const y = clamp((fold(v) - STREAM_Y0) * 2, 0, TH - 1.001)
    const xi = x | 0
    const yi = y | 0
    const fx = x - xi
    const fy = y - yi
    const a = (yi * TW + xi) * 4
    const b = a + 4
    const c = a + TW * 4
    const d = c + 4
    for (let k = 0; k < 3; k++) {
      out[k] = (tex[a + k] * (1 - fx) + tex[b + k] * fx) * (1 - fy) + (tex[c + k] * (1 - fx) + tex[d + k] * fx) * fy
    }
  }
  const s0 = [0, 0, 0]
  const s1 = [0, 0, 0]

  function paintStream(tau: number, t: number) {
    const p0 = frac(t / FLOW_CYCLE)
    const p1 = frac(p0 + 0.5)
    const w0 = 1 - Math.abs(2 * p0 - 1)
    for (let j = 0; j < ph; j++) {
      const y = BOX.y + (j + 0.5) / SS
      const row = j * pw * 4
      if (y < STREAM_Y0 || y > STREAM_Y1) {
        for (let i = 0; i < pw; i++) px[row + i * 4 + 3] = 0
        continue
      }
      const [l, r] = edgesAt(y, tau)
      const wid = r - l
      const bottom = 1 - smooth(STREAM_Y1 - 26, STREAM_Y1, y)
      const top = smooth(STREAM_Y0, STREAM_Y0 + 2.5, y)
      for (let i = 0; i < pw; i++) {
        const o = row + i * 4
        const x = BOX.x + (i + 0.5) / SS
        if (x < l - 1.2 || x > r + 1.2) {
          px[o + 3] = 0
          continue
        }
        const cov = clamp((x - l) / 0.9 + 0.5, 0, 1) * clamp((r - x) / 0.9 + 0.5, 0, 1)
        const u = clamp((x - l) / wid, 0, 1)
        const s = lane(u)
        const wob = 2.4 * Math.sin(TAU * (u * 3.1 + y * 0.02 + 2 * tau))
        sample(u, y - FLOW_DIST * s * p0 + wob, s0)
        sample(u, y - FLOW_DIST * s * p1 + wob, s1)
        px[o] = s0[0] * w0 + s1[0] * (1 - w0)
        px[o + 1] = s0[1] * w0 + s1[1] * (1 - w0)
        px[o + 2] = s0[2] * w0 + s1[2] * (1 - w0)
        px[o + 3] = 255 * cov * bottom * top
      }
    }
    octx.putImageData(img, 0, 0)
  }

  // --- 밝은 선 / 물방울 / 포말 / 튀는 방울 (모두 고정 씨앗 → 매번 같은 모양) ---
  const R1 = rng(20261028)
  const periods = [2, 2.4, 3, 4]
  const streaks: Streak[] = Array.from({ length: 15 }, () => ({
    u: 0.06 + R1() * 0.88,
    len: 12 + R1() * 40,
    width: 0.45 + R1() * R1() * 1.7, // 얇은 선이 많고 굵은 선은 드물다
    period: periods[Math.floor(R1() * periods.length)],
    phase: R1(),
    warm: R1() > 0.45,
    alpha: 0.45 + R1() * 0.4,
  }))
  const drops: Drop[] = Array.from({ length: 16 }, () => ({
    u: -0.08 + R1() * 1.16,
    r: 0.7 + R1() * 1.1,
    period: periods[Math.floor(R1() * periods.length)],
    phase: R1(),
    alpha: 0.6 + R1() * 0.35,
  }))
  const blobPeriods = [3, 4, 6]
  const blobs: Blob[] = Array.from({ length: 16 }, () => {
    const a = R1() * TAU
    const rr = Math.sqrt(R1())
    const r = 2.4 + R1() * 3.6
    return {
      x: SPLASH.x + Math.cos(a) * rr * 66,
      y: SPLASH.y + 14 + Math.sin(a) * rr * 12,
      r,
      period: blobPeriods[Math.floor(R1() * blobPeriods.length)],
      phase: R1(),
      parts: [
        [0, 0, 1],
        [r * (0.8 + R1() * 0.5), r * 0.2, 0.68],
        [-r * (0.7 + R1() * 0.5), r * 0.25, 0.6],
        [r * (R1() - 0.3), -r * (0.5 + R1() * 0.3), 0.55],
      ],
    }
  })
  const sparks: Spark[] = Array.from({ length: 24 }, () => ({
    x: SPLASH.x + (R1() - 0.5) * 34,
    vx: (R1() - 0.5) * 150,
    vy: -(40 + R1() * 80),
    r: 0.7 + R1() * 1.3,
    period: [2, 3, 4][Math.floor(R1() * 3)],
    phase: R1(),
    cool: R1() > 0.6,
  }))

  function drawRipples(ctx: CanvasRenderingContext2D, t: number) {
    for (let n = 0; n < 3; n++) {
      const p = frac(t / 4 + n / 3)
      const e = easeOut(p)
      const rx = 30 + 125 * e
      const a = 0.5 * Math.pow(1 - p, 1.3) * smooth(0, 0.12, p)
      if (a < 0.01) continue
      for (const [scale, wScale, aScale] of [
        [1, 1, 1],
        [0.78, 0.6, 0.6],
      ] as const) {
        ctx.beginPath()
        ctx.ellipse(WATER.x, WATER.y, rx * scale, rx * scale * 0.2, 0, -0.1 * Math.PI, 1.1 * Math.PI)
        ctx.lineWidth = (1.7 - 0.9 * p) * wScale
        ctx.strokeStyle = `rgba(${COLOR.ripple}, ${a * aScale})`
        ctx.stroke()
      }
    }
  }

  function drawStreaks(ctx: CanvasRenderingContext2D, tau: number, t: number) {
    ctx.lineCap = 'round'
    for (const s of streaks) {
      const p = frac(t / s.period + s.phase)
      const head = STREAM_Y0 - s.len * 0.3 + (H + s.len * 0.3) * Math.pow(p, 1.18)
      const tail = head - s.len
      const steps = Math.max(3, Math.ceil(s.len / 4))
      let prev: [number, number] | null = null
      for (let i = 0; i <= steps; i++) {
        const y = tail + (s.len * i) / steps
        if (y < STREAM_Y0 || y > STREAM_Y1) {
          prev = null
          continue
        }
        const [l, r] = edgesAt(y, tau)
        const x = l + (r - l) * (s.u + 0.02 * Math.sin(TAU * (y * 0.04 + tau * 3)))
        if (prev) {
          const k = i / steps // 꼬리는 옅고 머리는 진하게
          const fade = 1 - smooth(STREAM_Y1 - 26, STREAM_Y1, y)
          ctx.beginPath()
          ctx.moveTo(prev[0], prev[1])
          ctx.lineTo(x, y)
          ctx.lineWidth = s.width * (0.5 + 0.5 * k)
          ctx.strokeStyle = `rgba(${s.warm ? COLOR.streakWarm : COLOR.streakCool}, ${s.alpha * k * fade})`
          ctx.stroke()
        }
        prev = [x, y]
      }
    }
  }

  function drawDrops(ctx: CanvasRenderingContext2D, tau: number, t: number) {
    for (const d of drops) {
      const p = frac(t / d.period + d.phase)
      const y = STREAM_Y0 + (H + 22) * Math.pow(p, 1.4)
      if (y > STREAM_Y1 + 18) continue
      const [l, r] = edgesAt(Math.min(y, STREAM_Y1), tau)
      const spread = 1 + 0.3 * p // 아래로 갈수록 가장자리 바깥으로 벌어진다
      const x = l + (r - l) * (0.5 + (d.u - 0.5) * spread)
      const a = d.alpha * (1 - smooth(STREAM_Y1 - 10, STREAM_Y1 + 18, y))
      ctx.fillStyle = `rgba(167, 196, 214, ${a * 0.7})`
      ctx.beginPath()
      ctx.arc(x + 0.3, y + 0.5, d.r, 0, TAU)
      ctx.fill()
      ctx.fillStyle = `rgba(250, 252, 252, ${a})`
      ctx.beginPath()
      ctx.arc(x, y, d.r * 0.85, 0, TAU)
      ctx.fill()
    }
  }

  function drawFoam(ctx: CanvasRenderingContext2D, t: number) {
    for (const b of blobs) {
      const p = frac(t / b.period + b.phase)
      const grow = easeOut(Math.min(p / 0.3, 1))
      const a = (p < 0.3 ? 1 : 1 - Math.pow((p - 0.3) / 0.7, 1.4)) * 0.82
      if (a < 0.02) continue
      for (const layer of [0, 1, 2] as const) {
        ctx.fillStyle = layer === 0 ? COLOR.blueShade : layer === 1 ? COLOR.creamShade : COLOR.cream
        ctx.globalAlpha = a * (layer === 0 ? 0.55 : 1)
        const dy = layer === 0 ? 1.8 : layer === 1 ? 1 : 0
        for (const [dx, oy, sc] of b.parts) {
          ctx.beginPath()
          ctx.arc(b.x + dx * grow, b.y + oy + dy, b.r * sc * grow * (layer === 0 ? 1.08 : 1), 0, TAU)
          ctx.fill()
        }
      }
      ctx.globalAlpha = 1
    }
  }

  function drawSparks(ctx: CanvasRenderingContext2D, t: number) {
    const g = 280
    for (const s of sparks) {
      const p = frac(t / s.period + s.phase)
      const life = 0.85 // 초. 위로 튀어 올랐다가 떨어진다
      const tt = p * s.period
      if (tt > life) continue
      const x = s.x + s.vx * tt
      const y = SPLASH.y + s.vy * tt + 0.5 * g * tt * tt
      if (y > WATER.y - 2) continue
      const a = 1 - smooth(life * 0.55, life, tt)
      ctx.fillStyle = s.cool ? `rgba(196, 226, 240, ${a})` : `rgba(252, 246, 236, ${a})`
      ctx.beginPath()
      ctx.arc(x, y, s.r, 0, TAU)
      ctx.fill()
    }
  }

  return {
    draw(ctx, t, k) {
      const time = t % LOOP_SECONDS
      const tau = time / LOOP_SECONDS
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
      ctx.setTransform(k, 0, 0, k, -CANVAS_BOX.x * k, -CANVAS_BOX.y * k)
      drawRipples(ctx, time)
      paintStream(tau, time)
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(off, BOX.x, BOX.y, BOX.w, BOX.h)
      drawStreaks(ctx, tau, time)
      drawDrops(ctx, tau, time)
      drawFoam(ctx, time)
      drawSparks(ctx, time)
    },
  }
}
