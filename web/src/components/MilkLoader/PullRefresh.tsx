import { useEffect, useRef, useState } from 'react'
import { MilkBottle, WAVE_LEN, WAVE_SEC, Y_EMPTY, Y_FULL, Y_HOLD } from './MilkLoader'

/* 모바일 '당겨서 새로고침'. 브라우저 기본 새로고침(동그란 화살표)은 막고(MainScreen.css의 overscroll-behavior),
   같은 자리·같은 크기(44px 원)에 바나나우유 병을 띄운다.
   - 당기는 동안: 병이 손가락을 따라 내려오고, 당긴 만큼 우유가 차오른다(다 차면 놓았을 때 새로고침)
   - 새로고침 중: 로딩 화면처럼 빨대로 마시듯 수위가 내려간다
   페이지를 다시 열면 인트로부터 다시 보게 되므로, 화면은 그대로 두고 목록 데이터만 다시 불러온다(onRefresh). */

const TRIGGER = 72 // 이만큼 당기면(저항 적용 뒤) 놓았을 때 새로고침
const MAX = 120 // 이보다 더 내려가지 않는다
const REST = 56 // 새로고침하는 동안 병이 머무는 위치
const MIN_SPIN = 700 // 너무 빨리 끝나도 이만큼은 보여 준다
// 당겨도 새로고침을 시작하지 않는 곳: 지도(끌어서 움직임), 상세·전체 지도, 열린 창
const IGNORE = '.mapcard, #detail, .d-full, [role="dialog"], [aria-modal="true"]'

export default function PullRefresh({ scrollerId, onRefresh }: { scrollerId: string; onRefresh: () => Promise<unknown> }) {
  const [pull, setPull] = useState(0) // 지금 내려온 거리(px)
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const surface = useRef<SVGGElement>(null)
  const live = useRef({ busy, onRefresh })
  live.current = { busy, onRefresh }
  const reduce = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

  // 손가락 따라가기. 세로로 당길 때 페이지가 같이 움직이지 않도록 passive: false로 단다
  useEffect(() => {
    const el = document.getElementById(scrollerId)
    if (!el) return
    let g: { y: number; x: number; mode: '' | 'pull' | 'skip'; d: number } | null = null
    const start = (e: TouchEvent) => {
      const t = e.target as Element | null
      if (live.current.busy || e.touches.length > 1 || el.scrollTop > 0 || t?.closest(IGNORE)) return (g = null)
      g = { y: e.touches[0].clientY, x: e.touches[0].clientX, mode: '', d: 0 }
    }
    const move = (e: TouchEvent) => {
      if (!g) return
      const dy = e.touches[0].clientY - g.y
      const dx = e.touches[0].clientX - g.x
      if (!g.mode) {
        if (Math.abs(dy) < 6 && Math.abs(dx) < 6) return
        g.mode = dy > 0 && dy > Math.abs(dx) && el.scrollTop <= 0 ? 'pull' : 'skip'
        if (g.mode === 'pull') setDragging(true)
      }
      if (g.mode !== 'pull') return
      e.preventDefault()
      // 고무줄처럼 갈수록 덜 내려온다
      g.d = Math.min(MAX, Math.max(0, dy) * 0.5)
      setPull(g.d)
    }
    const end = () => {
      const s = g
      g = null
      if (!s || s.mode !== 'pull') return
      setDragging(false)
      if (s.d < TRIGGER) return setPull(0)
      setPull(REST)
      setBusy(true)
      const t0 = performance.now()
      Promise.resolve(live.current.onRefresh())
        .catch(() => undefined)
        .then(() => new Promise((r) => window.setTimeout(r, Math.max(0, MIN_SPIN - (performance.now() - t0)))))
        .then(() => {
          setBusy(false)
          setPull(0)
        })
    }
    el.addEventListener('touchstart', start, { passive: true })
    el.addEventListener('touchmove', move, { passive: false })
    el.addEventListener('touchend', end)
    el.addEventListener('touchcancel', end)
    return () => {
      el.removeEventListener('touchstart', start)
      el.removeEventListener('touchmove', move)
      el.removeEventListener('touchend', end)
      el.removeEventListener('touchcancel', end)
    }
  }, [scrollerId])

  // 당기는 동안: 당긴 비율만큼 우유가 찬다
  useEffect(() => {
    if (busy || !surface.current) return
    const k = Math.min(1, pull / TRIGGER)
    surface.current.setAttribute('transform', `translate(0 ${(Y_EMPTY - (Y_EMPTY - Y_FULL) * k).toFixed(1)})`)
  }, [pull, busy])

  // 새로고침 중: 가득 찬 병에서 빨대로 마시듯 내려가며 물결이 흐른다(모션 줄이기면 멈춘 채로 둔다)
  useEffect(() => {
    const el = surface.current
    if (!busy || !el || reduce) return
    const t0 = performance.now()
    let raf = 0
    const tick = (now: number) => {
      const t = (now - t0) / 1000
      const y = Y_FULL + (Y_HOLD - Y_FULL) * (1 - Math.exp(-t / 0.9))
      const phase = ((t / WAVE_SEC) % 1) * WAVE_LEN
      el.setAttribute('transform', `translate(${(-phase).toFixed(1)} ${y.toFixed(1)})`)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [busy, reduce])

  const shown = pull > 0 || busy
  return (
    <div
      className={`ptr${dragging ? ' ptr--drag' : ''}${pull >= TRIGGER || busy ? ' ptr--ready' : ''}`}
      style={{ transform: `translate(-50%, ${pull - 52}px)`, opacity: shown ? Math.min(1, pull / 32) : 0 }}
      role="status"
      aria-live="polite"
    >
      <MilkBottle className="ptr__bottle" surfaceRef={surface} />
      <span className="sr">{busy ? '목록을 새로 불러오는 중' : ''}</span>
    </div>
  )
}
