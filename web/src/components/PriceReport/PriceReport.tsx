import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import './PriceReport.css'
import { REPORT_URL } from '../../lib/api'
import { track } from '../../lib/track'
import BathBadge, { BATH_LABEL, type BathSide } from '../BathBadge/BathBadge'

export const REPORT_SOURCES = ['현장 가격표', '직접 냈어요', '공식 홈페이지·네이버', '기타'] as const

type Field = 'adult' | 'towel' | 'scrub'
type InfoState = { hairdryerW: string; hairdryerM: string; seshinPay: string }
/** 수건: 어떻게 받는지 하나를 고르고, 카운터에서 받으면 장 수를, 빌리면 값을 덧붙인다 */
type TowelState = { how: '' | 'free' | 'counter' | 'paid'; count: string }
type SlotKey = 'adult' | 'scrub' | 'towel' | 'dryer' | 'seshinPay'
/** 이미 확인된 값(칸 이름 → 화면 문구). 있는 칸은 채워진 칸으로, 없는 칸은 점선 빈칸으로 보인다. 수건·드라이기는 탕별(W 여탕, M 남탕) */
export type ReportKnown = Partial<Record<'adult' | 'towel' | 'scrub' | 'towelInfo' | 'towelW' | 'towelM' | 'hairdryerW' | 'hairdryerM' | 'seshinPay', string>>

type Props = {
  place: { id: string; name: string; known?: ReportKnown } | null
  onClose: () => void
  /** 보낼 수 없을 때 알려 줄 문구 */
  onMessage: (msg: string) => void
}

// 칸 목록: 그 목욕탕의 정보 카드 모양으로 늘어놓는다. won = 금액을 적는 칸, pick = 고르는 칸, towel = 수건(받는 방법 → 장 수·값).
// 수건·드라이기는 여탕과 남탕이 다른 곳이 많아, 다녀온 탕을 먼저 고르면 그 탕의 칸만 연다(모르는 탕을 짐작해서 채우지 않게).
type Slot =
  | { key: 'adult' | 'scrub'; label: string; kind: 'won'; hint: string }
  | { key: 'dryer' | 'seshinPay'; label: string; kind: 'pick'; options: string[] }
  | { key: 'towel'; label: string; kind: 'towel' }
const slotsFor = (side: BathSide | ''): Slot[] => [
  { key: 'adult', label: '성인 입장료', kind: 'won', hint: '9,000' },
  ...(side
    ? ([
        { key: 'towel', label: `${BATH_LABEL[side]} 수건`, kind: 'towel' },
        { key: 'dryer', label: `${BATH_LABEL[side]} 드라이기`, kind: 'pick', options: ['무료', '유료', '없음'] },
      ] as Slot[])
    : []),
  { key: 'seshinPay', label: '세신 결제', kind: 'pick', options: ['현금만', '카드 가능'] },
  { key: 'scrub', label: '세신(때밀이) 요금', kind: 'won', hint: '20,000' },
]
const TOWEL_HOW: { key: Exclude<TowelState['how'], ''>; label: string }[] = [
  { key: 'free', label: '자유롭게 씀' },
  { key: 'counter', label: '카운터에서 받음' },
  { key: 'paid', label: '돈 내고 빌림' },
]
const TOWEL_COUNTS = ['1장', '2장', '3장 이상']
const MEMO_MAX = 100
const NO_INFO: InfoState = { hairdryerW: '', hairdryerM: '', seshinPay: '' }
const NO_TOWEL: TowelState = { how: '', count: '' }
const NO_VALS = { adult: '', towel: '', scrub: '', memo: '', hp: '' }

