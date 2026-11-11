import { useState } from 'react'
import { won, type DayKo, type DryerInfo, type Facts, type Price, type TowelMode } from '../../lib/onsen'
import BathBadge, { BATH_LABEL, type BathSide } from '../../components/BathBadge/BathBadge'
import PriceIcon, { type PriceIconName } from '../../components/PriceIcon/PriceIcon'
import { IconInfo } from './Icons'
import wonIcon from '../../assets/badge/won.svg'

/** 상세 맨 위 카드의 제목. '걱정'이라는 말 대신 가서 당황하지 않게 미리 본다는 뜻으로(2026-11-11). 온보딩·미리보기 카드도 이 이름을 쓴다 */
export const CHECK_TITLE = '가기 전 1초 체크'

// 값이 있는 것만 문구로 만든다. 없는 칸은 null이라 화면에서 통째로 빠진다.
const towelOne = (t: TowelMode) => (t.mode === 'unlimited' ? '무제한 제공' : t.count != null ? `${t.count}장 제공` : '장수 제한')

export function towelText(t: Facts['towel']): string | null {
  const w = t?.women
  const m = t?.men
  if (!w && !m) return null
  if (w && m && w.mode === m.mode && w.count === m.count) return '수건 ' + towelOne(w)
  return [w && '여탕 수건 ' + towelOne(w), m && '남탕 수건 ' + towelOne(m)].filter(Boolean).join(' · ')
}

const dryerOne = (d: DryerInfo): string | null =>
  d.none ? '없음' : d.paid === true ? (d.price != null ? `유료 ${won(d.price)}` : '유료') : d.paid === false ? '무료' : d.has ? '있음' : null

/** 제보 창에 넘기는 '이미 확인된 값'(칸 이름 → 문구). 확인된 칸은 채워진 칸으로, 없는 칸은 빈칸으로 보인다. 문구는 상세 화면과 같은 함수에서 만든다 */
export function reportKnown(p: { price: Price | null; facts?: Facts }): Partial<Record<'adult' | 'towel' | 'scrub' | 'towelInfo' | 'towelW' | 'towelM' | 'hairdryerW' | 'hairdryerM' | 'seshinPay', string>> {
  const f = p.facts
  const h = f?.hairdryer
  const both = h && !h.women && !h.men ? dryerOne(h) : null // 어느 탕인지 모르는 공통 값은 두 칸에 같이 보여 준다
  const out = {
    adult: p.price?.adult != null ? won(p.price.adult) : null,
    towel: p.price?.towel != null ? won(p.price.towel) : null,
    scrub: seshinPriceText(f?.seshin),
    towelInfo: towelText(f?.towel)?.replace(/수건 /g, '') ?? null,
    towelW: f?.towel?.women ? towelOne(f.towel.women) : null,
    towelM: f?.towel?.men ? towelOne(f.towel.men) : null,
    hairdryerW: (h?.women && dryerOne(h.women)) || both,
    hairdryerM: (h?.men && dryerOne(h.men)) || both,
    seshinPay: f?.seshin?.payment ? (f.seshin.payment === 'cash_only' ? '현금 결제만 가능' : '카드 결제 가능') : null,
  }
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v))
}

/** 근거가 후기 1건뿐인 값에 붙이는 안내. 값과 같은 위계로 쓰지 않고 (i) 아이콘 툴팁으로 둔다 */
export const LOW_NOTE = '후기 1건 기준이라 실제와 다를 수 있어요'

/** 보여 주는 드라이기 값 중 근거가 후기 1건뿐인 것이 있는지 */
export function hairdryerLow(h: Facts['hairdryer']): boolean {
  if (!h) return false
  const w = h.women && dryerOne(h.women)
  const m = h.men && dryerOne(h.men)
  return !!((w && h.women?.low) || (m && h.men?.low) || (!w && !m && h.low))
}

