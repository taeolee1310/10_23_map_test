/**
 * OnsenMeltLogo — "따뜻한 온천에 몸을 맡기며 스르르 녹아내리는 캐릭터"
 *
 * React 단일 파일 컴포넌트 (외부 의존성 없음, React 18+ / 19).
 * - 단색 라인아트 SVG. 겹침은 SVG mask로 처리하므로 배경이 투명합니다.
 * - 캐릭터 실루엣은 하나의 부드러운 변형 필드(deformation field)로 path를 직접 모핑합니다.
 *   몸, 어깨, 얼굴, 수건이 같은 필드를 따르므로 "젤리처럼" 함께 처집니다.
 * - 온천 돌은 고정, 캐릭터 / 수면 / 수증기만 개별적으로 움직입니다.
 * - prefers-reduced-motion 환경에서는 애니메이션하지 않습니다.
 *
 * 사용 예:
 *   <OnsenLogoLink href="/" height={48} />                 // 헤더용 (hover / focus 시 재생)
 *   <OnsenMeltLogo height={240} color="#0A9FE8" duration={4.5} />
 */
import {
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
  type AnchorHTMLAttributes,
  type CSSProperties,
  type ReactNode,
  type Ref,
} from 'react'

/* -------------------------------------------------------------------------- */
/*  Public API                                                                */
/* -------------------------------------------------------------------------- */

export type OnsenPhase = 'idle' | 'relax' | 'melt' | 'satisfaction' | 'recovery'

export interface OnsenMeltLogoHandle {
  /** 애니메이션을 처음부터 재생합니다. 이미 재생 중이면 무시하고 자연스럽게 마무리합니다. */
  play: () => void
  isPlaying: () => boolean
}

export interface OnsenMeltLogoProps {
  /** 로고 단일 컬러. 'currentColor'를 넘기면 부모의 CSS color를 따릅니다. */
  color?: string
  /** 그래픽 높이. 숫자(px) 또는 CSS 값 (예: 'clamp(36px, 6vw, 48px)'). 기본 48 */
  height?: number | string
  /** 선 두께 (viewBox 단위, 원본 기준 약 18). 작은 크기에서는 20~22 권장 */
  strokeWidth?: number
  /** 메인 애니메이션 길이(초). 기본 4.5 */
  duration?: number
  /** 마운트 시 1회 자동 재생. 기본 true */
  autoPlay?: boolean
  /** 로고 자체에 마우스를 올렸을 때 재생 (링크로 감쌀 때는 링크가 처리하므로 false). 기본 false */
  playOnHover?: boolean
  /** 강제로 모션 비활성화 */
  disableMotion?: boolean
  /** 접근성 레이블. 지정하지 않으면 장식용(aria-hidden)으로 렌더링됩니다. */
  title?: string
  /** 매 프레임 진행률(0~1)과 현재 단계를 알려줍니다. */
  onProgress?: (progress: number, phase: OnsenPhase) => void
  className?: string
  style?: CSSProperties
  ref?: Ref<OnsenMeltLogoHandle>
}

export const ONSEN_LOGO_COLOR = '#0A9FE8'

/** 타임라인(기준 4.5초) 단계 구간 — 미리보기 UI 등에서 사용 */
export const ONSEN_PHASES: { id: Exclude<OnsenPhase, 'idle'>; label: string; from: number; to: number }[] = [
  { id: 'relax', label: 'Relax', from: 0, to: 0.8 },
  { id: 'melt', label: 'Melt', from: 0.8, to: 2.2 },
  { id: 'satisfaction', label: 'Satisfaction', from: 2.2, to: 3.2 },
  { id: 'recovery', label: 'Recovery', from: 3.2, to: 4.5 },
]

/* -------------------------------------------------------------------------- */
/*  Geometry (원본 레퍼런스 1254px 좌표계를 그대로 사용)                         */
/* -------------------------------------------------------------------------- */

const VB = { x: 236, y: 262, w: 784, h: 758 }
const BASE_TIMELINE = 4.5
/** 지연(lag)이 있는 트랙까지 모두 정지하는 시점 */
const TIMELINE_END = 4.72

interface PathTpl {
  cmds: string[]
  counts: number[]
  nums: number[]
}

