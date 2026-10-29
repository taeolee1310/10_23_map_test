import { useEffect, useRef, type CSSProperties } from 'react'
import sheetUrl from '../../assets/bathhouse/duck-float-sheet.png'
import sheet from '../../assets/bathhouse/duck-float-sheet.json'

/**
 * 욕탕 수면 위를 천천히 떠다니는 오리. 누르면 효과음이 난다(위에 작은 안내). 스프라이트 시트의 프레임은 JSON의 실제 영역으로 오려 쓰고,
 * 모든 프레임을 같은 가로 크기·아래 가운데 기준점에 맞춘다. 프레임 바꾸기(눈 깜빡임)와 화면 이동·떠오름은 따로 움직인다.
 * 기본 그림은 왼쪽을 본다. 오른쪽으로 갈 때만 오리를 좌우로 뒤집는다.
 *
 * 위치는 인트로 무대(1536×1024) 좌표다. 무대가 cover로 깔리고 잘리는 만큼 화면에 보이는 범위를 계산해서 그 안으로 맞춘다.
 */
const frame = (name: string) => sheet.frames.find((f) => f.name === name)!
const BASE = frame('float-01') // 가장 안정적인 기본 프레임(눈 뜬 모습)을 계속 보여 준다
const BLINK = frame('float-03') // 눈 감은 프레임: 4~7초마다 아주 잠깐만