/** 드라이기 문구(목록·미리보기·상세 공통). 탕별 값이 있으면 '여탕 유료 200원 · 남탕 무료'처럼 탕별로, 없으면 공통 값으로 */
export function hairdryerText(h: Facts['hairdryer']): string | null {
  if (!h) return null
  const w = h.women && dryerOne(h.women)
  const m = h.men && dryerOne(h.men)
  let text: string | null
  if (w && m) text = w === m ? w : `여탕 ${w} · 남탕 ${m}`
  else if (w || m) text = w ? `여탕 ${w}` : `남탕 ${m}`
  else text = dryerOne(h)
  return text
}

/** (i) 아이콘 + 툴팁. 마우스를 올리거나 누르면(포커스) 안내가 뜬다. 화면 읽기 프로그램은 aria-label로 읽는다 */
export function InfoTip({ text, align = 'end' }: { text: string; align?: 'start' | 'end' }) {
  return (
    <button type="button" className={`infotip infotip--${align}`} aria-label={text} data-tip={text} onClick={(e) => e.stopPropagation()}>
      <IconInfo />
    </button>
  )
}

export function seshinPriceText(s: Facts['seshin']): string | null {
  if (!s) return null
  if (s.price_full != null) return won(s.price_full)
  const parts = [s.price_women != null && `여탕 ${won(s.price_women)}`, s.price_men != null && `남탕 ${won(s.price_men)}`].filter(Boolean)
  return parts.length ? parts.join(' · ') : null
}

type WorryRow = { icon: PriceIconName; label: string; text: string | null; note?: string } // text가 null이면 아직 확인하지 못한 항목, note는 (i) 툴팁 안내

/** 가기 전 걱정 TOP 3 세 줄(수건·드라이기·세신, Figma 순서). 확인 못 한 줄은 text가 null이다. */
function worryRows(f: Facts | undefined): WorryRow[] {
  const price = seshinPriceText(f?.seshin)
  const pay = f?.seshin?.payment ? (f.seshin.payment === 'cash_only' ? '현금 결제만 가능' : '카드 결제 가능') : null
  const hd = f?.hairdryer
  return [
    { icon: 'towel', label: '수건', text: towelText(f?.towel)?.replace(/수건 /g, '') ?? null }, // 줄 이름이 '수건'이라 값에서는 뺀다
    { icon: 'hairdryer', label: '드라이기', text: hairdryerText(hd), note: hairdryerLow(hd) ? LOW_NOTE : undefined },
    { icon: 'scrub', label: '세신', text: price || pay ? [price, pay].filter(Boolean).join(' · ') : null }, // 요금·결제를 한 줄로
  ]
}

/** 값의 성격. good = 걱정 없는 것(무제한·무료·카드 가능), cost = 돈·준비가 필요한 것(유료·현금만·없음), plain = 그 밖(장 수·요금) */
type Tone = 'good' | 'cost' | 'plain'
type Part = { text: string; tone: Tone }
type Tile = { icon: PriceIconName; label: string; parts: Part[]; note?: string } // parts가 비면 아직 모르는 칸

const dryerTone = (d: DryerInfo): Tone => (d.none || d.paid === true ? 'cost' : d.paid === false ? 'good' : 'plain')

/** 한 탕의 세 칸(수건·드라이기·세신). 그 탕 값이 없으면 탕 구분 없는 공통 값을 쓰고, 그것도 없으면 parts가 빈다 */
function sideTiles(f: Facts | undefined, side: BathSide): Tile[] {
  const tw = f?.towel?.[side]
  const hd = f?.hairdryer
  const se = f?.seshin
  const one = hd?.[side]
  const dryer = one && dryerOne(one) ? one : hd && dryerOne(hd) ? hd : null
  const price = se?.price_full ?? (side === 'women' ? se?.price_women : se?.price_men)
  const seshin: Part[] = []
  if (price != null) seshin.push({ text: won(price), tone: 'plain' })
  if (se?.payment) seshin.push(se.payment === 'cash_only' ? { text: '현금만', tone: 'cost' } : { text: '카드 가능', tone: 'good' })
  return [
    { icon: 'towel', label: '수건', parts: tw ? [{ text: towelOne(tw), tone: tw.mode === 'unlimited' ? 'good' : 'plain' }] : [] },
    { icon: 'hairdryer', label: '드라이기', parts: dryer ? [{ text: dryerOne(dryer)!, tone: dryerTone(dryer) }] : [], note: dryer?.low ? LOW_NOTE : undefined },
    { icon: 'scrub', label: '세신', parts: seshin },
  ]
}