function parse(d: string): PathTpl {
  const cmds: string[] = []
  const counts: number[] = []
  const nums: number[] = []
  const re = /([MLCQZ])|(-?\d*\.?\d+)/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(d))) {
    if (m[1]) {
      cmds.push(m[1].toUpperCase())
      counts.push(0)
    } else {
      nums.push(parseFloat(m[2]))
      counts[counts.length - 1]++
    }
  }
  return { cmds, counts, nums }
}

function toD(tpl: PathTpl, nums: number[]): string {
  let out = ''
  let k = 0
  for (let i = 0; i < tpl.cmds.length; i++) {
    out += tpl.cmds[i]
    for (let j = 0; j < tpl.counts[i]; j++) out += (j ? ' ' : '') + nums[k++].toFixed(2)
    out += ' '
  }
  return out.trim()
}

/** 같은 명령 구조를 가진 path 쌍 (기본형 / 변형형) */
function pair(base: string, alt: string) {
  const a = parse(base)
  const b = parse(alt)
  if (a.nums.length !== b.nums.length) throw new Error('OnsenMeltLogo: path structure mismatch')
  return { tpl: a, base: a.nums, alt: b.nums }
}

function mix(a: number[], b: number[], t: number, c?: number[], u = 0): number[] {
  const out = new Array<number>(a.length)
  for (let i = 0; i < a.length; i++) out[i] = a[i] + (b[i] - a[i]) * t + (c ? (c[i] - a[i]) * u : 0)
  return out
}

/** 둥근 조약돌 형태 */
function pebble(cx: number, cy: number, rx: number, ry: number, k = 0.64): string {
  const kx = rx * k
  const ky = ry * k
  return [
    `M${cx - rx} ${cy}`,
    `C${cx - rx} ${cy - ky} ${cx - kx} ${cy - ry} ${cx} ${cy - ry}`,
    `C${cx + kx} ${cy - ry} ${cx + rx} ${cy - ky} ${cx + rx} ${cy}`,
    `C${cx + rx} ${cy + ky} ${cx + kx} ${cy + ry} ${cx} ${cy + ry}`,
    `C${cx - kx} ${cy + ry} ${cx - rx} ${cy + ky} ${cx - rx} ${cy}Z`,
  ].join(' ')
}

type Stone = { id: string; inner: [number, number, number, number]; outer: [number, number, number, number] }

const STONES: Record<'back' | 'side' | 'big' | 'front' | 'center', Stone[]> = {
  back: [
    { id: 'bl', outer: [400, 681, 62, 44], inner: [404, 687, 47, 29] },
    { id: 'br', outer: [859, 680, 60, 43], inner: [855, 686, 45, 28] },
  ],
  side: [
    { id: 'sl', outer: [320, 755, 62, 50], inner: [326, 760, 47, 35] },
    { id: 'sr', outer: [936, 755, 63, 50], inner: [930, 760, 48, 35] },
  ],
  big: [
    { id: 'gl', outer: [335, 862, 80, 72], inner: [340, 860, 63, 54] },
    { id: 'gr', outer: [922, 862, 80, 72], inner: [917, 860, 63, 54] },
  ],
  front: [
    { id: 'f1', outer: [446, 918, 80, 56], inner: [450, 921, 66, 39] },
    { id: 'f3', outer: [808, 918, 80, 56], inner: [804, 921, 66, 39] },
  ],
  center: [{ id: 'f2', outer: [627, 937, 110, 65], inner: [627, 931, 97, 47] }],
}

/* 온천 뒤쪽 가장자리(수면 경계) — 고정 */
const POOL_LINE = 'M372 742 C392 728 420 718 452 712 M800 708 C836 716 864 728 884 742'
const POOL_SURFACE = 'M372 742 C392 728 420 718 452 712 L800 708 C836 716 864 728 884 742 L884 800 L372 800Z'

/* 캐릭터: 변형 필드에 의해 모핑되는 기본형 */
const BODY = parse(
  'M438 812 C420 790 414 752 424 720 C434 688 452 660 470 636 C496 590 540 552 592 545 C652 538 722 552 770 588 C806 614 826 664 832 712 C838 752 834 788 820 812Z',
)
const SHOULDER_L = parse('M467 672 C449 696 439 728 446 768')
const SHOULDER_R = parse('M798 690 C812 712 818 744 812 772')
const TOWEL = parse(
  'M578 545 C562 534 568 512 592 504 C642 488 722 504 774 536 C792 548 794 566 784 580 L770 600 C764 608 752 607 749 598 L744 584 C704 562 640 548 578 545Z',
)
const TOWEL_FOLD = parse('M752 596 C756 584 764 576 778 572')
const TOWEL_DOTS: [number, number][] = [
  [718, 543],
  [707, 557],
  [726, 560],
  [735, 575],
]
const CHEEKS: [number, number][] = [
  [514, 690],
  [733, 698],
]
const CHEEK_R = 21

