import { useEffect, useId, useMemo, useRef, useState, type Ref } from 'react'
import shadowImg from '../../assets/milk-loader/01-shadow.svg'
import bodyImg from '../../assets/milk-loader/02-body.svg'
import bandImg from '../../assets/milk-loader/03-band.svg'
import glossImg from '../../assets/milk-loader/04-gloss.svg'
import capImg from '../../assets/milk-loader/05-cap.svg'
import './MilkLoader.css'

/* 로딩 화면: 바나나우유 병의 우유를 빨대로 마시듯 수위가 내려간다.
   병 그림은 Figma `크림 보틀 · 올리브 그린 캡 · 벡터`(노드 427:6)의 레이어 5장을 그대로 쓴다.
   좌표는 Figma 프레임을 1000×1000으로 본 값이다(Figma의 inset 퍼센트 × 10). */

const SHOW_DELAY = 200 // 로딩이 이보다 빨리 끝나면 로더를 아예 보이지 않는다(깜빡임 방지)
const MIN_SHOW = 450 // 한 번 보였으면 최소한 이만큼은 둔다
const DRAIN_MS = 380 // 로딩이 끝났을 때 남은 우유가 빠지는 시간
const FADE_MS = 240 // 로더가 사라지는 시간(CSS --ml-fade와 같게)
const FADE_REDUCED_MS = 160

// 수위(우유 윗면의 y). 병 몸통은 y 208~892.
export const Y_FULL = 196 // 가득 찬 상태
export const Y_HOLD = 790 // 로딩 중에는 여기까지만 내려가 완전히 비지 않는다
export const Y_EMPTY = 930 // 다 마신 상태(병 바닥 아래)
const Y_STILL = 560 // 모션 줄이기: 움직이지 않고 이 높이로 고정
const TAU = 2.4 // 수위가 내려가는 속도(초). 처음엔 또렷하게, 갈수록 천천히

// 물결
const WAVE_AMP = 5
export const WAVE_LEN = 170
export const WAVE_SEC = 2.2 // 물결이 한 파장 흐르는 시간
const WAVE_X0 = 150
const WAVE_X1 = 850 + WAVE_LEN

function wavePath() {
  const pts: string[] = []
  for (let x = WAVE_X0; x <= WAVE_X1; x += 10) {
    const k = (2 * Math.PI * x) / WAVE_LEN
    const y = WAVE_AMP * Math.sin(k) + WAVE_AMP * 0.4 * Math.sin(2 * k + 1)
    pts.push(`${x} ${y.toFixed(2)}`)
  }
  return `M${pts.join(' L')} L${WAVE_X1} 1300 L${WAVE_X0} 1300 Z`
}

type Stage = 'hidden' | 'loading' | 'leaving'

export default function MilkLoader({ loading }: { loading: boolean }) {
  const [stage, setStage] = useState<Stage>('hidden')
  const shownAt = useRef(0)

  // 로딩이 SHOW_DELAY보다 길어질 때만 보인다
  useEffect(() => {
    if (!loading) return
    const t = window.setTimeout(() => {
      shownAt.current = performance.now()
      setStage('loading')
    }, SHOW_DELAY)
    return () => window.clearTimeout(t)
  }, [loading])

  // 실제 로딩(성공·실패 모두)이 끝나면 나갈 준비. 로더가 막 떴다면 최소 시간만 채운다
  useEffect(() => {
    if (loading || stage !== 'loading') return
    const wait = Math.max(0, MIN_SHOW - (performance.now() - shownAt.current))
    const t = window.setTimeout(() => setStage('leaving'), wait)
    return () => window.clearTimeout(t)
  }, [loading, stage])

  if (stage === 'hidden') return null
  return <Scene leaving={stage === 'leaving'} onDone={() => setStage('hidden')} />
}

