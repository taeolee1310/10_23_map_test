import { useEffect, useRef, useState, type CSSProperties } from 'react'
import OnsenLogo from '../OnsenLogo'
import './OnsenIntro.css'

export type OnsenIntroProps = {
  onEnter?: () => void
}

const LEAVE_MS = 700 // 눌렀을 때 화면이 천천히 옅어지는 시간 (CSS의 --intro-leave와 같게)

// 요소마다 나타나는 시점을 CSS 변수로 넘긴다
const at = (ms: number) => ({ '--d': `${ms}ms` }) as CSSProperties

/* -------------------------------------------------------------------------- */
/*  수면의 잔물결: 가만히 있어도 안쪽에서 바깥으로 끝없이 퍼져 나가는 자동 무한 루프      */
/* -------------------------------------------------------------------------- */

// 물결은 등비수열로 놓인다(한 칸 = 가로 R배: 1배·2배·4배·8배…). 한 칸만큼 퍼지면 처음과 똑같은 모습이라 이음매가 보이지 않는다.
//   시간 t(초)에서 가중치 phase = -t * SPEED. 소수부 f만 화면에 쓰고, 정수부는 몇 바퀴 돌았는지일 뿐이다.
//   각 물결의 위치는 u = (칸 번호) - f. 바깥 끝(u가 큰 쪽)에서는 투명하게 사라지고, 안쪽 끝에서는 투명에서 짙어지며 생긴다.
//   (선형 보간 = 툭 튀어나오지 않는다)
const RING_COUNT = 5 // 보이는 칸 수 (실제로는 하나 더 그려서 들락날락하게 한다)
const W0 = 14 // 가장 안쪽 물결의 가로 너비(vmax)
const R = 2 // 한 칸마다 커지는 배율 (2배 간격)
const A0 = 0.32 // 가장 안쪽 물결의 선 진하기
const DECAY = 0.7 // 바깥으로 갈수록 옅어지는 비율
const SPEED = 0.05 // 퍼져 나가는 속도(칸/초). 약 20초에 한 칸. 바깥으로 아주 천천히
const PAINT_MS = 50 // 다시 그리는 간격(초당 20번). 느린 움직임이라 이 정도면 매끄럽고, 필터 계산을 아낀다

// 울렁임(SVG 필터): 시간에 따라 노이즈의 결과 세기가 미세하게 변한다
const WIGGLE_BASE = { x: 0.006, y: 0.011 } // feTurbulence baseFrequency 중심값 (작을수록 큼직하게 일렁)
const WIGGLE_SWING = { x: 0.0025, y: 0.003 } // 중심값 주변을 오가는 폭
const WIGGLE_SCALE = 11 // feDisplacementMap scale 중심값(px)
const WIGGLE_SCALE_SWING = 5

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
const smooth = (x: number) => x * x * (3 - 2 * x)

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() => (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) || false)
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!mq) return
    const update = () => setReduced(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])
  return reduced
}