/* 표정 모핑 (기본 → 편안하게 감긴 눈 / 만족스러운 작은 미소 / "아, 좋다…") */
const EYE_L = pair('M533 650 C543 640 563 640 577 652', 'M533 652 C545 657 563 657 577 653')
const EYE_R = pair('M668 652 C680 642 702 643 714 657', 'M668 654 C681 659 701 659 714 655')
const MOUTH_W = pair('M588 674 Q594 690 609 682 Q620 674 631 682 Q646 690 654 674', 'M584 677 Q595 688 609 683 Q620 678 631 683 Q645 688 658 677')
const MOUTH_W_JOY = parse('M585 676 Q595 689 609 683 Q620 677 631 683 Q645 689 657 676').nums
const MOUTH_O = pair('M605 688 C606 712 634 712 636 688', 'M608 689 C610 703 631 703 633 689')
const MOUTH_O_JOY = parse('M605 688 C606 711 635 711 636 688').nums
const TONGUE = pair('M612 702 Q620 696 629 702', 'M613 697 Q620 694 628 697')
const TONGUE_JOY = parse('M612 701 Q620 696 629 701').nums

/* 팔: 힘없이 온천 가장자리에 걸쳐지는 형태로 직접 모핑 */
const ARM_L = pair(
  'M452 830 L452 806 C446 774 478 750 516 750 C554 750 580 768 578 802 L578 830Z',
  'M436 830 L438 808 C434 785 468 767 508 767 C550 767 578 781 580 806 L580 830Z',
)
const ARM_R = pair(
  'M640 830 L640 806 C636 776 668 756 706 756 C744 756 774 774 772 802 L772 830Z',
  'M638 830 L638 808 C638 787 670 772 713 772 C754 772 789 785 791 808 L791 830Z',
)

/* 수면 */
const WATERLINE = parse('M424 793 C520 807 730 809 832 794')
const RIPPLES: { tpl: PathTpl; dir: -1 | 1 }[] = [
  { tpl: parse('M395 786 C410 808 440 822 470 828'), dir: -1 },
  { tpl: parse('M505 840 C530 846 560 850 585 851'), dir: -1 },
  { tpl: parse('M715 852 C735 851 755 848 770 843'), dir: 1 },
  { tpl: parse('M778 826 C810 820 840 806 856 788'), dir: 1 },
]

/* 수증기 */
const STEAM = [
  pair('M543 356 C562 378 566 400 546 426 C524 455 526 470 544 486', 'M545 358 C568 382 568 404 545 430 C522 456 530 472 550 484'),
  pair('M636 305 C664 330 668 362 640 396 C610 432 620 450 646 466', 'M638 307 C670 334 670 368 640 400 C608 434 626 454 652 464'),
  pair('M722 357 C746 376 754 402 734 426 C714 452 716 470 734 486', 'M724 359 C752 382 756 406 733 430 C712 454 720 472 740 484'),
]

/* -------------------------------------------------------------------------- */
/*  Deformation field — 중력과 부력에 늘어지는 젤리                              */
/* -------------------------------------------------------------------------- */

const WATER_Y = 800
const CENTER_X = 628
const BODY_H = 260

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
const smoothstep = (p: number) => p * p * (3 - 2 * p)

/**
 * m: melt(0~1) — 높이 약 7% 감소, 하단 약 4.5% 옆으로 퍼짐, 수면 쪽으로 약간 가라앉음, 어깨가 더 처짐
 * b: breath(0~1) — 숨을 들이마시듯 위로 아주 미세하게 들림
 */
