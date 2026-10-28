import { useEffect, useRef, useState } from 'react'
import sceneUrl from '../../assets/bathhouse/scene.webp'
import stripUrl from '../../assets/bathhouse/stream-strip.png'
import SideRays from '../SideRays'
import { CANVAS_BOX, createWaterfall, LOOP_SECONDS } from './waterfall'
import './BathhouseIntro.css'

export type BathhouseIntroProps = {
  onEnter?: () => void
}

const STAGE_W = 1536 // Figma 원본 크기
const LEAVE_MS = 700 // 눌렀을 때 화면이 천천히 옅어지는 시간 (CSS의 --leave와 같게)
const FRAME_MS = 1000 / 30 // 물줄기는 초당 30번 그린다

/**
 * 인트로: Figma 'Bathhouse_Motion_v2'(381:2)의 일러스트를 그대로 깔고,
 * 오른쪽 출수구 물줄기(Canvas)와 해에서 비치는 빛(SideRays)만 움직인다. 마우스에는 반응하지 않는다.
 */
export default function BathhouseIntro({ onEnter }: BathhouseIntroProps) {
  const [isLeaving, setIsLeaving] = useState(false)
  const timerRef = useRef<number | null>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

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

  useEffect(() => {
    const stage = stageRef.current
    const canvas = canvasRef.current
    if (!stage || !canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    let dead = false
    let raf = 0
    let k = 1 // 원본 1px당 캔버스 픽셀 수
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const fit = () => {
      const w = stage.getBoundingClientRect().width
      k = Math.max(1, (w / STAGE_W) * Math.min(window.devicePixelRatio || 1, 2))
      canvas.width = Math.round(CANVAS_BOX.w * k)
      canvas.height = Math.round(CANVAS_BOX.h * k)
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(stage)

    const strip = new Image()
    strip.src = stripUrl
    strip
      .decode()
      .then(() => {
        if (dead) return
        const c = document.createElement('canvas')
        c.width = strip.naturalWidth
        c.height = strip.naturalHeight
        const sctx = c.getContext('2d')!
        sctx.drawImage(strip, 0, 0)
        const fall = createWaterfall(sctx.getImageData(0, 0, c.width, c.height))
        if (reduce) {
          fall.draw(ctx, 0, k) // 모션 줄이기: 멈춘 한 컷
          return
        }
        const t0 = performance.now()
        let last = -FRAME_MS
        const tick = (now: number) => {
          raf = requestAnimationFrame(tick)
          if (now - last < FRAME_MS) return
          last = now
          fall.draw(ctx, ((now - t0) / 1000) % LOOP_SECONDS, k)
        }
        raf = requestAnimationFrame(tick)
      })
      .catch(() => {})

    return () => {
      dead = true
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [])

  return (
    <main className={`bh${isLeaving ? ' bh--leaving' : ''}`} aria-labelledby="bh-title">
      <div className="bh__stage" ref={stageRef} aria-hidden="true">
        <img className="bh__scene" src={sceneUrl} alt="" draggable={false} />
        <canvas className="bh__fall" ref={canvasRef} />
        {/* 해(1170, 278)에서 창 아래로 비치는 따뜻한 노을빛 */}
        <div className="bh__rays">
          <SideRays
            origin="top-right"
            source={[0.789, 0.385]}
            rayColor1="#ffb36b"
            rayColor2="#ff9a78"
            blend={0.4}
            intensity={1.8}
            spread={2.6}
            density={3}
            sharpness={0.2}
            falloff={1.5}
            glow={0.25}
            saturation={0.9}
            dust={0.5}
            speed={1.2}
            followMouse={false}
          />
        </div>
      </div>

      <div className="bh__scrim" aria-hidden="true" />

      <div className="bh__copy">
        <p className="bh__brand">탕방</p>
        <h1 id="bh-title">
          오늘은,
          <br />
          따뜻한 곳으로.
        </h1>
        <p className="bh__sub">서울의 온천·목욕탕을 찾아서.</p>
        <button className="bh__link" type="button" onClick={handleEnter} disabled={isLeaving}>
          <span>목욕탕 찾아보기</span>
          <span aria-hidden="true">→</span>
        </button>
      </div>

      <p className="bh__status" aria-live="polite">
        {isLeaving ? '목욕탕 찾기 화면으로 이동합니다.' : ''}
      </p>
    </main>
  )
}