// 욕탕 수면 모양(무대 1536×1024 좌표). Figma mask-water.svg(1291×422)가 무대의 (245, 602)에 놓여 있다.
const WATER: [number, number][] = [[9, 148], [553, 5], [572, 0], [1161, 17], [1239, 87], [1291, 87], [1291, 422], [675, 422], [0, 208]].map(([x, y]) => [x + 245, y + 602])
const inWater = (x: number, y: number) => {
  let c = false
  for (let i = 0, j = WATER.length - 1; i < WATER.length; j = i++) {
    const [xi, yi] = WATER[i]
    const [xj, yj] = WATER[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c
  }
  return c
}
const PREFER_Y = 830 // 수면 안에서 이 높이(무대 좌표) 근처를 먼저 찾는다
const MIN_TRAVEL = 40 // 이보다 짧으면 이동하지 않고 제자리에서 떠 있는다
const MOVE_S = 11 // 한쪽 끝에서 반대쪽 끝까지 가는 데 걸리는 시간
const HOLD_S = 2 // 방향을 바꾸기 전에 머무는 시간 (한 번 왕복 = 26초)
const CYCLE_S = (MOVE_S + HOLD_S) * 2
const BOB_PX = 2 // 위아래 떠오름
const TILT_DEG = 1 // 아주 작은 기울기
const BLINK_S = 0.16
const WAKE_EVERY_S = 0.9 // 움직이는 동안 이 간격으로 물결을 하나씩 남긴다
const WAKE_LIFE_MS = 3400 // 남은 물결이 퍼지며 사라지는 시간
const MAX_WAKES = 6

const smooth = (t: number) => t * t * (3 - 2 * t)
const rand = (a: number, b: number) => a + Math.random() * (b - a)

const frameVars = (f: typeof BASE) =>
  ({ '--fx': f.frame.x, '--fy': f.frame.y, '--fw': f.frame.w, '--fh': f.frame.h }) as CSSProperties

type DuckProps = {
  /** 오리를 눌렀을 때(효과음을 낸다) */
  onPress: () => void
  /** 오리 위의 작은 안내를 보여 줄지 */
  hint: boolean
}

export default function Duck({ onPress, hint }: DuckProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const rigRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const blinkRef = useRef<HTMLSpanElement>(null)
  const wakeRef = useRef<HTMLDivElement>(null)
  const hintRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const root = rootRef.current
    const rig = rigRef.current
    const body = bodyRef.current
    const blink = blinkRef.current
    const wake = wakeRef.current
    const tip = hintRef.current
    if (!root || !rig || !body || !blink || !wake) return

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let path = { x0: 0, x1: 0, ay: 0, u: 1, left: 0, vw: 0 }
    let tipHalf = 0 // 안내 말풍선 가로 반(그릴 때마다 재지 않고 크기가 바뀔 때만 잰다)

    // 화면 크기·방향이 바뀔 때: 배경(cover)이 얼마나 확대되고 어디가 잘렸는지 계산해서 '보이는 수면 안'에서 글·버튼과 겹치지 않는
    // 가장 넉넉한 곳을 찾아 이동 구간을 정한다. 넉넉한 곳이 짧으면 제자리에서 떠 있고, 안전한 곳이 없으면 숨긴다.
    const layout = () => {
      const vw = window.innerWidth
      const vh = window.innerHeight
      const stageW = Math.max(vw, 1.5 * vh) // CSS의 --W와 같은 식(cover 확대)
      const stageH = (stageW * 1024) / 1536
      const u = stageW / 1536 // 무대 1px이 화면에서 차지하는 길이
      const left = (vw - stageW) / 2 // 잘려 나간 가로 여백(음수)
      const top = (vh - stageH) / 2 // 잘려 나간 세로 여백(음수)
      const short = Math.min(vw, vh)
      // 오리 가로 크기: 폰은 40~52px, 태블릿·데스크톱은 60~72px
      const dw = short < 600 ? Math.round(Math.min(52, Math.max(40, short * 0.13))) : vw >= 1000 ? 72 : 60
      root.style.setProperty('--dw', `${dw}px`)
      if (tip) tipHalf = tip.offsetWidth / 2

      const visL = -left / u
      const visR = visL + vw / u
      const visT = -top / u
      const visB = visT + vh / u
      const hw = dw / 2 / u + 6 // 오리 가로 반(여유 포함)
      const hUp = (dw * 0.92 + 34) / u // 오리 높이 + 말풍선
      const hDown = (dw * 0.16 + 4) / u // 아래 물결
      const avoid: [number, number, number, number][] = []
      for (const sel of ['.bh__copy', '.bh__link', '.bh__volume']) {
        const el = document.querySelector(sel)
        if (!el) continue
        const r = el.getBoundingClientRect()
        const pad = 10
        avoid.push([(r.left - pad - left) / u, (r.top - pad - top) / u, (r.right + pad - left) / u, (r.bottom + pad - top) / u])
      }
      const safe = (x: number, y: number) => {
        if (x - hw < visL || x + hw > visR || y - hUp < visT || y + hDown > visB) return false // 화면 밖
        // 아래 모서리·가운데·몸통 중간이 모두 수면 안이어야 한다(바닥·탕 테두리 위 금지)
        const body = y - (dw * 0.4) / u
        if (!inWater(x - hw * 0.9, y) || !inWater(x, y) || !inWater(x + hw * 0.9, y) || !inWater(x, body)) return false
        for (const [ax0, ay0, ax1, ay1] of avoid) if (!(x + hw < ax0 || x - hw > ax1 || y + hDown < ay0 || y - hUp > ay1)) return false
        return true
      }
      // 높이를 바꿔 가며 안전한 가로 구간을 모두 찾고, 가장 긴(수면 중간 높이에 가까운) 구간을 고른다
      const cap = (short < 600 ? 170 : 300) // 폰은 이동 범위를 짧게
      let best: { y: number; a: number; b: number; score: number } | null = null
      for (let y = Math.ceil(visT + hUp); y <= visB - hDown; y += 10) {
        let start = -1
        let last = -1
        for (let x = Math.ceil(visL + hw); x <= visR - hw + 0.001; x += 6) {
          if (safe(x, y)) {
            if (start < 0) start = x
            last = x
          } else if (start >= 0) {
            const len = last - start
            const score = Math.min(len, cap) - 0.15 * Math.abs(y - PREFER_Y)
            if (!best || score > best.score) best = { y, a: start, b: last, score }
            start = -1
          }
        }
        if (start >= 0) {
          const len = last - start
          const score = Math.min(len, cap) - 0.15 * Math.abs(y - PREFER_Y)
          if (!best || score > best.score) best = { y, a: start, b: last, score }
        }
      }
      if (!best) {
        root.style.visibility = 'hidden' // 안전한 곳이 없으면 보이지 않는다
        path = { x0: 0, x1: 0, ay: 0, u, left, vw }
        return
      }
      root.style.visibility = ''
      const mid = (best.a + best.b) / 2
      const len = Math.min(best.b - best.a, cap)
      const half = len >= MIN_TRAVEL ? len / 2 : 0 // 짧으면 제자리
      // 오리는 무대(.bh__stage) 안에 있어서, 위치는 무대 왼쪽 위 기준이다(잘려 나간 여백은 무대 자체가 이미 반영한다)
      path = { x0: mid - half, x1: mid + half, ay: best.y * u, u, left, vw }
      rig.style.top = `${path.ay}px`
      rig.style.left = '0px'
      draw(t)
    }

    // 잔상 물결 풀: 처음에 한 번만 만들어 두고 돌려 쓴다(움직이는 동안 DOM 요소를 새로 만들지 않는다)
    const pool = Array.from({ length: MAX_WAKES }, () => {
      const el = document.createElement('i')
      el.style.opacity = '0'
      wake.appendChild(el)
      return { el, busy: false }
    })

    // 화면 크기·회전이 바뀌면 위치를 다시 계산한다(회전 직후에는 예전 크기가 보고될 때가 있어 한 번 더 한다)
    let relayoutTimer = 0
    const relayout = () => {
      layout()
      window.clearTimeout(relayoutTimer)
      relayoutTimer = window.setTimeout(layout, 160)
    }
    const listen = () => {
      window.addEventListener('resize', relayout)
      window.addEventListener('orientationchange', relayout)
    }
    const unlisten = () => {
      window.clearTimeout(relayoutTimer)
      window.removeEventListener('resize', relayout)
      window.removeEventListener('orientationchange', relayout)
    }

    let t = 0 // 오리가 움직인 시간(멈춰 있던 동안은 세지 않는다)
    let nextBlink = rand(4, 7)
    let blinkUntil = 0
    let blinking = false
    let nextWake = 0

    const draw = (time: number) => {
      const still = path.x1 - path.x0 < 1 // 이동 구간이 없으면 제자리에서 떠 있기만 한다
      const c = time % CYCLE_S
      let x: number
      let dir = 1 // 1: 왼쪽을 봄(기본), -1: 오른쪽으로 뒤집음
      if (c < HOLD_S) {
        x = path.x0
        dir = c < HOLD_S / 2 ? 1 : -1 // 머문 뒤 방향을 바꾼다
      } else if (c < HOLD_S + MOVE_S) {
        x = path.x0 + (path.x1 - path.x0) * smooth((c - HOLD_S) / MOVE_S)
        dir = -1
      } else if (c < HOLD_S * 2 + MOVE_S) {
        x = path.x1
        dir = c - (HOLD_S + MOVE_S) < HOLD_S / 2 ? -1 : 1
      } else {
        x = path.x1 - (path.x1 - path.x0) * smooth((c - HOLD_S * 2 - MOVE_S) / MOVE_S)
        dir = 1
      }
      if (still) dir = 1
      const bob = reduce ? 0 : Math.sin((time * 2 * Math.PI) / 3.4) * BOB_PX
      const tilt = reduce ? 0 : Math.sin((time * 2 * Math.PI) / 4.6 + 1) * TILT_DEG
      rig.style.transform = `translate3d(${x * path.u}px,0,0)`
      if (tip) {
        // 안내 말풍선이 화면 가장자리로 잘리지 않게 가로 위치를 보정하고, 꼬리는 오리를 가리키게 둔다
        const center = path.left + x * path.u
        const shift = Math.min(Math.max(center, tipHalf + 8), path.vw - tipHalf - 8) - center
        tip.style.setProperty('--shift', `${shift}px`)
      }
      body.style.transform = `translate3d(0,${bob}px,0) rotate(${tilt}deg) scaleX(${dir === 1 ? 1 : -1})`
      // 잔상 물결: 오리가 움직이는 동안 지나간 자리(꼬리 쪽)에 옅은 타원 물결을 남긴다. 남은 물결은 제자리에서 퍼지며 사라진다
      const moving = !still && ((c >= HOLD_S && c < HOLD_S + MOVE_S) || c >= HOLD_S * 2 + MOVE_S)
      if (!reduce && moving && time >= nextWake) {
        const ring = pool.find((r) => !r.busy)
        if (ring) {
          nextWake = time + WAKE_EVERY_S
          ring.busy = true
          const dw = parseFloat(root.style.getPropertyValue('--dw')) || 72
          const behind = (dir === 1 ? 1 : -1) * dw * 0.32 // 왼쪽을 볼 때(왼쪽으로 가는 중)는 오른쪽이 꼬리
          const el = ring.el
          el.style.left = `${x * path.u + behind - dw * 0.6}px`
          el.style.top = `${-dw * 0.11}px`
          el.style.width = `${dw * 1.2}px`
          el.style.height = `${dw * 0.22}px`
          const anim = el.animate(
            [
              { opacity: 0.8, transform: 'scale(0.55)' },
              { opacity: 0, transform: 'scale(2.1)' },
            ],
            { duration: WAKE_LIFE_MS, easing: 'ease-out', fill: 'forwards' },
          )
          anim.onfinish = () => {
            el.style.opacity = '0'
            ring.busy = false
          }
        }
      }
      // 눈 깜빡임: 4~7초마다 눈 감은 프레임을 아주 잠깐만 보여 준다
      if (!reduce) {
        if (!blinking && time >= nextBlink) {
          blinking = true
          blinkUntil = time + BLINK_S
          blink.style.visibility = 'visible'
        } else if (blinking && time >= blinkUntil) {
          blinking = false
          nextBlink = time + rand(4, 7)
          blink.style.visibility = 'hidden'
        }
      }
    }

    layout()
    if (reduce) {
      // 움직임 줄이기: 정지한 오리(수면 구간 가운데, 왼쪽을 봄)
      t = HOLD_S * 2 + MOVE_S * 1.5
      draw(t)
      listen()
      return unlisten
    }

    // 탭이 숨겨졌거나 인트로가 화면 밖이면 멈춘다(시간도 세지 않아 돌아오면 이어서 움직인다)
    let visible = !document.hidden
    let onScreen = true
    let raf = 0
    let last = 0
    const tick = (now: number) => {
      raf = 0
      if (!(visible && onScreen)) return
      const dt = last ? Math.min((now - last) / 1000, 0.1) : 0
      last = now
      t += dt
      draw(t)
      root.classList.remove('is-paused')
      raf = requestAnimationFrame(tick)
    }
    const sync = () => {
      cancelAnimationFrame(raf)
      raf = 0
      last = 0
      if (visible && onScreen) raf = requestAnimationFrame(tick)
      else root.classList.add('is-paused')
      root.getAnimations({ subtree: true }).forEach((a) => (visible && onScreen ? a.play() : a.pause()))
    }
    const onVis = () => {
      visible = !document.hidden
      sync()
    }
    const io = new IntersectionObserver(
      ([e]) => {
        onScreen = e.isIntersecting
        sync()
      },
      { threshold: 0.01 },
    )
    io.observe(root.parentElement ?? root)
    document.addEventListener('visibilitychange', onVis)
    listen()
    sync()
    return () => {
      cancelAnimationFrame(raf)
      wake.replaceChildren()
      io.disconnect()
      document.removeEventListener('visibilitychange', onVis)
      unlisten()
    }
  }, [])

  const sprite = {
    '--sheet': `url(${sheetUrl})`,
    '--sw': sheet.size.w,
  } as CSSProperties

  return (
    <div className="bh__duck" ref={rootRef} style={sprite}>
      <div className="bh__duck-wake" ref={wakeRef} />
      <div className="bh__duck-rig" ref={rigRef}>
        {/* 오리를 누르면 효과음이 난다. 투명한 누르는 영역이 오리를 따라다닌다 */}
        <button type="button" className="bh__duck-hit" aria-label="오리 소리 듣기" onClick={onPress} />
        <span className={`bh__duck-hint${hint ? ' is-on' : ''}`} ref={hintRef} aria-hidden="true">
          오리를 누르면 소리가 들려요
        </span>
        <div className="bh__duck-ripple">
          <i />
          <i />
        </div>
        <div className="bh__duck-body" ref={bodyRef}>
          <span className="bh__duck-frame" style={frameVars(BASE)} />
          <span className="bh__duck-frame bh__duck-frame--blink" ref={blinkRef} style={frameVars(BLINK)} />
        </div>
      </div>
    </div>
  )
}