function deform(src: number[], m: number, b: number): number[] {
  const out = new Array<number>(src.length)
  for (let i = 0; i < src.length; i += 2) {
    const x = src[i]
    const y = src[i + 1]
    const above = Math.max(0, WATER_Y - y)
    const h = Math.min(above / BODY_H, 1.25)
    const hc = Math.min(h, 1)
    const ramp = smoothstep(clamp01(h / 0.25))
    const dx = x - CENTER_X
    const side = Math.min(1, Math.abs(dx) / 190)

    const spread = 0.045 * (1 - 0.5 * hc) + 0.02 * Math.exp(-(((h - 0.45) / 0.25) ** 2))
    const sag = 14 * side * side * Math.exp(-(((h - 0.5) / 0.3) ** 2))
    const meltDx = dx * spread
    const meltDy = 0.055 * above + 6 * ramp + sag

    const breathDx = -dx * 0.012 * hc
    const breathDy = -6 * hc * ramp

    out[i] = x + m * meltDx + b * breathDx
    out[i + 1] = y + m * meltDy + b * breathDy
  }
  return out
}

/* -------------------------------------------------------------------------- */
/*  Timeline (기준 4.5초) — ease-in-out + 낮은 탄성 / 높은 감쇠 spring          */
/* -------------------------------------------------------------------------- */

const seg = (t: number, a: number, b: number) => clamp01((t - a) / (b - a))
const sine = (p: number) => -(Math.cos(Math.PI * p) - 1) / 2
const smoother = (p: number) => p * p * p * (p * (p * 6 - 15) + 10)
/** 임계 감쇠 spring 응답: 오버슈트(바운스) 없이 천천히 수렴 */
const SPRING_K = 5.5
const SPRING_NORM = 1 - (1 + SPRING_K) * Math.exp(-SPRING_K)
const settle = (p: number) =>
  p <= 0 ? 0 : p >= 1 ? 1 : (1 - (1 + SPRING_K * p) * Math.exp(-SPRING_K * p)) / SPRING_NORM

function meltAt(t: number) {
  if (t <= 0.8) return 0
  if (t < 3.2) return 0.95 * smoother(seg(t, 0.8, 2.2)) + 0.05 * sine(seg(t, 1.9, 3.0))
  return 1 - settle(seg(t, 3.2, 4.5))
}
const breathAt = (t: number) => (t < 0.8 ? sine(seg(t, 0, 0.8)) : 1 - sine(seg(t, 0.8, 1.5)))
const exprAt = (t: number) => (t < 3.35 ? smoother(seg(t, 0.95, 2.1)) : 1 - settle(seg(t, 3.35, 4.5)))
const joyAt = (t: number) => (t < 3.1 ? sine(seg(t, 2.1, 2.6)) : 1 - sine(seg(t, 3.1, 3.9)))
const rippleAt = (t: number) => (t < 3.1 ? sine(seg(t, 2.0, 2.8)) : 1 - sine(seg(t, 3.1, 4.5)))
const steamAt = (t: number, i: number) =>
  t < 3.45 + 0.08 * i ? sine(seg(t, 2.15 + 0.16 * i, 3.15 + 0.16 * i)) : 1 - sine(seg(t, 3.45 + 0.08 * i, 4.45 + 0.08 * i))

function phaseAt(t: number): OnsenPhase {
  if (t <= 0 || t >= TIMELINE_END) return 'idle'
  return ONSEN_PHASES.find((p) => t < p.to)?.id ?? 'recovery'
}

/* -------------------------------------------------------------------------- */
/*  Frame                                                                     */
/* -------------------------------------------------------------------------- */

type Attrs = Record<string, string>
type Frame = Record<string, Attrs>

