import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import './Onboarding.css'

export type TourStep = {
  /** 밝게 비출 곳(CSS 선택자). 화면에 없으면 이 단계는 건너뛴다 */
  target: string
  title: string
  body: string
  /** 눌러서 바로 해 볼 수 있는 동작. 있으면 주 버튼이 이 동작을 한 뒤 다음 단계로 넘어간다 */
  action?: { label: string; run: () => void }
  /** 이 단계로 들어올 때 부른다(비출 대상이 있도록 화면 상태를 맞춘다) */
  onEnter?: () => void
  /** 이 단계에서 반짝여 눈에 띄게 할 곳(CSS 선택자). 단계가 끝나면 효과를 거둔다 */
  pulse?: string
}

type Props = {
  steps: TourStep[]
  open: boolean
  /** finished: 끝까지 봤으면 true, 건너뛰거나 닫았으면 false */
  onClose: (finished: boolean) => void
}

type Box = { top: number; left: number; width: number; height: number }

const PAD = 8 // 비추는 구멍이 대상보다 조금 넓게
const GAP = 12 // 구멍과 설명 카드 사이
const EDGE = 12 // 화면 가장자리 여백

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

// 화면을 어둡게 덮고(오패시티) 대상만 밝게 비추는(스포트라이트) 안내. 대상 아래·위에 설명 카드를 놓는다.
export default function Onboarding({ steps, open, onClose }: Props) {
  const [i, setI] = useState(0)
  const [box, setBox] = useState<Box | null>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const primaryRef = useRef<HTMLButtonElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const raf = useRef(0)
  const step = steps[i]
  const last = i === steps.length - 1

  const stepRef = useRef(step)
  stepRef.current = step

  const measure = useCallback(() => {
    const el = stepRef.current ? document.querySelector<HTMLElement>(stepRef.current.target) : null
    if (!el) return false
    const r = el.getBoundingClientRect()
    setBox({ top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 })
    return true
  }, [])

  // 열릴 때: 처음 단계로, 열기 전 포커스를 기억한다
  useEffect(() => {
    if (!open) return
    setI(0)
    setBox(null)
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    return () => {
      returnFocus.current?.focus?.()
    }
  }, [open])

  const next = useCallback(() => {
    if (i >= steps.length - 1) onClose(true)
    else setI(i + 1)
  }, [i, steps.length, onClose])

  // 단계가 바뀔 때: 필요한 화면 상태를 만들고, 대상을 화면 가운데로 가져와 비춘다
  useEffect(() => {
    if (!open || !step) return
    step.onEnter?.()
    const timers: number[] = []
    const applyPulse = () => {
      if (step.pulse) document.querySelector(step.pulse)?.classList.add('tour-pulse')
    }
    timers.push(
      window.setTimeout(() => {
        const el = document.querySelector<HTMLElement>(step.target)
        if (!el) {
          next() // 비출 대상이 없으면 이 단계는 건너뛴다
          return
        }
        el.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' })
        measure()
        applyPulse()
      }, 120),
    )
    // 스크롤·화면 전환이 끝난 뒤 위치를 다시 맞춘다
    timers.push(window.setTimeout(() => { measure(); applyPulse() }, 500), window.setTimeout(measure, 900))
    return () => {
      timers.forEach((t) => window.clearTimeout(t))
      document.querySelectorAll('.tour-pulse').forEach((e) => e.classList.remove('tour-pulse'))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, i])

  // 창 크기·스크롤이 바뀌면 구멍 위치를 다시 맞춘다
  useEffect(() => {
    if (!open) return
    const on = () => {
      cancelAnimationFrame(raf.current)
      raf.current = requestAnimationFrame(measure)
    }
    window.addEventListener('resize', on)
    window.addEventListener('scroll', on, true)
    return () => {
      window.removeEventListener('resize', on)
      window.removeEventListener('scroll', on, true)
      cancelAnimationFrame(raf.current)
    }
  }, [open, measure])

  // 설명 카드 위치: 대상 아래, 자리가 없으면 위, 그래도 없으면 화면 아래
  useLayoutEffect(() => {
    const card = cardRef.current
    if (!open || !box || !card) return
    const w = card.offsetWidth
    const h = card.offsetHeight
    const vw = window.innerWidth
    const vh = window.innerHeight
    let top = box.top + box.height + GAP
    if (top + h > vh - EDGE) {
      const above = box.top - GAP - h
      top = above >= EDGE ? above : Math.max(EDGE, vh - h - EDGE)
    }
    const left = Math.min(Math.max(EDGE + 4, box.left), vw - w - (EDGE + 4))
    setPos({ top, left })
  }, [open, box, i])

  // 단계가 바뀌면 주 버튼으로 포커스, Esc로 닫기, Tab은 카드 안에서만 돈다
  useEffect(() => {
    if (open) primaryRef.current?.focus()
  }, [open, i])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose(false)
        return
      }
      if (e.key !== 'Tab' || !cardRef.current) return
      const items = [...cardRef.current.querySelectorAll<HTMLElement>('button:not(:disabled)')]
      if (!items.length) return
      const first = items[0]
      const lastEl = items[items.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        lastEl.focus()
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open || !step) return null

  // 대상을 아직 못 찾았으면 화면 가운데의 점으로 비춰, 전체를 어둡게만 보여 준다
  const spot: Box = box ?? { top: window.innerHeight / 2, left: window.innerWidth / 2, width: 0, height: 0 }

  return createPortal(
    <div className="tour">
      <div className="tour__shield" aria-hidden="true" />
      <div className="tour__spot" aria-hidden="true" style={{ top: spot.top, left: spot.left, width: spot.width, height: spot.height }} />
      <div
        ref={cardRef}
        className="tour__card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        style={pos ? { top: pos.top, left: pos.left } : { top: -9999, left: -9999 }}
      >
        <div aria-live="polite" className="tour__text">
          <p className="tour__step">{i + 1} / {steps.length}</p>
          <h2 className="tour__title" id="tour-title">{step.title}</h2>
          <p className="tour__body" id="tour-body">{step.body}</p>
        </div>
        <ol className="tour__dots" aria-hidden="true">
          {steps.map((s, k) => (
            <li key={s.title} className={k === i ? 'on' : ''} />
          ))}
        </ol>
        <div className="tour__actions">
          <button type="button" className="tour__skip" onClick={() => onClose(false)}>
            건너뛰기
          </button>
          {step.action ? (
            <>
              <button type="button" className="tour__btn tour__btn--outline" onClick={next}>
                {last ? '닫기' : '다음에'}
              </button>
              <button
                type="button"
                ref={primaryRef}
                className="tour__btn tour__btn--primary"
                onClick={() => {
                  step.action?.run()
                  next()
                }}
              >
                {step.action.label}
              </button>
            </>
          ) : (
            <>
              {i > 0 && (
                <button type="button" className="tour__btn tour__btn--outline" onClick={() => setI(i - 1)}>
                  이전
                </button>
              )}
              <button type="button" ref={primaryRef} className="tour__btn tour__btn--primary" onClick={next}>
                {last ? '확인했어요' : '다음'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
