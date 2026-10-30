// React Bits의 GlideSelect(JavaScript + CSS)를 TypeScript로 옮긴 것. 동작은 원본 그대로다.
// 다른 점: ① 아이콘(화살표·체크)을 @hugeicons 패키지 대신 같은 모양의 인라인 SVG로 그려서 패키지를 새로 설치하지 않는다.
// ② maxMenuHeight: 항목이 많을 때 메뉴 안에서 스크롤한다(고른 항목을 가운데로, 키보드로 옮기면 보이는 곳까지 따라 스크롤,
//    화면에 남은 공간만큼만 높이를 줄인다). 터치에서는 스크롤과 탭을 구분해 탭으로 고른다.
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import './GlideSelect.css'

type Size = 'sm' | 'md' | 'lg'
export type GlideOption = { value: string; label: ReactNode; tag?: string }

const SIZES: Record<Size, { chip: number; row: number; font: number }> = {
  sm: { chip: 28, row: 26, font: 12 },
  md: { chip: 32, row: 30, font: 13 },
  lg: { chip: 44, row: 40, font: 14 },
}
const PAD = 4
const GAP = 1
const MENU_GAP = 6
const DEFAULT_OPTIONS = ['One', 'Two', 'Three']

const norm = (o: string | GlideOption): GlideOption => (typeof o === 'string' ? { value: o, label: o } : o)
const textOf = (it: GlideOption) => (typeof it.label === 'string' ? it.label : it.value)
const typeaheadIndex = (items: GlideOption[], from: number, ch: string) => {
  const c = ch.toLowerCase()
  const n = items.length
  for (let k = 1; k <= n; k++) {
    const i = (from + k) % n
    if (textOf(items[i]).toLowerCase().startsWith(c)) return i
  }
  return from
}