// 마지막에 본 탕을 이 브라우저에 기억한다(다음 목욕탕을 열어도 같은 탕부터 보인다). 개인정보가 아니고 서버로 보내지 않는다
const SIDE_KEY = 'tangbang:bath-side'
const savedSide = (): BathSide => {
  try {
    return localStorage.getItem(SIDE_KEY) === 'men' ? 'men' : 'women'
  } catch {
    return 'women'
  }
}

/** 값이 하나라도 있는 줄만(있는지 없는지 판단할 때 쓴다) */
export function worries(f: Facts | undefined): WorryRow[] {
  return worryRows(f).filter((r) => r.text)
}

const yn = (v: boolean | undefined, yes: string, no: string) => (v == null ? null : v ? yes : no)

type Row = [string, string]
const rows = (list: (Row | null)[]) => list.filter((r): r is Row => r != null)

function groups(f: Facts): { title: string; rows: Row[] }[] {
  const s = f.seshin
  const fa = f.facility
  const sp = f.supplies
  const cv = f.convenience
  const all = [
    { title: '영업시간', rows: rows(WEEK.map((d): Row | null => (cv?.hours?.[d] ? [d, cv.hours[d]!] : null))) }, // 요일별(가게 등록 문구 그대로)
    {
      title: '세신',
      rows: rows([
        s?.price_full != null ? ['전신 세신', won(s.price_full)] : null,
        s?.price_women != null ? ['여탕 전신 세신', won(s.price_women)] : null,
        s?.price_men != null ? ['남탕 전신 세신', won(s.price_men)] : null,
        s?.price_mini != null ? ['미니 세신', won(s.price_mini)] : null,
        s?.beds != null ? ['세신대', `${s.beds}개`] : null,
        s?.reservation != null ? ['예약', s.reservation ? '가능' : '불가'] : null,
      ]),
    },
    {
      title: '시설',
      rows: rows([
        ...(fa?.baths ?? []).map((b): Row => [b.name, b.temp_c != null ? `${b.temp_c}℃` : '온도 미확인']), // 온도는 숫자로 함께 보여 준다
        fa?.sauna?.length ? ['사우나', fa.sauna.join(', ')] : null,
        yn(fa?.open_air, '있음', '없음') ? ['노천탕', yn(fa?.open_air, '있음', '없음')!] : null,
        fa?.water ? ['수질', fa.water] : null,
      ]),
    },
    {
      title: '소모품',
      rows: rows([
        yn(sp?.shampoo, '구비', '미구비') ? ['샴푸', yn(sp?.shampoo, '구비', '미구비')!] : null,
        yn(sp?.bodywash, '구비', '미구비') ? ['바디워시', yn(sp?.bodywash, '구비', '미구비')!] : null,
      ]),
    },
    {
      title: '편의',
      rows: rows([
        cv?.parking_height_m != null ? ['주차 층고 제한', `${cv.parking_height_m}m`] : null,
        yn(cv?.open_24h, '24시간 운영', '24시간 아님') ? ['24시간', yn(cv?.open_24h, '24시간 운영', '24시간 아님')!] : null,
        cv?.closed_days ? ['휴무일', cv.closed_days] : null,
        yn(cv?.sleeping_room, '있음', '없음') ? ['수면실', yn(cv?.sleeping_room, '있음', '없음')!] : null,
      ]),
    },
  ]
  return all.filter((g) => g.rows.length) // 데이터가 하나라도 있는 그룹만
}

