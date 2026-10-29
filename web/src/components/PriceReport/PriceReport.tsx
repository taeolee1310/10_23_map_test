import { useEffect, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import './PriceReport.css'

export const REPORT_SOURCES = ['현장 가격표', '직접 냈어요', '공식 홈페이지·네이버', '기타'] as const

type Props = {
  place: { id: string; name: string } | null
  onClose: () => void
  /** 보냈거나 보낼 수 없을 때 알려 줄 문구 */
  onMessage: (msg: string) => void
}

type Field = 'adult' | 'towel' | 'scrub'
const FIELDS: { key: Field; label: string; hint: string }[] = [
  { key: 'adult', label: '성인 입장료', hint: '9,000' },
  { key: 'towel', label: '수건', hint: '1,000' },
  { key: 'scrub', label: '세신(때밀이)', hint: '20,000' },
]
const MEMO_MAX = 100
// 가기 전 걱정 정보(TOP 3): 요금과 따로, 알고 있는 것만 고른다. 남탕·여탕이 다르면 덧붙일 말에 적는다.
const INFO: { key: 'towelInfo' | 'hairdryer' | 'seshinPay'; label: string; options: string[] }[] = [
  { key: 'towelInfo', label: '수건', options: ['무제한', '1장', '2장', '3장 이상'] },
  { key: 'hairdryer', label: '드라이기', options: ['무료', '유료'] },
  { key: 'seshinPay', label: '세신 결제', options: ['현금만', '카드 가능'] },
]
type InfoState = { towelInfo: string; hairdryer: string; seshinPay: string }
const NO_INFO: InfoState = { towelInfo: '', hairdryer: '', seshinPay: '' }

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

// 요금 제보 창. 요금은 하나 이상 적고 확인한 방법은 꼭 고른다. 개인정보는 받지 않는다.
// 모양은 메인 화면과 같은 규칙: 카드 radius 16 · 입력 44px · 선택 = Bath Teal · 보내기 = Terracotta.
export default function PriceReport({ place, onClose, onMessage }: Props) {
  const [vals, setVals] = useState({ adult: '', towel: '', scrub: '', memo: '', hp: '' })
  const [source, setSource] = useState('')
  const [info, setInfo] = useState<InfoState>(NO_INFO)
  const [err, setErr] = useState<{ msg: string; field?: 'price' | 'source' | 'any' } | null>(null)
  const [busy, setBusy] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const open = !!place

  useEffect(() => {
    if (!open) return
    setVals({ adult: '', towel: '', scrub: '', memo: '', hp: '' })
    setSource('')
    setInfo(NO_INFO)
    setErr(null)
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const t = window.setTimeout(() => boxRef.current?.querySelector<HTMLElement>('.pr-modal__won input')?.focus(), 60)
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

  if (!place) return null

  const setPrice = (k: Field) => (e: { target: { value: string } }) => {
    setVals((s) => ({ ...s, [k]: e.target.value.replace(/[^0-9]/g, '').slice(0, 6) }))
    if (err?.field === 'price' || err?.field === 'any') setErr(null)
  }
  const pickInfo = (k: keyof InfoState, v: string) => {
    setInfo((s) => ({ ...s, [k]: s[k] === v ? '' : v })) // 같은 칩을 다시 누르면 선택을 푼다
    if (err?.field === 'any') setErr(null)
  }
  const pickSource = (s: string) => {
    setSource(s)
    if (err?.field === 'source') setErr(null)
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    const hasInfo = !!(info.towelInfo || info.hairdryer || info.seshinPay)
    if (!vals.adult && !vals.towel && !vals.scrub && !hasInfo) return setErr({ msg: '알고 있는 요금이나 정보를 하나 이상 적어 주세요', field: 'any' })
    if (!source) return setErr({ msg: '어떻게 알게 됐는지 골라 주세요', field: 'source' })
    setBusy(true)
    setErr(null)
    try {
      const r = await fetch('/api/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ placeId: place.id, placeName: place.name, ...vals, ...info, source, deviceId: deviceId() }),
      })
      const j = await r.json().catch(() => ({}))
      if (r.ok && j.ok) {
        onMessage('제보 고마워요. 확인한 뒤에 반영할게요')
        onClose()
      } else if (j.error === 'not-ready' || r.status === 404 || !('ok' in j)) {
        onMessage(ERRORS['not-ready'])
        onClose()
      } else {
        setErr({ msg: ERRORS[j.error] || '보내지 못했어요. 잠시 뒤에 다시 해 주세요' })
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

        <form onSubmit={submit} noValidate>
          <section className={`pr-modal__sec${err?.field === 'price' || err?.field === 'any' ? ' bad' : ''}`} aria-labelledby="pr-prices">
            <h3 id="pr-prices" className="pr-modal__sub">알고 있는 요금 <span>선택</span></h3>
            {FIELDS.map((f) => (
              <label key={f.key} className="pr-modal__row">
                <span>{f.label}</span>
                <span className="pr-modal__won">
                  <input inputMode="numeric" autoComplete="off" value={comma(vals[f.key])} onChange={setPrice(f.key)} placeholder={f.hint} aria-invalid={err?.field === 'price'} />
                  <em aria-hidden="true">원</em>
                </span>
              </label>
            ))}
          </section>

          <section className={`pr-modal__sec${err?.field === 'any' ? ' bad' : ''}`} aria-labelledby="pr-info">
            <h3 id="pr-info" className="pr-modal__sub">가기 전 걱정 정보 <span>선택</span></h3>
            {INFO.map((g) => (
              <div key={g.key} className="pr-modal__row pr-modal__row--chips" role="group" aria-label={g.label}>
                <span>{g.label}</span>
                <span className="pr-modal__chips">
                  {g.options.map((o) => (
                    <button key={o} type="button" className={info[g.key] === o ? 'on' : ''} aria-pressed={info[g.key] === o} onClick={() => pickInfo(g.key, o)}>
                      {o}
                    </button>
                  ))}
                </span>
              </div>
            ))}
          </section>

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

          <label className="pr-modal__memo">
            <span className="pr-modal__sub">덧붙일 말 <span>선택</span></span>
            <textarea rows={2} maxLength={MEMO_MAX} value={vals.memo} onChange={(e) => setVals((s) => ({ ...s, memo: e.target.value }))} placeholder="예) 주말은 1,000원 더 받아요" />
            <small aria-hidden="true">{vals.memo.length}/{MEMO_MAX}</small>
          </label>

          <input className="pr-modal__hp" tabIndex={-1} autoComplete="off" aria-hidden="true" value={vals.hp} onChange={(e) => setVals((s) => ({ ...s, hp: e.target.value }))} />

          <p className="pr-modal__note">이름·전화번호 같은 개인정보는 적지 마세요. 제보는 확인한 뒤에만 화면에 반영돼요.</p>
          <p className={`pr-modal__err${err ? ' show' : ''}`} role="alert">{err?.msg}</p>

          <div className="pr-modal__actions">
            <button type="button" className="pr-modal__btn pr-modal__btn--outline" onClick={onClose}>닫기</button>
            <button type="submit" className="pr-modal__btn pr-modal__btn--primary" disabled={busy}>{busy ? '보내는 중' : '제보하기'}</button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  )
}