function computeFrame(t: number): Frame {
  const m = meltAt(t)
  const b = breathAt(t)
  const e = exprAt(t)
  const j = joyAt(t)
  const mArm = meltAt(t - 0.12) // 팔은 몸보다 살짝 늦게 따라옵니다
  const mWater = meltAt(t - 0.18) // 수면은 캐릭터보다 시간차를 두고 반응
  const r = rippleAt(t)
  const phi = (2 * Math.PI * (t - 2.0)) / 2.2
  const f: Frame = {}

  const d = (tpl: PathTpl, nums: number[]) => ({ d: toD(tpl, nums) })
  const dc = (tpl: PathTpl) => d(tpl, deform(tpl.nums, m, b))

  f.body = dc(BODY)
  f.shoulderL = dc(SHOULDER_L)
  f.shoulderR = dc(SHOULDER_R)
  f.towel = dc(TOWEL)
  f.towelFold = dc(TOWEL_FOLD)
  TOWEL_DOTS.forEach(([x, y], i) => {
    const [cx, cy] = deform([x, y], m, b)
    f[`dot${i}`] = { cx: cx.toFixed(2), cy: cy.toFixed(2) }
  })
  CHEEKS.forEach(([x, y], i) => {
    const [cx, cy] = deform([x, y], m, b)
    f[`cheek${i}`] = {
      cx: cx.toFixed(2),
      cy: cy.toFixed(2),
      rx: (CHEEK_R * (1 + 0.05 * m)).toFixed(2),
      ry: (CHEEK_R * (1 - 0.04 * m)).toFixed(2),
    }
  })
  f.eyeL = d(EYE_L.tpl, deform(mix(EYE_L.base, EYE_L.alt, e), m, b))
  f.eyeR = d(EYE_R.tpl, deform(mix(EYE_R.base, EYE_R.alt, e), m, b))
  f.mouthW = d(MOUTH_W.tpl, deform(mix(MOUTH_W.base, MOUTH_W.alt, e, MOUTH_W_JOY, j), m, b))
  f.mouthO = d(MOUTH_O.tpl, deform(mix(MOUTH_O.base, MOUTH_O.alt, e, MOUTH_O_JOY, j), m, b))
  f.tongue = d(TONGUE.tpl, deform(mix(TONGUE.base, TONGUE.alt, e, TONGUE_JOY, j), m, b))

  f.armL = d(ARM_L.tpl, mix(ARM_L.base, ARM_L.alt, mArm))
  f.armR = d(ARM_R.tpl, mix(ARM_R.base, ARM_R.alt, mArm))

  const wl = deform(WATERLINE.nums, mWater, 0)
  for (let i = 0; i < wl.length; i += 2) wl[i + 1] += r * 2.6 * Math.sin(phi + wl[i] * 0.03)
  f.waterline = d(WATERLINE, wl)
  const p = wl.map((n) => n.toFixed(2))
  f.waterRegion = {
    d: `M380 ${p[1]} L${p[0]} ${p[1]} C${p[2]} ${p[3]} ${p[4]} ${p[5]} ${p[6]} ${p[7]} L880 ${p[7]} L880 900 L380 900Z`,
  }

  RIPPLES.forEach(({ tpl, dir }, i) => {
    const n = tpl.nums
    let cx = 0
    for (let k = 0; k < n.length; k += 2) cx += n[k]
    cx /= n.length / 2
    const shift = dir * (r * 9 + r * 2 * Math.sin(phi + i))
    const stretch = 1 + 0.08 * r
    const out = n.map((v, k) => (k % 2 === 0 ? cx + (v - cx) * stretch + shift : v + r * 1.5 * Math.sin(phi + v * 0.02)))
    f[`ripple${i}`] = d(tpl, out)
  })

  STEAM.forEach((s, i) => {
    const k = steamAt(t, i)
    const n = mix(s.base, s.alt, k).map((v, idx) => (idx % 2 ? v - 16 * k : v))
    f[`steam${i}`] = d(s.tpl, n)
  })

  return f
}

const REST_FRAME = computeFrame(0)

/* -------------------------------------------------------------------------- */
/*  Hooks                                                                     */
/* -------------------------------------------------------------------------- */

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduced(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])
  return reduced
}

/* -------------------------------------------------------------------------- */
/*  Component                                                                 */
/* -------------------------------------------------------------------------- */