const ChevronIcon = ({ size }: { size: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M6 9l6 6 6-6" />
  </svg>
)
const TickIcon = ({ size }: { size: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 13l4.5 4.5L19 7" />
  </svg>
)

export type GlideSelectProps = {
  options?: (string | GlideOption)[]
  value?: string
  defaultValue?: string
  onChange?: (value: string, option: GlideOption) => void
  placeholder?: string
  showTags?: boolean
  accentColor?: string
  surfaceColor?: string
  highlightColor?: string
  textColor?: string
  size?: Size
  radius?: number
  menuWidth?: number
  placement?: 'top' | 'bottom'
  align?: 'left' | 'right'
  popDuration?: number
  glideDuration?: number
  rememberPosition?: boolean
  /** 메뉴 최대 높이(px). 넘치면 메뉴 안에서 스크롤한다. 없으면 항목이 모두 보인다 */
  maxMenuHeight?: number
  disabled?: boolean
  ariaLabel?: string
  className?: string
}

type Phase = 'closed' | 'open' | 'closing'

export default function GlideSelect({
  options = DEFAULT_OPTIONS,
  value,
  defaultValue,
  onChange,
  placeholder = 'Select…',
  showTags = true,
  accentColor = '#f5f5f5',
  surfaceColor = '#27272a',
  highlightColor = '#3f3f46',
  textColor = '#f5f5f5',
  size = 'md',
  radius = 10,
  menuWidth = 176,
  placement = 'bottom',
  align = 'left',
  popDuration = 180,
  glideDuration = 220,
  rememberPosition = true,
  maxMenuHeight,
  disabled = false,
  ariaLabel = 'Select',
  className = '',
}: GlideSelectProps) {
  const items = options.map(norm)
  const [inner, setInner] = useState(defaultValue ?? '')
  const current = value ?? inner
  const selected = items.findIndex((it) => it.value === current)
  const [phase, setPhase] = useState<Phase>('closed')
  const [active, setActive] = useState<number | null>(null)
  const [side, setSide] = useState<'top' | 'bottom'>(placement)
  const [edge, setEdge] = useState<'left' | 'right'>(align)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const pillRef = useRef<HTMLSpanElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const tap = useRef<{ id: number; x: number; y: number; t: number } | null>(null)
  const instant = useRef(false)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const scrub = useRef<{ id: number; top: number } | null>(null)
  const id = useId()
  const S = SIZES[size] ?? SIZES.md
  const step = S.row + GAP
  const popOut = Math.round((popDuration * 2) / 3)

  useLayoutEffect(() => {
    if (phase !== 'open') return
    const el = menuRef.current
    const root = rootRef.current
    if (!el || !root) return
    const r = root.getBoundingClientRect()
    const list = listRef.current
    let nextSide: 'top' | 'bottom' = placement
    if (maxMenuHeight && list) {
      // 항목이 많으면: 화면에 남은 공간이 넉넉한 쪽으로 열고, 그 공간만큼만 높이를 준다
      const want = Math.min(list.scrollHeight + 2 * PAD, maxMenuHeight)
      const below = window.innerHeight - r.bottom - MENU_GAP - 12
      const above = r.top - MENU_GAP - 12
      nextSide = placement === 'bottom' ? (below >= want || below >= above ? 'bottom' : 'top') : above >= want || above >= below ? 'top' : 'bottom'
      const room = nextSide === 'bottom' ? below : above
      el.style.setProperty('--gs-menu-max', `${Math.max(96, Math.min(want, room))}px`)
      if (selected >= 0) list.scrollTop = Math.max(0, selected * step - (list.clientHeight - S.row) / 2) // 고른 항목을 가운데로
    } else {
      const need = el.offsetHeight + MENU_GAP
      nextSide = placement === 'bottom' && r.bottom + need > window.innerHeight ? 'top' : placement === 'top' && r.top - need < 0 ? 'bottom' : placement
    }
    setSide(nextSide)
    // 가로: 기준 모서리로 열었을 때 화면 밖으로 나가면 반대 모서리에 맞춘다
    const menuW = Math.max(el.offsetWidth, r.width)
    const fitsLeft = r.left + menuW <= window.innerWidth - 8
    const fitsRight = r.right - menuW >= 8
    setEdge(align === 'left' ? (fitsLeft || !fitsRight ? 'left' : 'right') : fitsRight || !fitsLeft ? 'right' : 'left')
    el.style.transitionDuration = instant.current ? '0ms' : ''
    el.dataset.state = 'closed'
    void el.offsetHeight
    el.dataset.state = 'open'
    const p = pillRef.current
    if (p) {
      p.style.transition = 'none'
      p.style.transform = `translateY(${Math.max(0, selected) * step}px)`
      p.style.opacity = '0'
      void p.offsetHeight
      p.style.transition = ''
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  useLayoutEffect(() => {
    const p = pillRef.current
    if (!p || phase !== 'open') return
    if (active === null) {
      p.style.opacity = '0'
      return
    }
    const jump = instant.current || p.style.opacity !== '1'
    p.style.transitionDuration = jump ? '0ms, 150ms' : ''
    p.style.transform = `translateY(${active * step}px)`
    p.style.opacity = '1'
    instant.current = false
    const list = listRef.current
    if (list && list.scrollHeight > list.clientHeight + 1) {
      // 고른 줄이 보이는 영역 밖이면 그 줄이 보일 만큼만 스크롤한다
      const top = active * step
      const bottom = top + S.row
      if (top < list.scrollTop) list.scrollTop = top
      else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight
    }
  }, [active, phase, step])

  const open = (viaKey: boolean) => {
    if (disabled) return
    clearTimeout(closeTimer.current)
    instant.current = true
    setActive(selected >= 0 ? selected : viaKey ? 0 : null)
    setPhase('open')
  }
  const close = (mode: 'instant' | 'pop') => {
    setActive(null)
    clearTimeout(closeTimer.current)
    const el = menuRef.current
    if (mode === 'instant' || !el) {
      setPhase('closed')
      return
    }
    el.style.transitionDuration = ''
    el.dataset.state = 'closed'
    setPhase('closing')
    closeTimer.current = setTimeout(() => setPhase('closed'), popOut + 20)
  }
  const pick = (i: number, viaKey: boolean) => {
    const it = items[i]
    if (!it) {
      close('instant')
      return
    }
    if (it.value !== current) {
      if (value === undefined) setInner(it.value)
      onChange?.(it.value, it)
      if (!viaKey && rootRef.current) rootRef.current.dataset.swap = ''
    }
    close('instant')
    triggerRef.current?.focus({ preventScroll: true })
  }

  const onTriggerKey = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    const k = e.key
    const n = items.length
    const cur = active ?? Math.max(0, selected)
    if (phase !== 'open') {
      if (k === 'Enter' || k === ' ' || k === 'ArrowDown' || k === 'ArrowUp') {
        e.preventDefault()
        open(true)
      }
      return
    }
    const go = (i: number) => {
      e.preventDefault()
      instant.current = true
      setActive(Math.min(n - 1, Math.max(0, i)))
    }
    if (k === 'ArrowDown' || k === 'ArrowUp') go(active === null ? cur : cur + (k === 'ArrowDown' ? 1 : -1))
    else if (k === 'Home' || k === 'End') go(k === 'Home' ? 0 : n - 1)
    else if (k === 'Enter' || k === ' ') {
      e.preventDefault()
      pick(cur, true)
    } else if (k === 'Escape' || k === 'Tab') {
      if (k === 'Escape') e.preventDefault()
      close('instant')
    } else if (k.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) go(typeaheadIndex(items, cur, k))
  }

  useEffect(() => {
    if (phase === 'closed') return undefined
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close('pop')
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])
  useEffect(() => {
    if (disabled && phase !== 'closed') close('instant')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled])
  useEffect(() => () => clearTimeout(closeTimer.current), [])

  const rowAt = (y: number) => {
    const s = scrub.current
    if (!s) return null
    return rowFromY(y, s.top)
  }
  const rowFromY = (y: number, top: number) => {
    const i = Math.floor((y - top + (listRef.current?.scrollTop ?? 0)) / step)
    return i >= 0 && i < items.length ? i : null
  }
  const scrollable = () => !!maxMenuHeight && !!listRef.current && listRef.current.scrollHeight > listRef.current.clientHeight + 1
  const onListDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (scrub.current) return
    const lr = e.currentTarget.getBoundingClientRect()
    if (maxMenuHeight && e.clientX > lr.left + e.currentTarget.clientWidth) return // 스크롤바를 잡은 것은 고르는 동작이 아니다
    if (e.pointerType === 'touch' && scrollable()) {
      tap.current = { id: e.pointerId, x: e.clientX, y: e.clientY, t: Date.now() } // 스크롤이 시작되면 pointercancel로 끝난다
      return
    }
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* 포인터 캡처를 못 해도 동작에는 문제없다 */
    }
    scrub.current = { id: e.pointerId, top: e.currentTarget.getBoundingClientRect().top }
    instant.current = true
    setActive(rowAt(e.clientY))
  }
  const onListMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!scrub.current || scrub.current.id !== e.pointerId) return
    const i = rowAt(e.clientY)
    if (i !== active) setActive(i)
  }
  const onListUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const t = tap.current
    if (t && t.id === e.pointerId) {
      tap.current = null
      const still = Math.abs(e.clientX - t.x) < 8 && Math.abs(e.clientY - t.y) < 8 && Date.now() - t.t < 600
      if (e.type === 'pointerup' && still && listRef.current) {
        const i = rowFromY(e.clientY, listRef.current.getBoundingClientRect().top)
        if (i !== null) pick(i, false)
      }
      return
    }
    if (!scrub.current || scrub.current.id !== e.pointerId) return
    const i = e.type === 'pointerup' ? rowAt(e.clientY) : null
    scrub.current = null
    if (i !== null) pick(i, false)
    else if (!rememberPosition) setActive(null)
  }
  const onListOver = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch' || scrub.current) return
    const row = (e.target as HTMLElement).closest<HTMLElement>('[data-index]')
    if (!row) return
    const i = Number(row.dataset.index)
    if (i !== active) setActive(i)
  }

  const origin = `${side === 'bottom' ? 'top' : 'bottom'} ${edge}`
  const vars = {
    '--gs-accent': accentColor,
    '--gs-surface': surfaceColor,
    '--gs-highlight': highlightColor,
    '--gs-text': textColor,
    '--gs-radius': `${radius}px`,
    '--gs-inner-radius': `${Math.max(3, radius - 4)}px`,
    '--gs-chip': `${S.chip}px`,
    '--gs-row': `${S.row}px`,
    '--gs-font': `${S.font}px`,
    '--gs-menu-w': `${menuWidth}px`,
    '--gs-pop': `${popDuration}ms`,
    '--gs-pop-out': `${popOut}ms`,
    '--gs-glide': `${glideDuration}ms`,
    '--gs-origin': origin,
  } as CSSProperties

  return (
    <div
      ref={rootRef}
      className={`glide-select${className ? ` ${className}` : ''}`}
      data-size={size}
      data-disabled={disabled ? '' : undefined}
      style={vars}
      onAnimationEnd={(e) => {
        if (e.animationName === 'gs-swap' && rootRef.current) delete rootRef.current.dataset.swap
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={phase === 'open'}
        aria-controls={`${id}-list`}
        aria-activedescendant={active !== null ? `${id}-${active}` : undefined}
        aria-label={ariaLabel}
        disabled={disabled}
        className="glide-select__trigger"
        onPointerDown={(e) => {
          if (e.button !== 0 || disabled) return
          e.currentTarget.focus({ preventScroll: true })
          if (phase === 'open') close('pop')
          else open(false)
        }}
        onKeyDown={onTriggerKey}
      >
        <span className="glide-select__label" key={current} data-empty={selected < 0 ? '' : undefined}>
          {selected >= 0 ? items[selected].label : placeholder}
        </span>
        <span className="glide-select__chevron" aria-hidden="true">
          <ChevronIcon size={12} />
        </span>
      </button>
      {phase !== 'closed' ? (
        <div ref={menuRef} className="glide-select__menu" data-state="open" data-side={side} data-align={edge}>
          <div
            ref={listRef}
            id={`${id}-list`}
            role="listbox"
            aria-label={ariaLabel}
            className="glide-select__list"
            data-scroll={maxMenuHeight ? '' : undefined}
            data-live={active !== null ? '' : undefined}
            onPointerOver={onListOver}
            onPointerLeave={() => {
              if (!scrub.current && !rememberPosition) setActive(null)
            }}
            onPointerDown={onListDown}
            onPointerMove={onListMove}
            onPointerUp={onListUp}
            onPointerCancel={onListUp}
            onLostPointerCapture={onListUp}
          >
            <span ref={pillRef} className="glide-select__pill" aria-hidden="true" />
            {items.map((it, i) => (
              <div key={it.value} id={`${id}-${i}`} role="option" aria-selected={i === selected} data-index={i} className="glide-select__option">
                <span className="glide-select__name">{it.label}</span>
                {showTags && it.tag ? <span className="glide-select__tag">{it.tag}</span> : null}
                <span className="glide-select__check" data-on={i === selected ? '' : undefined} aria-hidden="true">
                  <TickIcon size={13} />
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
