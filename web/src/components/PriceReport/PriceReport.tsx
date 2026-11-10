import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import './PriceReport.css'
import { REPORT_URL } from '../../lib/api'
import { track } from '../../lib/track'

export const REPORT_SOURCES = ['현장 가격표', '직접 냈어요', '공식 홈페이지·네이버', '기타'] as const

type Field = 'adult' | 'towel' | 'scrub'
type InfoState = { towelInfo: string; hairdryerW: string; hairdryerM: string; seshinPay: string }
type SlotKey = Field | keyof InfoState
/** 이미 확인된 값(칸 이름 → 화면 문구). 있는 칸은 채워진 칸으로, 없는 칸은 점선 빈칸으로 보인다 */
export type ReportKnown = Partial<Record<SlotKey, string>>

type Props = {
  place: { id: string; name: string; known?: ReportKnown } | null
  onClose: () => void
  /** 보낼 수 없을 때 알려 줄 문구 */
  onMessage: (msg: string) => void
}

// 칸 목록: 그 목욕탕의 정보 카드 모양으로 늘어놓는다. won = 금액을 적는 칸, pick = 고르는 칸.
// 드라이기는 여탕·남탕이 다른 곳이 많아(여탕만 동전) 나눠서 받는다. 남탕·여탕이 다른 다른 정보는 덧붙일 말에 적는다
const SLOTS: ({ key: Field; label: string; kind: 'won'; hint: string } | { key: keyof InfoState; label: string; kind: 'pick'; options: string[] })[] = [
  { key: 'adult', label: '성인 입장료', kind: 'won', hint: '9,000' },
  { key: 'towelInfo', label: '수건', kind: 'pick', options: ['무제한', '1장', '2장', '3장 이상'] },
  { key: 'hairdryerW', label: '여탕 드라이기', kind: 'pick', options: ['무료', '유료', '없음'] },
  { key: 'hairdryerM', label: '남탕 드라이기', kind: 'pick', options: ['무료', '유료', '없음'] },
  { key: 'seshinPay', label: '세신 결제', kind: 'pick', options: ['현금만', '카드 가능'] },
  { key: 'scrub', label: '세신(때밀이) 요금', kind: 'won', hint: '20,000' },
  { key: 'towel', label: '수건 요금', kind: 'won', hint: '1,000' },
]
const MEMO_MAX = 100
const NO_INFO: InfoState = { towelInfo: '', hairdryerW: '', hairdryerM: '', seshinPay: '' }
const NO_VALS = { adult: '', towel: '', scrub: '', memo: '', hp: '' }

const ERRORS: Record<string, string> = {
  'not-ready': '제보 창구를 준비 중이에요',
  rate: '잠시 뒤에 다시 보내 주세요',
  limit: '제보는 한 사람당 3번까지 보낼 수 있어요. 이미 보내 주셔서 고마워요',
  price: '요금은 0~200,000 사이 숫자로 적어 주세요',
}

// 로그인이 없어서, 이 브라우저에 익명 번호를 하나 만들어 '한 사람당 횟수'를 센다(개인정보 아님, 지우면 새로 생긴다)
const deviceId = () => {
  try {
    let id = localStorage.getItem('tangbang:device')
    if (!id) {
      id = crypto.randomUUID()
      localStorage.setItem('tangbang:device', id)
    }
    return id
  } catch {
    return ''
  }
}

const comma = (digits: string) => (digits ? Number(digits).toLocaleString('ko-KR') : '')

// 탕: 칸을 채울 때마다 물이 차오른다(인트로·'내 주변 목욕탕' 버튼과 같은 물). 물과 물결은 장식이고, 안내 문장만 읽힌다
function Tub({ level, say, pulse, steam }: { level: number; say: string; pulse: number; steam?: boolean }) {
  return (
    <div className={`pr-tub${steam ? ' pr-tub--steam' : ''}`}>
      {steam && (
        <span className="pr-tub__steam" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      )}
      <div className="pr-tub__bath">
        <span className="pr-tub__water" aria-hidden="true" style={{ transform: `translateY(${100 - level}%)` }}>
          <svg className="pr-tub__wave" viewBox="0 0 120 12" preserveAspectRatio="none" focusable="false">
            <defs>
              <linearGradient id="pr-liquid-grad" x1="0" x2="1">
                <stop offset="0" className="pr-tub__stop--a" />
                <stop offset="1" className="pr-tub__stop--b" />
              </linearGradient>
            </defs>
            <path d="M0 6 Q 15 0 30 6 T 60 6 T 90 6 T 120 6 V12 H0 Z" fill="url(#pr-liquid-grad)" />
          </svg>
        </span>
        {/* 칸을 하나 채울 때마다 한 번 퍼지는 물결 */}
        {pulse > 0 && <i key={pulse} className="pr-tub__ripple" aria-hidden="true" />}
        <p className="pr-tub__say" role="status">{say}</p>
      </div>
    </div>
  )
}

