import { useCallback, useEffect, useRef, useState } from 'react'
import './OnsenIntro.css'

export type OnsenIntroProps = {
  onEnter?: () => void
}

function Swimmer() {
  return (
    <svg
      className="onsen-intro__swimmer-svg"
      viewBox="0 0 190 96"
      role="img"
      aria-label="물 위에 편안히 떠 있는 사람"
    >
      <path
        className="onsen-intro__skin"
        d="M95.5 30.5c5.8-5.1 13.1-7.4 19.5-5.2 5.1 1.8 7.5 7 4.5 11.7-3.7 5.9-13.1 7.3-19.7 3.7z"
      />
      <path
        className="onsen-intro__hair"
        d="M102.1 28.1c3.5-6.4 13.4-8.2 18.8-3.1 2.1 2 2.7 5.2 1.8 7.9-3.3-1.8-6.4-3.8-9.5-6.2-2.6 3.1-6.5 4.4-11.1 4.6z"
      />
      <path
        className="onsen-intro__skin"
        d="M102 39.7c-10.5 6.6-19.1 12.7-28 19.4l-8.3-8.5c9.8-7.9 19-14.8 30.4-20.7z"
      />
      <path
        className="onsen-intro__suit"
        d="M74.7 49.8c10.4-3 18.7-9.5 23.7-17.9 5.2 3.3 9.4 7.4 13.1 12.5-7.5 11.2-17.4 19.5-30.2 23.9-5.8-2.8-8-10-6.6-18.5z"
      />
      <path
        className="onsen-intro__skin"
        d="M109.4 42.1c12.1 4.7 22 11 31.8 19.4l-5.7 6.1c-10-6-20.2-11.3-31.5-14.9z"
      />
      <path
        className="onsen-intro__skin"
        d="M139.1 60.3c7 1.9 13.6 5.1 19.5 9.6 1.7 1.3.1 4-1.9 3.2l-21.4-6.4z"
      />
      <path
        className="onsen-intro__suit-dark"
        d="M82.4 66.5c-5.7 10.7-12.2 19.2-21.4 26.9l-7.7-4.6c5.6-10.3 10.2-20.5 13.5-31.8z"
      />
      <path
        className="onsen-intro__skin"
        d="M65.6 58.8C54.4 55.7 42.8 52.9 31 51.9l-1.1-5.5c13.1-1.3 26.4-.3 39.4 3.2z"
      />
      <path
        className="onsen-intro__skin"
        d="M32.7 46.3c-5.4-2.5-11.1-3.8-17.1-3.8-2.1 0-2.7 2.8-.8 3.6 5 2.1 10 3.9 15.2 5.7z"
      />
      <path
        className="onsen-intro__suit-dark"
        d="M68.2 75.4c-4.8 6.9-10.9 12.9-18.3 17.8-4.4 2.9-8.3-3-4.7-6.1 6-5.2 11.2-11.1 15.6-17.8z"
      />
      <path
        className="onsen-intro__highlight"
        d="M91.4 39.2c4.8 5 8.4 10.4 10.4 16.3-5.7 4.7-12.5 8.5-20.5 11.1-4.1-2.7-6-7.2-5.8-13.4 6.1-3.6 11.3-8.3 15.9-14z"
      />
    </svg>
  )
}

export default function OnsenIntro({ onEnter }: OnsenIntroProps) {
  const surfaceRef = useRef<HTMLDivElement>(null)
  const pointerLayerRef = useRef<HTMLDivElement>(null)
  const lastRippleRef = useRef(0)
  const enterTimerRef = useRef<number | null>(null)
  const [isEntering, setIsEntering] = useState(false)

  const createPointerRipple = useCallback((x: number, y: number) => {
    const layer = pointerLayerRef.current
    if (!layer) return

    const ripple = document.createElement('span')
    ripple.className = 'onsen-intro__pointer-ripple'
    ripple.style.left = `${x}px`
    ripple.style.top = `${y}px`
    ripple.style.setProperty('--ripple-tilt', `${Math.round(Math.random() * 18 - 9)}deg`)
    layer.appendChild(ripple)
    ripple.addEventListener('animationend', () => ripple.remove(), { once: true })
  }, [])

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.pointerType === 'touch' || isEntering) return
      const now = performance.now()
      if (now - lastRippleRef.current < 170) return
      lastRippleRef.current = now

      const bounds = surfaceRef.current?.getBoundingClientRect()
      if (bounds) createPointerRipple(event.clientX - bounds.left, event.clientY - bounds.top)
    },
    [createPointerRipple, isEntering],
  )

  const handleEnter = useCallback(() => {
    if (isEntering) return
    setIsEntering(true)
    enterTimerRef.current = window.setTimeout(() => onEnter?.(), 1450)
  }, [isEntering, onEnter])

  useEffect(
    () => () => {
      if (enterTimerRef.current) window.clearTimeout(enterTimerRef.current)
    },
    [],
  )

  return (
    <main
      ref={surfaceRef}
      className={`onsen-intro${isEntering ? ' onsen-intro--entering' : ''}`}
      onPointerMove={handlePointerMove}
    >
      <div className="onsen-intro__upper-water" aria-hidden="true">
        <svg viewBox="0 0 1440 200" preserveAspectRatio="none">
          <path d="M0 132C254 80 515 76 720 89c267 17 452 0 720 56V0H0Z" />
        </svg>
      </div>

      <div ref={pointerLayerRef} className="onsen-intro__pointer-layer" aria-hidden="true" />

      <div className="onsen-intro__figure-zone">
        <div className="onsen-intro__organic-ripples" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div className="onsen-intro__shadow" aria-hidden="true">
          <svg viewBox="0 0 190 96">
            <path d="M13 44c19-4 40-3 56 5 9 5 14 7 27 4 15-3 27-1 36 5 10 7 22 12 40 15-20 3-37 1-51-6-12-6-21-6-33-1-18 8-38 12-62 10 12-8 20-18 24-28-12-4-24-5-37-4Z" />
          </svg>
        </div>
        <div className="onsen-intro__swimmer">
          <Swimmer />
        </div>
      </div>

      <section className="onsen-intro__content" aria-labelledby="onsen-intro-title">
        <p className="onsen-intro__eyebrow">나를 위한 온천 여행</p>
        <h1 id="onsen-intro-title">잠시, 쉬어가도 괜찮아요.</h1>
        <p className="onsen-intro__description">
          아직 만나지 못한 따뜻한 곳,
          <br />
          한국의 온천을 찾아서.
        </p>
        <button
          className="onsen-intro__cta"
          type="button"
          onClick={handleEnter}
          disabled={isEntering}
        >
          <span>온천 찾아보기</span>
          <span className="onsen-intro__arrow" aria-hidden="true">
            →
          </span>
        </button>
      </section>

      <div className="onsen-intro__transition" aria-hidden="true">
        <span className="onsen-intro__transition-ring" />
        <span className="onsen-intro__transition-fill" />
      </div>
      <p className="onsen-intro__status" aria-live="polite">
        {isEntering ? '온천을 찾으러 이동합니다.' : ''}
      </p>
    </main>
  )
}