const ERRORS: Record<string, string> = {
  'not-ready': '제보 창구를 준비 중이에요',
  rate: '잠시 뒤에 다시 보내 주세요',
  limit: '오늘은 제보를 충분히 보내 주셨어요. 내일 다시 알려 주세요. 고마워요', // 한도 숫자는 Worker에만 있다(바뀌어도 문구는 그대로)
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
  const [side, setSide] = useState<BathSide | ''>('') // 다녀온 탕. 고르면 그 탕의 수건·드라이기 칸이 열린다
  const [towel, setTowel] = useState<TowelState>(NO_TOWEL)
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
    setSide('')
    setTowel(NO_TOWEL)
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

  const SLOTS = slotsFor(side)
  const dryerKey = side === 'men' ? 'hairdryerM' : 'hairdryerW'
  // 서버로 보내는 수건 값: 자유롭게 → 무제한, 카운터 → 장 수(모르면 '카운터'), 빌림 → 유료(값은 수건 요금 칸으로)
  const towelValue = towel.how === 'free' ? '무제한' : towel.how === 'counter' ? towel.count || '카운터' : towel.how === 'paid' ? '유료' : ''
  const towelMine = towel.how === 'free' ? '자유롭게 씀' : towel.how === 'counter' ? (towel.count ? `카운터에서 ${towel.count}` : '카운터에서 받음') : towel.how === 'paid' ? (vals.towel ? `빌림 ${comma(vals.towel)}원` : '돈 내고 빌림') : ''
  // 내가 채운 값(화면 문구). 금액 칸은 '9,000원', 고르는 칸은 고른 말 그대로
  const mine = (k: SlotKey) => (k === 'adult' || k === 'scrub' ? (vals[k] ? comma(vals[k]) + '원' : '') : k === 'towel' ? towelMine : k === 'dryer' ? info[dryerKey] : info[k])
  const filled = SLOTS.filter((s) => mine(s.key))
  const count = filled.length
  // 채운 칸이 늘 때마다 물결이 한 번 퍼진다
  useEffect(() => {
    if (count > prevCount.current) setPulse((n) => n + 1)
    prevCount.current = count
  }, [count])

  if (!place) return null
  const k0 = place.known ?? {}
  // 지금 보이는 칸 기준의 확인된 값: 수건·드라이기는 고른 탕의 값만
  const known: Partial<Record<SlotKey, string>> = {
    adult: k0.adult,
    scrub: k0.scrub,
    seshinPay: k0.seshinPay,
    towel: side ? k0[side === 'men' ? 'towelM' : 'towelW'] || (k0.towel ? `빌림 ${k0.towel}` : undefined) : undefined,
    dryer: side ? k0[dryerKey] : undefined,
  }
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

  // 탕을 바꾸면 그 탕 칸에 적어 둔 값은 지운다(다른 탕 값으로 잘못 가지 않게)
  const pickSide = (v: BathSide) => {
    if (v === side) return
    setSide(v)
    setTowel(NO_TOWEL)
    setInfo((s) => ({ ...s, hairdryerW: '', hairdryerM: '' }))
    setVals((s) => ({ ...s, towel: '' }))
    setActive(null)
  }
  const pickTowel = (how: TowelState['how']) => {
    const off = towel.how === how
    setTowel({ how: off ? '' : how, count: '' })
    if (how !== 'paid' || off) setVals((s) => ({ ...s, towel: '' }))
    if (err?.field === 'any') setErr(null)
    if (off || how === 'free') setActive(null) // 더 물을 것이 없으면 칸이 닫힌다
  }
  const pickCount = (c: string) => {
    setTowel((t) => ({ ...t, count: t.count === c ? '' : c }))
    setActive(null)
  }
  const setPrice = (k: Field) => (e: { target: { value: string } }) => {
    setVals((s) => ({ ...s, [k]: e.target.value.replace(/[^0-9]/g, '').slice(0, 6) }))
    if (err?.field === 'price' || err?.field === 'any') setErr(null)
  }
  const pickInfo = (slot: 'dryer' | 'seshinPay', v: string) => {
    const k = slot === 'dryer' ? dryerKey : slot
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
        body: JSON.stringify({
          placeId: place.id,
          placeName: place.name,
          ...vals,
          ...info,
          // 수건은 탕 이름을 붙여 보낸다. towelInfo는 예전 서버도 읽을 수 있는 값일 때만 같이 보낸다
          ...(side && towelValue ? { [side === 'men' ? 'towelInfoM' : 'towelInfoW']: towelValue } : {}),
          towelInfo: ['무제한', '1장', '2장', '3장 이상'].includes(towelValue) ? towelValue : '',
          source,
          deviceId: deviceId(),
        }),
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
            <fieldset className="pr-side">
              <legend className="pr-modal__sub">어느 탕에 다녀오셨어요? <span>고르면 수건·드라이기 칸이 열려요</span></legend>
              <div>
                {(['women', 'men'] as const).map((k) => (
                  <button key={k} type="button" className={side === k ? 'on' : ''} aria-pressed={side === k} onClick={() => pickSide(k)}>
                    <BathBadge side={k} />
                  </button>
                ))}
              </div>
            </fieldset>
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
                            <button key={o} type="button" className={mine(s.key) === o ? 'on' : ''} aria-pressed={mine(s.key) === o} onClick={() => pickInfo(s.key, o)}>
                              {o}
                            </button>
                          ))}
                        </div>
                      ) : s.kind === 'towel' ? (
                        <div className="pr-slot__edit pr-towel">
                          <div className="pr-modal__chips" role="group" aria-label={`${s.label}: 어떻게 받나요`}>
                            {TOWEL_HOW.map((o) => (
                              <button key={o.key} type="button" className={towel.how === o.key ? 'on' : ''} aria-pressed={towel.how === o.key} onClick={() => pickTowel(o.key)}>
                                {o.label}
                              </button>
                            ))}
                          </div>
                          {towel.how === 'counter' && (
                            <div className="pr-towel__more">
                              <span className="pr-modal__sub">몇 장 받나요? <span>몰라도 돼요</span></span>
                              <div className="pr-modal__chips" role="group" aria-label="받는 수건 장 수">
                                {TOWEL_COUNTS.map((c) => (
                                  <button key={c} type="button" className={towel.count === c ? 'on' : ''} aria-pressed={towel.count === c} onClick={() => pickCount(c)}>
                                    {c}
                                  </button>
                                ))}
                              </div>
                              <button type="button" className="pr-slot__ok" onClick={() => setActive(null)}>넣기</button>
                            </div>
                          )}
                          {towel.how === 'paid' && (
                            <div className="pr-towel__more pr-towel__pay">
                              <span className="pr-modal__won">
                                <input ref={(el) => el?.focus({ preventScroll: true })} inputMode="numeric" autoComplete="off" aria-label="수건 빌리는 값" value={comma(vals.towel)} onChange={setPrice('towel')} onKeyDown={wonKey} placeholder="1,000" aria-invalid={err?.field === 'price'} />
                                <em aria-hidden="true">원</em>
                              </span>
                              <button type="button" className="pr-slot__ok" onClick={() => setActive(null)}>넣기</button>
                            </div>
                          )}
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