/** 가기 전 알아 둘 것: 등록 정보와 실제가 다른 점(시설 운영 중단, 이른 마감). 후기에서 나온 것이라 날짜·출처·건수를 같이 보여 준다. 없으면 그리지 않는다 */
export function Notices({ facts }: { facts?: Facts }) {
  const list = facts?.notices ?? []
  if (!list.length) return null
  const ym = (d: string) => `${d.slice(0, 4)}년 ${Number(d.slice(5, 7))}월`
  return (
    <section className="sec notice" aria-labelledby="notice-h">
      <h3 id="notice-h">가기 전 알아 둘 것</h3>
      <ul>
        {list.map((n) => (
          <li key={n.text}>
            <b>{n.text}</b>
            <span>
              {n.source ?? '후기'} {ym(n.date)} 기준{n.count && n.count > 1 ? ` · ${n.count}건` : ''}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** 가기 전 걱정 TOP 3. 상세에서 항상 요금 위 같은 자리에 둔다. 값이 하나도 없으면 아직 모른다는 안내와 알려 주기 버튼을, 일부만 있으면 모르는 줄은 '정보 없음'과 알려 주기 링크를 보여 준다. */
/** onAsk(side, focus): 보던 탕과 누른 칸을 넘겨, 제보 창이 그 탕·그 칸으로 열리게 한다 */
export function TopWorries({ facts, onAsk }: { facts?: Facts; onAsk?: (side?: BathSide, focus?: 'towel' | 'dryer' | 'seshin') => void }) {
  const [side, setSide] = useState<BathSide>(savedSide)
  const list = worryRows(facts)
  if (!list.some((r) => r.text)) {
    return (
      <section className="sec worry ask" aria-labelledby="worry-h">
        <h3 id="worry-h">{CHECK_TITLE}</h3>
        <p className="small">수건, 드라이기, 세신 정보는 아직 확인하지 못했어요. 다녀오셨다면 알려 주세요.</p>
        {onAsk && (
          <button type="button" className="btn ghost sm" onClick={() => onAsk()}>
            알고 있는 정보 알려 주기
          </button>
        )}
      </section>
    )
  }
  const pick = (k: BathSide) => {
    setSide(k)
    try {
      localStorage.setItem(SIDE_KEY, k)
    } catch {
      /* 저장이 막힌 브라우저에서는 이번 화면에서만 바뀐다 */
    }
  }
  const tiles = sideTiles(facts, side)
  // 위: [여탕 / 남탕] 탭. 한 번 누르면 아래 세 칸이 그 탕 값으로 바뀐다. 아래: 수건·드라이기·세신을 아이콘 타일로 한 줄에.
  // 그 탕 값이 없는 칸은 '알려 주기'로 채운다(숨기지 않는다)
  return (
    <section className="sec worry" aria-labelledby="worry-h">
      <div className="worry-top">
        <h3 id="worry-h">{CHECK_TITLE}</h3>
        <div className="bath-tabs" role="group" aria-label="어느 탕 정보를 볼지 고르기">
          {(['women', 'men'] as const).map((k) => (
            <button key={k} type="button" className={side === k ? 'on' : ''} aria-pressed={side === k} onClick={() => pick(k)}>
              <BathBadge side={k} />
            </button>
          ))}
        </div>
      </div>
      <ul className="worry-tiles" aria-label={`${BATH_LABEL[side]} 정보`}>
        {tiles.map((w) => (
          <li key={w.label}>
            <PriceIcon name={w.icon} />
            <span>{w.label}</span>
            {w.parts.length ? (
              <span className="vals">
                {w.parts.map((v, i) => (
                  <b key={v.text} className={`v v--${v.tone}`}>
                    {v.tone === 'cost' && (
                      <i className="coin" aria-hidden="true">
                        <img src={wonIcon} alt="" width={10} height={10} />
                      </i>
                    )}
                    {v.text}
                    {w.note && i === w.parts.length - 1 && <InfoTip text={w.note} />}
                  </b>
                ))}
              </span>
            ) : onAsk ? (
              // 모르는 칸은 흐린 글자 대신 누르는 버튼으로: 아는 사람이 바로 채울 수 있게
              <button type="button" className="tile-ask" onClick={() => onAsk(side, w.icon === 'towel' ? 'towel' : w.icon === 'hairdryer' ? 'dryer' : 'seshin')} aria-label={`${BATH_LABEL[side]} ${w.label} 정보 알려 주기`}>
                <span aria-hidden="true">+</span> 알려 주기
              </button>
            ) : (
              <b className="none">정보 없음</b>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

/** 상세 화면 요금 카드 안의 요금 줄. 대인·소인·찜질복·야간 입장·시간 초과를 아이콘 줄로 바로 보여 준다(Figma 437:9469). 값이 있는 줄만 넣는다. 대인만 있어도 보여 준다(상세는 정보를 최대한 보여 준다, 2026-11-02). */
export function FeeDetails({ price, fees }: { price: Price; fees?: Facts['fees'] }) {
  const night = fees?.night
  const rows: { icon: PriceIconName; label: string; value: string; note?: string }[] = []
  if (price.adult != null) rows.push({ icon: 'adult', label: '대인', value: won(price.adult) })
  if (price.child != null) rows.push({ icon: 'child', label: '소인', value: won(price.child) })
  if (fees?.clothes != null) rows.push({ icon: 'clothes', label: '찜질복', value: won(fees.clothes) })
  if (night) rows.push({ icon: 'night', label: '야간 입장', value: night.extra != null ? '+' + won(night.extra) : won(night.price), note: night.extra != null ? `야간 ${won(night.price)}` : '야간 요금' })
  if (fees?.overtime) rows.push({ icon: 'overtime', label: '시간 초과', value: '+' + won(fees.overtime.price), note: fees.overtime.label })
  if (!rows.length) return null
  return (
    <div className="fee-list">
      {rows.map((r) => (
        <div className="fee-row" key={r.icon}>
          <PriceIcon name={r.icon} />
          <span>
            {r.label}
            {r.note && <small>{r.note}</small>}
          </span>
          <b>{r.value}</b>
        </div>
      ))}
    </div>
  )
}

/** 세부 정보. 그룹마다 접혀 있고(기본 닫힘), 키보드로 열고 닫는다. */
export function FactsDetails({ facts }: { facts?: Facts }) {
  if (!facts) return null
  const gs = groups(facts)
  if (!gs.length) return null
  return (
    <section className="sec facts">
      <h3>세부 정보</h3>
      {gs.map((g) => (
        <details key={g.title}>
          <summary>{g.title}</summary>
          {g.rows.map(([k, v]) => (
            <div className="pr" key={k}>
              <span>{k}</span>
              <b>{v}</b>
            </div>
          ))}
        </details>
      ))}
      {(facts.checked || facts.source) && (
        <p className="small">
          확인일 {facts.checked || '미상'} · 출처 {facts.source || '미상'}
        </p>
      )}
    </section>
  )
}

const WEEK: DayKo[] = ['월', '화', '수', '목', '금', '토', '일']
const DAY_OF_TODAY: DayKo[] = ['일', '월', '화', '수', '목', '금', '토'] // Date.getDay() 순서

/** 주소 아래 한 줄: 24시간 영업 여부, 오늘 영업시간, 휴무일. 가게가 등록한 값이 있을 때만 나온다(없으면 null). */
export function hoursText(f: Facts | undefined): string | null {
  const cv = f?.convenience
  const today = cv?.hours?.[DAY_OF_TODAY[new Date().getDay()]]
  const parts = [cv?.open_24h && '24시간 영업', today && `오늘 ${today}`, cv?.closed_days].filter(Boolean)
  return parts.length ? parts.join(' · ') : null
}

/** 데이터에 있는 항목은 '아직 모르는 정보' 문구에서 뺀다. */
export function unknownList(facts?: Facts): string[] {
  const f = facts
  return [
    !f?.convenience?.open_24h && !f?.convenience?.hours && '운영시간',
    !f?.convenience?.closed_days && '휴무일',
    f?.facility?.open_air == null && '노천탕',
    '가족탕·개인탕',
    f?.convenience == null && '주차·편의시설',
  ].filter((x): x is string => !!x)
}
