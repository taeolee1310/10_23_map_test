import { won, type Facts, type Price, type TowelMode } from '../../lib/onsen'
import PriceIcon, { type PriceIconName } from '../../components/PriceIcon/PriceIcon'

// 값이 있는 것만 문구로 만든다. 없는 칸은 null이라 화면에서 통째로 빠진다.
const towelOne = (t: TowelMode) => (t.mode === 'unlimited' ? '무제한 제공' : t.count != null ? `${t.count}장 제공` : '장수 제한')

export function towelText(t: Facts['towel']): string | null {
  const w = t?.women
  const m = t?.men
  if (!w && !m) return null
  if (w && m && w.mode === m.mode && w.count === m.count) return '수건 ' + towelOne(w)
  return [w && '여탕 수건 ' + towelOne(w), m && '남탕 수건 ' + towelOne(m)].filter(Boolean).join(' · ')
}

export function seshinPriceText(s: Facts['seshin']): string | null {
  if (!s) return null
  if (s.price_full != null) return won(s.price_full)
  const parts = [s.price_women != null && `여탕 ${won(s.price_women)}`, s.price_men != null && `남탕 ${won(s.price_men)}`].filter(Boolean)
  return parts.length ? parts.join(' · ') : null
}

type WorryRow = { icon: PriceIconName; label: string; text: string | null } // text가 null이면 아직 확인하지 못한 항목

/** 가기 전 걱정 TOP 3 세 줄(수건·드라이기·세신, Figma 순서). 확인 못 한 줄은 text가 null이다. */
function worryRows(f: Facts | undefined): WorryRow[] {
  const price = seshinPriceText(f?.seshin)
  const pay = f?.seshin?.payment ? (f.seshin.payment === 'cash_only' ? '현금 결제만 가능' : '카드 결제 가능') : null
  const hd = f?.hairdryer
  return [
    { icon: 'towel', label: '수건', text: towelText(f?.towel)?.replace(/수건 /g, '') ?? null }, // 줄 이름이 '수건'이라 값에서는 뺀다
    { icon: 'hairdryer', label: '드라이기', text: hd ? (hd.paid ? '유료' : '무료') + (hd.low ? ' (후기 1건 기준)' : '') : null },
    { icon: 'scrub', label: '세신', text: price || pay ? [price, pay].filter(Boolean).join(' · ') : null }, // 요금·결제를 한 줄로
  ]
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
        yn(cv?.sleeping_room, '있음', '없음') ? ['수면실', yn(cv?.sleeping_room, '있음', '없음')!] : null,
      ]),
    },
  ]
  return all.filter((g) => g.rows.length) // 데이터가 하나라도 있는 그룹만
}

/** 가기 전 걱정 TOP 3. 값이 하나도 없으면 비워 두지 않고, 아직 모른다는 안내와 함께 알려 주기 버튼을 보여 준다. */
export function TopWorries({ facts, onAsk }: { facts?: Facts; onAsk?: () => void }) {
  const list = worryRows(facts)
  if (!list.some((r) => r.text)) {
    return (
      <section className="sec worry ask" aria-labelledby="worry-h">
        <h3 id="worry-h">가기 전 걱정 TOP 3</h3>
        <p className="small">세신 결제 방식, 수건, 드라이기 정보는 아직 확인하지 못했어요. 알고 계시면 알려 주세요.</p>
        {onAsk && (
          <button type="button" className="btn ghost sm" onClick={onAsk}>
            알고 있는 정보 알려 주기
          </button>
        )}
      </section>
    )
  }
  return (
    <section className="sec worry" aria-labelledby="worry-h">
      <h3 id="worry-h">가기 전 걱정 TOP 3</h3>
      <ul>
        {list.map((w) => (
          <li key={w.label}>
            <PriceIcon name={w.icon} />
            <span>{w.label}</span>
            {w.text ? <b>{w.text}</b> : <b className="none">정보 없음</b>}
          </li>
        ))}
      </ul>
    </section>
  )
}

/** 요금 자세히 보기(기본 닫힘). 대인·소인·찜질복·야간 입장·시간 초과를 아이콘 줄로 보여 준다(Figma 437:9469). 값이 있는 줄만 넣고, 대인 말고는 줄이 없으면 통째로 숨긴다. */
export function FeeDetails({ price, fees }: { price: Price; fees?: Facts['fees'] }) {
  const night = fees?.night
  const rows: { icon: PriceIconName; label: string; value: string; note?: string }[] = []
  if (price.adult != null) rows.push({ icon: 'adult', label: '대인', value: won(price.adult) })
  if (price.child != null) rows.push({ icon: 'child', label: '소인', value: won(price.child) })
  if (fees?.clothes != null) rows.push({ icon: 'clothes', label: '찜질복', value: won(fees.clothes) })
  if (night) rows.push({ icon: 'night', label: '야간 입장', value: night.extra != null ? '+' + won(night.extra) : won(night.price), note: night.extra != null ? `야간 ${won(night.price)}` : '야간 요금' })
  if (fees?.overtime) rows.push({ icon: 'overtime', label: '시간 초과', value: '+' + won(fees.overtime.price), note: fees.overtime.label })
  if (!rows.some((r) => r.icon !== 'adult')) return null
  return (
    <details className="fee-more">
      <summary>요금 자세히 보기</summary>
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
    </details>
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

/** 데이터에 있는 항목은 '아직 모르는 정보' 문구에서 뺀다. */
export function unknownList(facts?: Facts): string[] {
  const f = facts
  return [
    '운영시간·휴무일',
    f?.facility?.open_air == null && '노천탕',
    '가족탕·개인탕',
    f?.convenience == null && '주차·편의시설',
  ].filter((x): x is string => !!x)
}