/** 물결 겹 전체 + 울렁임 필터. 자기 상태(phase)만 다시 그리므로 캐릭터 쪽은 다시 그려지지 않는다. */
function RippleField() {
  const reduced = usePrefersReducedMotion()
  const [phase, setPhase] = useState(0) // 퍼져 나간 양(칸). 음수 = 바깥으로
  const turbulenceRef = useRef<SVGFETurbulenceElement>(null)
  const displaceRef = useRef<SVGFEDisplacementMapElement>(null)

  useEffect(() => {
    if (reduced) {
      // 모션 감소: 물결도 울렁임도 멈춘 채 처음 모습 그대로 둔다
      setPhase(0)
      return
    }
    const start = performance.now()
    let raf = 0
    let lastPaint = -PAINT_MS
    const tick = (now: number) => {
      const t = (now - start) / 1000
      if (now - lastPaint >= PAINT_MS) {
        lastPaint = now
        setPhase(-t * SPEED)
        // 물결 선이 스스로 넘실거리도록 노이즈 값을 천천히 바꾼다(상태를 거치지 않고 필터에 직접)
        turbulenceRef.current?.setAttribute(
          'baseFrequency',
          `${(WIGGLE_BASE.x + WIGGLE_SWING.x * Math.sin(t * 0.35)).toFixed(5)} ${(WIGGLE_BASE.y + WIGGLE_SWING.y * Math.cos(t * 0.27)).toFixed(5)}`,
        )
        displaceRef.current?.setAttribute('scale', (WIGGLE_SCALE + WIGGLE_SCALE_SWING * Math.sin(t * 0.5)).toFixed(2))
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [reduced])

  const f = phase - Math.floor(phase) // 0 ≤ f < 1
  const rings = Array.from({ length: RING_COUNT + 1 }, (_, i) => {
    const u = i - f
    const width = W0 * Math.pow(R, u)
    // 안쪽 끝(u<0)에서는 막 생겨나고, 바깥 끝(u>RING_COUNT-1)에서는 사라진다
    const fade = smooth(clamp01(u + 1)) * smooth(clamp01(RING_COUNT - u))
    return { key: i, width, alpha: A0 * Math.pow(DECAY, u) * fade }
  })

  return (
    <>
      {/* 울렁임 필터. 화면에는 그려지지 않고 CSS의 filter: url(#wave-distortion)로만 쓰인다 */}
      <svg className="onsen-intro__defs" width="0" height="0" aria-hidden="true" focusable="false">
        <defs>
          <filter id="wave-distortion" x="-5%" y="-5%" width="110%" height="110%" colorInterpolationFilters="sRGB">
            <feTurbulence ref={turbulenceRef} type="fractalNoise" baseFrequency={`${WIGGLE_BASE.x} ${WIGGLE_BASE.y}`} numOctaves={1} seed={7} result="noise" />
            <feDisplacementMap ref={displaceRef} in="SourceGraphic" in2="noise" scale={WIGGLE_SCALE} xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </defs>
      </svg>
      <div className="onsen-intro__rings">
        {rings.map((r) => (
          <span
            key={r.key}
            className="onsen-intro__ring"
            style={{ '--w': `${r.width.toFixed(2)}vmax`, '--a': r.alpha.toFixed(4) } as CSSProperties}
          />
        ))}
      </div>
    </>
  )
}

/**
 * 인트로: 소개 화면이 아니라 '온천 수면 위에 조용히 떠 있는 한 장면'.
 * 화면 전체가 수면이고, 작은 캐릭터 하나가 중앙 아래쪽에 놓인다. 잔물결은 아주 옅고 넓게.
 * 움직임은 들어올 때 한 번, 10초 동안(캐릭터가 따뜻함에 몸을 맡기고, 수면에 파장이 한 번 퍼진다). 그 뒤엔 고요하게 멈춘다.
 * 잔물결은 켜지자마자 안쪽에서 바깥으로 끝없이 퍼져 나가고(자동 무한 루프), 선 자체도 필터로 천천히 넘실거린다.
 * 캐릭터는 그 영향을 받지 않는다. 모션 감소 설정에서는 물결과 울렁임이 모두 멈춘다.
 */
export default function OnsenIntro({ onEnter }: OnsenIntroProps) {
  const [isLeaving, setIsLeaving] = useState(false)
  const [sceneRun, setSceneRun] = useState(0) // 캐릭터에 마우스를 올리면 한 번 더
  const timerRef = useRef<number | null>(null)

  const handleEnter = () => {
    if (isLeaving) return
    setIsLeaving(true)
    timerRef.current = window.setTimeout(() => onEnter?.(), LEAVE_MS)
  }

  useEffect(
    () => () => {
      if (timerRef.current) window.clearTimeout(timerRef.current)
    },
    [],
  )

  return (
    <main
      className={`onsen-intro${isLeaving ? ' onsen-intro--leaving' : ''}`}
      aria-labelledby="onsen-intro-title"
    >
      {/* 수면: 화면 전체. 캐릭터가 있는 곳을 중심으로 옅은 잔물결이 넓게 퍼진다 */}
      <div className="onsen-intro__water" aria-hidden="true">
        <RippleField />
        <span className="onsen-intro__ring onsen-intro__ring--pulse" />
      </div>

      <div className="onsen-intro__scene" onMouseEnter={() => setSceneRun((n) => n + 1)}>
        <OnsenLogo height="var(--intro-scene-h)" title="온천에 몸을 담근 탕방 캐릭터" cycle={10} delay={1500} playKey={sceneRun} calm />
      </div>

      <header className="onsen-intro__bar onsen-intro__reveal" style={at(300)}>
        <OnsenLogo className="onsen-intro__mark" height={26} autoPlay={false} calm />
        <span className="onsen-intro__wordmark">탕방</span>
      </header>

      <div className="onsen-intro__copy">
        <h1 id="onsen-intro-title" className="onsen-intro__reveal" style={at(1200)}>
          오늘은,
          <br />
          따뜻한 곳으로.
        </h1>
        <p className="onsen-intro__sub onsen-intro__reveal" style={at(1700)}>
          아직 몰랐던 온천을 찾아서.
        </p>
        <button className="onsen-intro__link onsen-intro__reveal" style={at(2200)} type="button" onClick={handleEnter} disabled={isLeaving}>
          <span>온천 찾아보기</span>
          <span className="onsen-intro__arrow" aria-hidden="true">
            →
          </span>
        </button>
      </div>

      <p className="onsen-intro__status" aria-live="polite">
        {isLeaving ? '온천 찾기 화면으로 이동합니다.' : ''}
      </p>
    </main>
  )
}