// 정보 제보 창. 폼 대신 그 목욕탕의 정보 카드를 보여 준다: 이미 확인된 칸은 채워져 있고, 모르는 칸은 점선 빈칸이다.
// 빈칸을 누르면 그 자리에서 고르거나 적고, 채울 때마다 위의 탕에 물이 차오른다. 단계가 없어 하나만 채워도 바로 보낼 수 있다.
// 확인한 방법은 꼭 고른다(하나라도 채운 뒤에 나타난다). 개인정보는 받지 않는다. 서버로 보내는 내용은 예전 폼과 같다.
// 모양은 메인 화면과 같은 규칙: 카드 radius 16 · 입력 44px · 선택 = Bath Teal · 보내기 = Terracotta.
export default function PriceReport({ place, onClose, onMessage }: Props) {
  const [vals, setVals] = useState(NO_VALS)
  const [source, setSource] = useState('')
  const [info, setInfo] = useState<InfoState>(NO_INFO)
  const [err, setErr] = useState<{ msg: string; field?: 'price' | 'source' | 'any' } | null>(null)
  const [busy, setBusy] = useState(false)
  const [active, setActive] = useState<SlotKey | null>(null) // 지금 열어서 채우는 칸
  const [memoOpen, setMemoOpen] = useState(false)
  const [done, setDone] = useState(false)
  const [pulse, setPulse] = useState(0)
  const boxRef = useRef<HTMLDivElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const prevCount = useRef(0)
  const open = !!place

  useEffect(() => {
    if (!open) return
    setVals(NO_VALS)
    setSource('')
    setInfo(NO_INFO)
    setErr(null)
    setActive(null)
    setMemoOpen(false)
    setDone(false)
    setPulse(0)
    prevCount.current = 0
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const t = window.setTimeout(() => boxRef.current?.querySelector<HTMLElement>('.pr-slot--blank .pr-slot__head, .pr-slot__head')?.focus(), 60)
    return () => {
      window.clearTimeout(t)
      returnFocus.current?.focus?.()
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      } else if (e.key === 'Tab' && boxRef.current) {
        const f = [...boxRef.current.querySelectorAll<HTMLElement>('input:not([tabindex="-1"]), textarea, button')].filter((x) => !x.hasAttribute('disabled'))
        if (!f.length) return
        const first = f[0]
        const last = f[f.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // 모바일 키보드: 키보드가 올라오면 화면의 보이는 부분(visualViewport)만큼으로 창을 줄이고,
  // 지금 입력하는 칸을 보이는 부분 맨 위로 올린다(키보드에 가리지 않게). 키보드가 내려가면 원래 크기로 돌아온다.
  // scrollIntoView는 바깥 화면까지 밀 수 있어 쓰지 않고, 창 안의 스크롤 위치만 바꾼다
  useEffect(() => {
    if (!open) return
    const card = boxRef.current
    const modal = card?.parentElement
    if (!card || !modal) return
    const vv = window.visualViewport
    const follow = () => {
      const el = document.activeElement
      if (!(el instanceof HTMLElement) || !card.contains(el) || !el.matches('input, textarea')) return
      const target = el.closest<HTMLElement>('.pr-slot, .pr-modal__memo') ?? el
      const sc = card.scrollHeight > card.clientHeight + 1 ? card : modal // 좁은 화면은 카드가, 넓은 화면은 바깥이 스크롤된다
      sc.scrollTop += target.getBoundingClientRect().top - sc.getBoundingClientRect().top - 12
    }
    const fit = () => {
      // 키보드가 올라온 경우만(확대해서 보는 중은 제외): 보이는 높이가 화면보다 80px 넘게 줄었을 때
      const kb = !!vv && Math.abs(vv.scale - 1) < 0.01 && vv.height < window.innerHeight - 80
      modal.classList.toggle('pr-modal--kb', kb) // 키보드가 올라온 동안은 아래에 여백을 둬서 맨 아래 칸도 위로 올릴 수 있게 한다
      if (vv && kb) {
        modal.style.setProperty('--pr-vh', `${vv.height}px`)
        modal.style.setProperty('--pr-top', `${vv.offsetTop}px`)
      } else {
        modal.style.removeProperty('--pr-vh')
        modal.style.removeProperty('--pr-top')
      }
      follow()
    }
    let t = 0
    // 칸을 열어 입력을 시작할 때: 바로 한 번, 키보드가 다 올라온 뒤 한 번 더
    const onFocus = () => {
      requestAnimationFrame(follow)
      window.clearTimeout(t)
      t = window.setTimeout(fit, 350)
    }
    card.addEventListener('focusin', onFocus)
    vv?.addEventListener('resize', fit)
    vv?.addEventListener('scroll', fit)
    return () => {
      window.clearTimeout(t)
      card.removeEventListener('focusin', onFocus)
      vv?.removeEventListener('resize', fit)
      vv?.removeEventListener('scroll', fit)
    }
  }, [open])

  // 내가 채운 값(화면 문구). 금액 칸은 '9,000원', 고르는 칸은 고른 말 그대로
  const mine = (k: SlotKey) => (k === 'adult' || k === 'towel' || k === 'scrub' ? (vals[k] ? comma(vals[k]) + '원' : '') : info[k])
  const filled = SLOTS.filter((s) => mine(s.key))
  const count = filled.length
  // 채운 칸이 늘 때마다 물결이 한 번 퍼진다
  useEffect(() => {
    if (count > prevCount.current) setPulse((n) => n + 1)
    prevCount.current = count
  }, [count])

  if (!place) return null
  const known = place.known ?? {}
  const blanks = SLOTS.filter((s) => !known[s.key])
  const left = blanks.filter((s) => !mine(s.key)).length
  // 물 높이: 비어 있어도 바닥에 조금 깔려 있고, 빈칸을 다 채우면 거의 가득, 보내면 가득
  const level = done ? 100 : count === 0 ? 12 : Math.min(92, 12 + 80 * (count / Math.max(1, blanks.length || SLOTS.length)))
  const say = done
    ? '고마워요! 확인한 뒤에 채워 둘게요'
    : count === 0
      ? blanks.length
        ? '아는 칸 하나만 채워도 돼요'
        : '다르게 알고 있는 칸을 눌러 고쳐 주세요'
      : left > 0
        ? `${count}칸 채웠어요 · 빈칸 ${left}곳 남았어요`
        : `${count}칸 채웠어요. 탕이 가득 찼어요`

  const setPrice = (k: Field) => (e: { target: { value: string } }) => {
    setVals((s) => ({ ...s, [k]: e.target.value.replace(/[^0-9]/g, '').slice(0, 6) }))
    if (err?.field === 'price' || err?.field === 'any') setErr(null)
  }
  const pickInfo = (k: keyof InfoState, v: string) => {
    setInfo((s) => ({ ...s, [k]: s[k] === v ? '' : v })) // 같은 칩을 다시 누르면 선택을 푼다
    if (err?.field === 'any') setErr(null)
    setActive(null) // 고르면 칸이 닫힌다: 누르고 → 고르면 끝
  }
  const pickSource = (s: string) => {
    setSource(s)
    if (err?.field === 'source') setErr(null)
  }
  const wonKey = (e: ReactKeyboardEvent) => {
    if (e.key !== 'Enter') return
    e.preventDefault() // 금액을 적고 Enter는 '넣기'다(제보를 보내지 않는다)
    setActive(null)
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    if (!count) return setErr({ msg: '아는 칸을 하나 이상 채워 주세요', field: 'any' })
    if (!source) return setErr({ msg: '어떻게 알게 됐는지 골라 주세요', field: 'source' })
    setBusy(true)
    setErr(null)
    try {
      const r = await fetch(REPORT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ placeId: place.id, placeName: place.name, ...vals, ...info, source, deviceId: deviceId() }),
      })
      const j = await r.json().catch(() => ({}))
      if (r.ok && j.ok) {
        track('report_done')
        setActive(null)
        setDone(true) // 창을 닫지 않고, 가득 찬 탕과 보낸 내용을 보여 준다
      } else if (j.error === 'not-ready' || r.status === 404 || !('ok' in j)) {
        onMessage(ERRORS['not-ready'])
        onClose()
      } else {
        setErr({ msg: ERRORS[j.error] || '보내지 못했어요. 잠시 뒤에 다시 해 주세요', field: j.error === 'price' ? 'price' : undefined })
      }
    } catch {
      setErr({ msg: '보내지 못했어요. 인터넷 연결을 확인해 주세요' })
    }
    setBusy(false)
  }

  return createPortal(
    <div className="pr-modal" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="pr-modal__card" role="dialog" aria-modal="true" aria-labelledby="pr-title" ref={boxRef}>
        <header className="pr-modal__head">
          <div>
            <h2 id="pr-title" className="pr-modal__title">정보 제보</h2>
            <p className="pr-modal__place">{place.name}</p>
          </div>
          <button type="button" className="pr-modal__x" aria-label="닫기" onClick={onClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </header>

        <Tub level={level} say={say} pulse={pulse} steam={done} />

        {done ? (
          <div className="pr-done">
            <p className="pr-modal__sub">이렇게 알려 주셨어요</p>
            <ul className="pr-done__list">
              {filled.map((s) => (
                <li key={s.key}>
                  <span>{s.label}</span>
                  <b>{mine(s.key)}</b>
                </li>
              ))}
            </ul>
            <p className="pr-modal__note">확인한 뒤에만 화면에 반영돼요. 다른 칸도 알게 되면 또 알려 주세요.</p>
            <div className="pr-modal__actions">
              <button type="button" className="pr-modal__btn pr-modal__btn--primary" onClick={onClose}>닫기</button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} noValidate>
            <p className="pr-slots__hint">{blanks.length ? '점선 칸이 아직 모르는 정보예요. ' : ''}확인된 칸도 다르게 알고 있으면 눌러서 고칠 수 있어요.</p>
            <div className={`pr-slots${err?.field === 'any' ? ' bad' : ''}`}>
              {SLOTS.map((s) => {
                const my = mine(s.key)
                const state = my ? 'mine' : known[s.key] ? 'known' : 'blank'
                const on = active === s.key
                return (
                  <div key={s.key} className={`pr-slot pr-slot--${state}${on ? ' is-open' : ''}`}>
                    <button type="button" className="pr-slot__head" aria-expanded={on} onClick={() => setActive(on ? null : s.key)}>
                      <span className="pr-slot__label">
                        {s.label}
                        {state === 'known' && <em>확인됨</em>}
                      </span>
                      <span className="pr-slot__value">{my || known[s.key] || '알려 주기'}</span>
                    </button>
                    {on &&
                      (s.kind === 'pick' ? (
                        <div className="pr-slot__edit pr-modal__chips" role="group" aria-label={s.label}>
                          {s.options.map((o) => (
                            <button key={o} type="button" className={info[s.key] === o ? 'on' : ''} aria-pressed={info[s.key] === o} onClick={() => pickInfo(s.key, o)}>
                              {o}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <div className="pr-slot__edit">
                          <span className="pr-modal__won">
                            <input
                              ref={(el) => el?.focus({ preventScroll: true })}
                              inputMode="numeric"
                              autoComplete="off"
                              aria-label={s.label}
                              value={comma(vals[s.key])}
                              onChange={setPrice(s.key)}
                              onKeyDown={wonKey}
                              placeholder={s.hint}
                              aria-invalid={err?.field === 'price'}
                            />
                            <em aria-hidden="true">원</em>
                          </span>
                          <button type="button" className="pr-slot__ok" onClick={() => setActive(null)}>넣기</button>
                        </div>
                      ))}
                  </div>
                )
              })}
            </div>

            {/* 하나라도 채우면 나타난다: 처음에는 칸만 보여 부담을 줄인다 */}
            {count > 0 && (
              <fieldset className={`pr-modal__src${err?.field === 'source' ? ' bad' : ''}`}>
                <legend className="pr-modal__sub">어떻게 알게 됐나요? <span>필수</span></legend>
                <div>
                  {REPORT_SOURCES.map((s) => (
                    <label key={s} className={source === s ? 'on' : ''}>
                      <input type="radio" name="pr-source" value={s} checked={source === s} onChange={() => pickSource(s)} />
                      {s}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}

            {count > 0 &&
              (memoOpen ? (
                <label className="pr-modal__memo">
                  <span className="pr-modal__sub">덧붙일 말 <span>선택</span></span>
                  <textarea ref={(el) => el && !vals.memo && el.focus({ preventScroll: true })} rows={2} maxLength={MEMO_MAX} value={vals.memo} onChange={(e) => setVals((v) => ({ ...v, memo: e.target.value }))} placeholder="예) 주말은 1,000원 더 받아요" />
                  <small aria-hidden="true">{vals.memo.length}/{MEMO_MAX}</small>
                </label>
              ) : (
                <button type="button" className="pr-modal__more" onClick={() => setMemoOpen(true)}>+ 덧붙일 말 쓰기</button>
              ))}

            <input className="pr-modal__hp" tabIndex={-1} autoComplete="off" aria-hidden="true" value={vals.hp} onChange={(e) => setVals((s) => ({ ...s, hp: e.target.value }))} />

            <p className="pr-modal__note">이름·전화번호 같은 개인정보는 적지 마세요. 제보는 확인한 뒤에만 화면에 반영돼요.</p>
            <p className={`pr-modal__err${err ? ' show' : ''}`} role="alert">{err?.msg}</p>

            <div className="pr-modal__actions">
              <button type="button" className="pr-modal__btn pr-modal__btn--outline" onClick={onClose}>닫기</button>
              <button type="submit" className="pr-modal__btn pr-modal__btn--primary" disabled={busy}>{busy ? '보내는 중' : count ? `${count}칸 알려 주기` : '제보하기'}</button>
            </div>
          </form>
        )}
      </div>
    </div>,
    document.body,
  )
}