export function OnsenMeltLogo({
  color = ONSEN_LOGO_COLOR,
  height = 48,
  strokeWidth = 18,
  duration = BASE_TIMELINE,
  autoPlay = true,
  playOnHover = false,
  disableMotion = false,
  title,
  onProgress,
  className,
  style,
  ref,
}: OnsenMeltLogoProps) {
  const uid = 'onsen' + useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const id = (name: string) => `${uid}-${name}`
  const els = useRef<Record<string, SVGElement | null>>({})
  const raf = useRef<number | null>(null)
  const running = useRef(false)
  const reducedPref = usePrefersReducedMotion()
  const reduced = reducedPref || disableMotion

  const settings = useRef({ duration, onProgress, reduced })
  settings.current = { duration, onProgress, reduced }

  const apply = useCallback((frame: Frame) => {
    for (const key in frame) {
      const el = els.current[key]
      if (!el) continue
      const attrs = frame[key]
      for (const a in attrs) el.setAttribute(a, attrs[a])
    }
  }, [])

  const stop = useCallback(() => {
    if (raf.current != null) cancelAnimationFrame(raf.current)
    raf.current = null
    running.current = false
    apply(REST_FRAME)
  }, [apply])

  const play = useCallback(() => {
    if (running.current || settings.current.reduced) return
    running.current = true
    const start = performance.now()
    const tick = (now: number) => {
      const scale = BASE_TIMELINE / Math.max(0.5, settings.current.duration)
      const t = ((now - start) / 1000) * scale
      if (t >= TIMELINE_END) {
        raf.current = null
        running.current = false
        apply(REST_FRAME)
        settings.current.onProgress?.(1, 'idle')
        return
      }
      apply(computeFrame(t))
      settings.current.onProgress?.(Math.min(1, t / BASE_TIMELINE), phaseAt(t))
      raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
  }, [apply])

  useImperativeHandle(ref, () => ({ play, isPlaying: () => running.current }), [play])

  // 최초 진입 시 1회 재생
  useEffect(() => {
    if (autoPlay && !reduced) play()
    return stop
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 모션 감소 설정이 켜지면 즉시 정지 상태로
  useEffect(() => {
    if (reduced) stop()
  }, [reduced, stop])

  const setRef = (key: string) => (el: SVGElement | null) => {
    els.current[key] = el
  }
  const P = (key: string) => <path id={id(key)} ref={setRef(key)} d={REST_FRAME[key].d} />

  const stroke = {
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }
  const solid = { fill: 'currentColor', stroke: 'none' }
  const use = (key: string, props: object = stroke) => <use key={key} href={`#${id(key)}`} {...props} />
  const stoneUses = (list: Stone[]) => list.flatMap((s) => [use(`${s.id}-o`), use(`${s.id}-i`)])

  /* 뒤 → 앞 순서. 각 레이어는 앞쪽 레이어의 채움 영역에 가려집니다(mask). */
  const layers: { key: string; occluders: string[]; content: ReactNode }[] = [
    { key: 'back', occluders: ['bl-o', 'br-o'], content: stoneUses(STONES.back) },
    { key: 'pool', occluders: ['poolSurface'], content: use('poolLine') },
    { key: 'side', occluders: ['sl-o', 'sr-o'], content: stoneUses(STONES.side) },
    { key: 'steam', occluders: [], content: [0, 1, 2].map((i) => use(`steam${i}`, { ...stroke, strokeWidth: strokeWidth * 1.25 })) },
    {
      key: 'character',
      occluders: ['body'],
      content: [
        use('body'),
        use('shoulderL'),
        use('shoulderR'),
        use('eyeL'),
        use('eyeR'),
        use('mouthW', { ...stroke, strokeWidth: strokeWidth * 0.85 }),
        use('mouthO', { ...stroke, strokeWidth: strokeWidth * 0.85 }),
        use('tongue', { ...stroke, strokeWidth: strokeWidth * 0.6 }),
        use('cheek0', solid),
        use('cheek1', solid),
      ],
    },
    {
      key: 'towel',
      occluders: ['towel'],
      content: [use('towel'), use('towelFold', { ...stroke, strokeWidth: strokeWidth * 0.8 }), ...TOWEL_DOTS.map((_, i) => use(`dot${i}`, solid))],
    },
    { key: 'arms', occluders: ['armL', 'armR'], content: [use('armL'), use('armR')] },
    {
      key: 'water',
      occluders: ['waterRegion'],
      content: [use('waterline'), ...RIPPLES.map((_, i) => use(`ripple${i}`))],
    },
    { key: 'big', occluders: ['gl-o', 'gr-o'], content: stoneUses(STONES.big) },
    { key: 'front', occluders: ['f1-o', 'f3-o'], content: stoneUses(STONES.front) },
    { key: 'center', occluders: ['f2-o'], content: stoneUses(STONES.center) },
  ]

  const allStones = Object.values(STONES).flat()
  const h = typeof height === 'number' ? `${height}px` : height

  return (
    <svg
      viewBox={`${VB.x} ${VB.y} ${VB.w} ${VB.h}`}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
      className={className}
      onMouseEnter={playOnHover ? play : undefined}
      style={{
        display: 'block',
        height: h,
        width: 'auto',
        aspectRatio: `${VB.w} / ${VB.h}`,
        color,
        overflow: 'visible',
        ...style,
      }}
    >
      {title ? <title>{title}</title> : null}
      <defs>
        {allStones.flatMap((s) => [
          <path key={`${s.id}-o`} id={id(`${s.id}-o`)} d={pebble(...s.outer)} />,
          <path key={`${s.id}-i`} id={id(`${s.id}-i`)} d={pebble(...s.inner)} />,
        ])}
        <path id={id('poolLine')} d={POOL_LINE} />
        <path id={id('poolSurface')} d={POOL_SURFACE} />
        {P('body')}
        {P('shoulderL')}
        {P('shoulderR')}
        {P('towel')}
        {P('towelFold')}
        {P('eyeL')}
        {P('eyeR')}
        {P('mouthW')}
        {P('mouthO')}
        {P('tongue')}
        {P('armL')}
        {P('armR')}
        {P('waterline')}
        {P('waterRegion')}
        {RIPPLES.map((_, i) => (
          <path key={i} id={id(`ripple${i}`)} ref={setRef(`ripple${i}`)} d={REST_FRAME[`ripple${i}`].d} />
        ))}
        {STEAM.map((_, i) => (
          <path key={i} id={id(`steam${i}`)} ref={setRef(`steam${i}`)} d={REST_FRAME[`steam${i}`].d} />
        ))}
        {TOWEL_DOTS.map((_, i) => (
          <circle key={i} id={id(`dot${i}`)} ref={setRef(`dot${i}`)} r={6.5} cx={REST_FRAME[`dot${i}`].cx} cy={REST_FRAME[`dot${i}`].cy} />
        ))}
        {CHEEKS.map((_, i) => {
          const c = REST_FRAME[`cheek${i}`]
          return <ellipse key={i} id={id(`cheek${i}`)} ref={setRef(`cheek${i}`)} cx={c.cx} cy={c.cy} rx={c.rx} ry={c.ry} />
        })}
        {layers.map((layer, i) => {
          const occ = layers.slice(i + 1).flatMap((l) => l.occluders)
          if (!occ.length) return null
          return (
            <mask key={layer.key} id={id(`mask-${layer.key}`)} maskUnits="userSpaceOnUse" x={VB.x - 40} y={VB.y - 40} width={VB.w + 80} height={VB.h + 80}>
              <rect x={VB.x - 40} y={VB.y - 40} width={VB.w + 80} height={VB.h + 80} fill="white" />
              {occ.map((o) => (
                <use key={o} href={`#${id(o)}`} fill="black" stroke="none" />
              ))}
            </mask>
          )
        })}
      </defs>

      {layers.map((layer, i) => (
        <g key={layer.key} mask={i < layers.length - 1 ? `url(#${id(`mask-${layer.key}`)})` : undefined}>
          {layer.content}
        </g>
      ))}
    </svg>
  )
}

/* -------------------------------------------------------------------------- */
/*  Header link — 홈으로 이동, hover / keyboard focus 시 다시 재생                */
/* -------------------------------------------------------------------------- */

export interface OnsenLogoLinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'color'> {
  /** 링크 대상. 기본 '/' */
  href?: string
  /** 스크린리더용 이름. 기본 '홈으로 이동' */
  label?: string
  height?: number | string
  color?: string
  strokeWidth?: number
  duration?: number
  autoPlay?: boolean
  disableMotion?: boolean
  logoRef?: Ref<OnsenMeltLogoHandle>
  /** 로고 옆 워드마크 등 (선택) */
  children?: ReactNode
}

export function OnsenLogoLink({
  href = '/',
  label = '홈으로 이동',
  height = 48,
  color,
  strokeWidth = 20,
  duration,
  autoPlay = true,
  disableMotion,
  logoRef,
  children,
  style,
  onMouseEnter,
  onFocus,
  ...rest
}: OnsenLogoLinkProps) {
  const inner = useRef<OnsenMeltLogoHandle>(null)
  useImperativeHandle(logoRef, () => ({
    play: () => inner.current?.play(),
    isPlaying: () => inner.current?.isPlaying() ?? false,
  }))

  return (
    <a
      href={href}
      aria-label={children ? undefined : label}
      onMouseEnter={(e) => {
        inner.current?.play()
        onMouseEnter?.(e)
      }}
      onFocus={(e) => {
        inner.current?.play()
        onFocus?.(e)
      }}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 10, textDecoration: 'none', color: 'inherit', ...style }}
      {...rest}
    >
      <OnsenMeltLogo
        ref={inner}
        height={height}
        color={color}
        strokeWidth={strokeWidth}
        duration={duration}
        autoPlay={autoPlay}
        disableMotion={disableMotion}
      />
      {children}
    </a>
  )
}

export default OnsenMeltLogo
