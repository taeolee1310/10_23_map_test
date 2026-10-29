import { won, type Facts, type TowelMode } from '../../lib/onsen'

// 값이 있는 것만 문구로 만든다. 없는 칸은 null이라 화면에서 통째로 빠진다.
const towelOne = (t: TowelMode) => (t.mode === 'unlimited' ? '무제한 제공' : t.count != null ? `${t.count}장 제공` : '장수 제한')

export function towelText(t: Facts['towel']): string | null {
  const w = t?.women
  const m = t?.men
  if (!w && !m) return null
  if (w && m && w.mode === m.mode && w.count === m.count) return '수건 ' + towelOne(w)
  return [w && '여탕 수건 ' + towelOne(w), m && '남탕 수건 ' + towelOne(m)].filter(Boolean).join(' · ')
}

export function worries(f: Facts | undefined): { label: string; text: string }[] {
  if (!f) return []
  const out: { label: string; text: string }[] = []
  if (f.seshin?.payment) out.push({ label: '세신 결제', text: f.seshin.payment === 'cash_only' ? '세신 현금 결제만 가능' : '세신 카드 결제 가능' })
  const towel = towelText(f.towel)
  if (towel) out.push({ label: '수건', text: towel })
  if (f.hairdryer) out.push({ label: '헤어드라이기', text: f.hairdryer.paid ? '드라이기 유료' : '드라이기 무료' })
  return out
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

/** 가기 전 걱정 TOP 3. 값이 하나도 없으면 영역 자체를 그리지 않는다. */
export function TopWorries({ facts }: { facts?: Facts }) {
  const list = worries(facts)
  if (!list.length) return null
  return (
    <section className="sec worry" aria-labelledby="worry-h">
      <h3 id="worry-h">가기 전 걱정 TOP 3</h3>
      <ul>
        {list.map((w) => (
          <li key={w.label}>
            <span>{w.label}</span>
            <b>{w.text}</b>
          </li>
        ))}
      </ul>
    </section>
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