function Scene({ leaving, onDone }: { leaving: boolean; onDone: () => void }) {
  const surface = useRef<SVGGElement>(null)
  const leaveAt = useRef<number | null>(null)
  const [fading, setFading] = useState(false)
  const reduce = useMemo(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches, [])

  useEffect(() => {
    if (!leaving) return
    if (leaveAt.current === null) leaveAt.current = performance.now()
    // 화면이 백그라운드라 프레임이 멈춰도 로더가 남지 않게, 빠지는 시간이 지나면 타이머로도 사라지게 한다
    const t = window.setTimeout(() => setFading(true), DRAIN_MS + 80)
    return () => window.clearTimeout(t)
  }, [leaving])

  // 수위·물결은 requestAnimationFrame 한 곳에서 계산한다(끝나는 순간의 수위에서 이어서 빠지게 하려고)
  useEffect(() => {
    const el = surface.current
    if (!el) return
    if (reduce) {
      el.setAttribute('transform', `translate(0 ${Y_STILL})`)
      return
    }
    const t0 = performance.now()
    let y = Y_FULL
    let from = Y_FULL
    let raf = 0
    let faded = false
    const tick = (now: number) => {
      if (leaveAt.current === null) {
        y = Y_FULL + (Y_HOLD - Y_FULL) * (1 - Math.exp(-(now - t0) / 1000 / TAU))
        from = y
      } else {
        const k = Math.min(1, (now - leaveAt.current) / DRAIN_MS)
        y = from + (Y_EMPTY - from) * k * k // 마지막 한 모금은 끝으로 갈수록 빠르게
        if (k >= 1 && !faded) {
          faded = true
          setFading(true)
        }
      }
      const phase = ((((now - t0) / 1000) / WAVE_SEC) % 1) * WAVE_LEN
      el.setAttribute('transform', `translate(${(-phase).toFixed(2)} ${y.toFixed(2)})`)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [reduce])

  // 모션 줄이기: 남은 우유를 빼는 연출 없이 바로 옅어지며 사라진다
  useEffect(() => {
    if (reduce && leaving) setFading(true)
  }, [reduce, leaving])

  useEffect(() => {
    if (!fading) return
    const t = window.setTimeout(onDone, reduce ? FADE_REDUCED_MS : FADE_MS)
    return () => window.clearTimeout(t)
  }, [fading, reduce, onDone])

  return (
    <div className={`milk-loader${fading ? ' milk-loader--out' : ''}${reduce ? ' milk-loader--calm' : ''}`} role="status" aria-live="polite">
      <MilkBottle className="milk-loader__bottle" surfaceRef={surface} />
      <p className="milk-loader__text">한 모금만 기다려 주세요</p>
    </div>
  )
}

/* 바나나우유 병 그림(로딩 화면·당겨서 새로고침이 같이 쓴다). 수위는 surfaceRef의 transform(y)으로 움직인다.
   한 화면에 여러 개가 있어도 마스크 id가 겹치지 않게 useId로 이름을 만든다. */
const WAVE_D = wavePath()
export function MilkBottle({ className, surfaceRef }: { className?: string; surfaceRef: Ref<SVGGElement> }) {
  const u = 'ml' + useId().replace(/:/g, '')
  const d = WAVE_D
  return (
  <svg className={className} viewBox="0 0 1000 1000" aria-hidden="true" focusable="false">
    <defs>
      <mask id={`${u}milk`} maskUnits="userSpaceOnUse" x="0" y="0" width="1000" height="1000">
        <g ref={surfaceRef} transform={`translate(0 ${Y_FULL})`}>
          <path d={d} fill="#fff" />
        </g>
      </mask>
      <clipPath id={`${u}lid`}>
        <rect x="0" y="0" width="1000" height="152" />
      </clipPath>
      <pattern id={`${u}stripe`} width="26" height="44" patternUnits="userSpaceOnUse" patternTransform="rotate(38)">
        <rect className="milk-loader__straw-base" width="26" height="44" />
        <rect className="milk-loader__straw-stripe" width="26" height="15" />
      </pattern>
      <g id={`${u}straw`}>
        <g transform="rotate(8.5 500 150)">
          <rect className="milk-loader__straw" x="487" y="14" width="26" height="858" rx="5" fill={`url(#${u}stripe)`} />
        </g>
      </g>
    </defs>

    <image href={shadowImg} x="267.9" y="799.8" width="524.8" height="111.7" preserveAspectRatio="none" />

    {/* 빈 병: 몸통·가운데 띠를 옅은 유리처럼 항상 보여서 우유가 줄어도 병 모양이 남는다 */}
    <g className="milk-loader__glass">
      <image href={bodyImg} x="215.7" y="208.5" width="565.5" height="685.5" preserveAspectRatio="none" />
      <image href={bandImg} x="215.7" y="515.1" width="566" height="155.6" preserveAspectRatio="none" />
    </g>

    {/* 빨대: 우유 뒤에 있다가 수위가 내려가면 드러난다 */}
    <use href={`#${u}straw`} />

    {/* 우유: 같은 몸통·띠 그림을 마스크로 수위만큼만 보여 준다(띠를 지날 때도 한 덩어리로 이어진다) */}
    <g mask={`url(#${u}milk)`}>
      <image href={bodyImg} x="215.7" y="208.5" width="565.5" height="685.5" preserveAspectRatio="none" />
      <image href={bandImg} x="215.7" y="515.1" width="566" height="155.6" preserveAspectRatio="none" />
    </g>

    <image href={glossImg} x="280.5" y="237.9" width="144.5" height="539.6" preserveAspectRatio="none" />
    <image href={capImg} x="342.6" y="121.9" width="314.6" height="123.4" preserveAspectRatio="none" />

    {/* 뚜껑 위로 나온 빨대 윗부분은 뚜껑 앞에 그려 뚜껑을 뚫고 나온 것처럼 보이게 한다 */}
    <g clipPath={`url(#${u}lid)`}>
      <use href={`#${u}straw`} />
    </g>
  </svg>
  )
}
