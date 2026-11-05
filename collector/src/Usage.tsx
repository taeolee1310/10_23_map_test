import { useMemo } from 'react'
import { todayKst } from './time'

// Claude 사용량: 이 도구가 Claude Code(claude -p)를 부를 때마다 남긴 토큰·비용(data/collected/claude_usage.jsonl).
// 비용은 claude가 알려 준 API 요금 환산값(달러)이다. 구독으로 쓰면 돈이 따로 나가지 않고 사용 한도에서 빠진다.
// 단계는 색 + 글자 라벨을 같이 보여 준다(색만으로 구분하지 않음).

export type UsageRow = {
  at: string
  step: string
  items: number
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  costUsd: number
  ms: number
}

const KRW_PER_USD = 1400 // 어림값(화면에 '약'으로 표시)
const STEPS: { id: string; label: string; unit: string; cls: string }[] = [
  { id: 'ego 수집', label: 'ego 수집 지휘', unit: '페이지', cls: 's1' },
  { id: '사진 고르기(바둑판)', label: '사진 고르기(바둑판)', unit: '바둑판', cls: 's2' },
  { id: '사진 글자 읽기', label: '사진 글자 읽기', unit: '사진', cls: 's3' },
]

const usd = (v: number) => (v >= 10 ? `$${v.toFixed(1)}` : `$${v.toFixed(2)}`)
const krw = (v: number) => `약 ${Math.round(v * KRW_PER_USD).toLocaleString('ko-KR')}원`
const tok = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}백만` : n >= 10_000 ? `${(n / 10_000).toFixed(1)}만` : n.toLocaleString('ko-KR'))
const tokensOf = (r: UsageRow) => r.input + r.output + r.cacheRead + r.cacheWrite

function sum(rows: UsageRow[]) {
  return { cost: rows.reduce((a, r) => a + (r.costUsd || 0), 0), tokens: rows.reduce((a, r) => a + tokensOf(r), 0), calls: rows.length }
}

export default function Usage({ rows }: { rows: UsageRow[] }) {
  const today = todayKst()
  const month = today.slice(0, 7)
  const v = useMemo(() => {
    const day = (r: UsageRow) => r.at.slice(0, 10)
    const t = sum(rows.filter((r) => day(r) === today))
    const m = sum(rows.filter((r) => day(r).startsWith(month)))
    const all = sum(rows)
    const steps = STEPS.map((s) => {
      const rs = rows.filter((r) => r.step === s.id)
      const x = sum(rs)
      const items = rs.reduce((a, r) => a + (r.items || 0), 0)
      return { ...s, ...x, items, per: items ? x.cost / items : 0 }
    })
    // 최근 14일(오늘 포함) 날짜별 비용
    const days: { d: string; cost: number; calls: number }[] = []
    const base = new Date(`${today}T00:00:00+09:00`).getTime()
    for (let k = 13; k >= 0; k--) {
      const d = new Date(base - k * 86_400_000 + 9 * 3_600_000).toISOString().slice(0, 10)
      const x = sum(rows.filter((r) => day(r) === d))
      days.push({ d, cost: x.cost, calls: x.calls })
    }
    const maxDay = Math.max(...days.map((x) => x.cost), 0)
    return { t, m, all, steps, days, maxDay, recent: [...rows].reverse().slice(0, 8) }
  }, [rows, today, month])

  return (
    <section className="card usage" aria-labelledby="usage-t">
      <h2 id="usage-t" className="card-title">
        Claude 사용량 <span className="count">이 PC 기록 {v.all.calls.toLocaleString('ko-KR')}번</span>
      </h2>
      <p className="hint usage-hint">
        이 도구가 Claude Code를 부를 때마다 쓴 토큰을 API 요금으로 바꿔 보여 줘요(1달러 {KRW_PER_USD.toLocaleString('ko-KR')}원으로 어림). 구독으로 로그인해 쓰면 돈이 따로 나가지 않고 사용 한도에서 빠져요.
      </p>

      {rows.length === 0 ? (
        <p className="hint">아직 기록이 없어요. '수집 시작'에서 'Claude와 함께'로 받거나, 블로그 사진 글자 읽기가 돌면 여기에 쌓여요.</p>
      ) : (
        <>
          <div className="usage-kpis">
            {[
              { t: '오늘', x: v.t },
              { t: '이번 달', x: v.m },
              { t: '전체', x: v.all },
            ].map(({ t, x }) => (
              <div className="usage-kpi" key={t}>
                <div className="kpi-title">{t}</div>
                <div className="usage-cost">{usd(x.cost)}</div>
                <div className="kpi-sub">{krw(x.cost)}</div>
                <div className="kpi-sub">
                  토큰 {tok(x.tokens)} · 호출 {x.calls}번
                </div>
              </div>
            ))}
          </div>

          <div className="usage-grid">
            <div>
              <h3 className="usage-sub">어디에 썼나 (전체 비용 기준)</h3>
              <div className="usage-stack" role="img" aria-label={v.steps.map((s) => `${s.label} ${usd(s.cost)}`).join(', ')}>
                {v.steps
                  .filter((s) => s.cost > 0)
                  .map((s) => (
                    <span key={s.id} className={`seg ${s.cls}`} style={{ width: `${(s.cost / (v.all.cost || 1)) * 100}%` }} title={`${s.label} ${usd(s.cost)}`} />
                  ))}
              </div>
              <ul className="usage-legend">
                {v.steps.map((s) => (
                  <li key={s.id}>
                    <span className={`dot ${s.cls}`} aria-hidden="true" />
                    <span className="lg-label">{s.label}</span>
                    <strong>{usd(s.cost)}</strong>
                    <span className="lg-sub">
                      {v.all.cost ? Math.round((s.cost / v.all.cost) * 100) : 0}% · {s.items ? `${s.unit} 1개당 ${usd(s.per)}` : '기록 없음'}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h3 className="usage-sub">날짜별 비용 (최근 14일)</h3>
              <div className="usage-days" role="img" aria-label={`최근 14일 비용, 가장 많은 날 ${usd(v.maxDay)}`}>
                {v.days.map((x) => (
                  <div key={x.d} className={x.d === today ? 'day today' : 'day'} title={`${x.d} · ${usd(x.cost)} (${krw(x.cost)}) · 호출 ${x.calls}번`}>
                    <span className="day-bar" style={{ height: `${v.maxDay ? Math.max((x.cost / v.maxDay) * 100, x.cost > 0 ? 4 : 0) : 0}%` }} />
                    <span className="day-label">{Number(x.d.slice(8))}</span>
                  </div>
                ))}
              </div>
              <p className="kpi-sub usage-max">가장 많이 쓴 날 {usd(v.maxDay)}</p>
            </div>
          </div>

          <h3 className="usage-sub">최근 호출</h3>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">언제</th>
                  <th scope="col">무엇을</th>
                  <th scope="col">처리</th>
                  <th scope="col">토큰</th>
                  <th scope="col">비용</th>
                </tr>
              </thead>
              <tbody>
                {v.recent.map((r, i) => {
                  const s = STEPS.find((x) => x.id === r.step)
                  return (
                    <tr key={i}>
                      <td className="num">{r.at.slice(5, 16).replace('T', ' ')}</td>
                      <td>
                        <span className={`dot ${s?.cls ?? ''}`} aria-hidden="true" /> {s?.label ?? r.step}
                      </td>
                      <td className="num">
                        {r.items}
                        {s?.unit ?? '개'}
                      </td>
                      <td className="num">{tok(tokensOf(r))}</td>
                      <td className="num">
                        <strong>{usd(r.costUsd)}</strong>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}
