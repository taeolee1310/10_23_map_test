import { useEffect, useMemo, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { bigThreshold, build, byGu, count, FRESH, pct, type GuRow, type Item, type Raw } from './metrics'

// 수집한 목록·데이터를 PO 관점(커버리지 → 빈 곳 → 다음 할 일)으로 보는 화면.
// 막대는 한 가지 색(Bath Teal) 단일 계열이라 범례 없이 제목과 숫자 라벨로 읽는다. 상태는 색 + 글자로 같이 보여 준다.

type Filter = 'all' | 'noPrice' | 'noNaver' | 'noTop3' | 'stale' | 'idFail' | 'big'
const FILTERS: { id: Filter; label: string; test: (x: Item) => boolean }[] = [
  { id: 'all', label: '전체', test: () => true },
  { id: 'big', label: '대형 시설', test: (x) => !!x.big },
  { id: 'noPrice', label: '요금 미확인', test: (x) => !x.priceOk },
  { id: 'noTop3', label: 'TOP 3 없음', test: (x) => x.top3 === 0 },
  { id: 'noNaver', label: '네이버 미연결', test: (x) => !x.linked },
  { id: 'idFail', label: 'ID 못 찾음', test: (x) => x.idResult.startsWith('못 찾음') },
  { id: 'stale', label: '30일 넘은 수집', test: (x) => x.ageDays != null && x.ageDays > 30 },
]
type SortKey = 'gu' | 'total' | 'linked' | 'home' | 'price' | 'top3'
const PAGE = 100

const fmt = (v: number) => v.toLocaleString('ko-KR')
const planName = (p: string) =>
  p === 'all' ? '수집 시작(전체)' : p.startsWith('tool:') ? p.slice(5) : ({ prepare: '목록 만들기', fetch: 'ego로 받기', read: '페이지 읽기', judge: '판정', merge: '합치기', export: '화면 데이터' } as Record<string, string>)[p] ?? p

function Bar({ label, value, total, note, muted }: { label: string; value: number; total: number; note?: string; muted?: boolean }) {
  const p = pct(value, total)
  return (
    <div className="hbar" title={`${label}: ${fmt(value)} / ${fmt(total)}곳 (${p}%)${note ? ` — ${note}` : ''}`}>
      <div className="hbar-label">{label}</div>
      <div className="hbar-track">
        <div className={muted ? 'hbar-fill muted' : 'hbar-fill'} style={{ width: `${Math.max(p, value > 0 ? 1 : 0)}%` }} />
      </div>
      <div className="hbar-value">
        <strong>{p}%</strong> <span>{fmt(value)}곳</span>
      </div>
    </div>
  )
}

function Meter({ a, b }: { a: number; b: number }) {
  const p = pct(a, b)
  return (
    <div className="meter" title={`${fmt(a)} / ${fmt(b)}곳`}>
      <span className="meter-num">{Math.round(p)}%</span>
      <span className="meter-track"><span className="meter-fill" style={{ width: `${p}%` }} /></span>
    </div>
  )
}

export default function Dashboard({ active }: { active: boolean }) {
  const [raw, setRaw] = useState<Raw | null>(null)
  const [err, setErr] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [gu, setGu] = useState('')
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({ key: 'price', asc: true })
  const [shown, setShown] = useState(PAGE)

  const load = () =>
    invoke<Raw>('dashboard')
      .then((r) => {
        setRaw(r)
        setErr('')
      })
      .catch((e) => setErr(String(e)))
  // 처음 한 번은 숨겨져 있어도 읽어 둔다(안내가 대시보드 요소를 바로 비출 수 있게). 이후엔 탭을 열 때마다 다시 읽는다
  useEffect(() => {
    load()
  }, [])
  useEffect(() => {
    if (active) load()
  }, [active])

  // 대형 시설: 공공데이터 면적 상위 5%. '동네 목욕탕' 범위인지 사람이 보고 판단하도록 표시만 한다(자동으로 빼지 않음)
  const items = useMemo(() => {
    const xs = raw ? build(raw) : []
    const thr = bigThreshold(xs)
    return xs.map((x) => ({ ...x, big: x.area != null && x.area >= thr }))
  }, [raw])
  const bigMin = useMemo(() => Math.min(...items.filter((x) => x.big).map((x) => x.area ?? Infinity)), [items])
  const total = items.length
  const k = useMemo(
    () => ({
      price: count(items, (x) => x.priceOk),
      child: count(items, (x) => x.childOk),
      top3any: count(items, (x) => x.top3 > 0),
      towel: count(items, (x) => !!x.facts?.towel),
      dryer: count(items, (x) => !!x.facts?.hairdryer),
      seshin: count(items, (x) => !!x.facts?.seshin),
      hours: count(items, (x) => x.hours),
      facts: count(items, (x) => !!x.facts),
      parking: count(items, (x) => x.parking != null),
      photo: count(items, (x) => !!x.photo),
      tel: count(items, (x) => !!x.tel),
      linked: count(items, (x) => x.linked),
      home: count(items, (x) => x.homeOk),
      review: count(items, (x) => !!x.reviewDate),
      blog: count(items, (x) => !!x.blogDate),
      fresh30: count(items, (x) => x.homeOk && x.ageDays != null && x.ageDays <= 30),
      stale: count(items, (x) => x.ageDays != null && x.ageDays > 30),
      idFail: count(items, (x) => x.idResult.startsWith('못 찾음')),
      idWeak: count(items, (x) => x.idResult === '못 찾음(기준 미달)'),
      untried: count(items, (x) => !x.linked && !x.idResult),
    }),
    [items],
  )
  const guRows = useMemo(() => {
    const rows = byGu(items)
    const val = (r: GuRow) => (sort.key === 'gu' ? r.gu : sort.key === 'total' ? r.total : pct(r[sort.key], r.total))
    return rows.sort((a, b) => {
      const x = val(a), y = val(b)
      const c = typeof x === 'string' ? x.localeCompare(y as string, 'ko') : (x as number) - (y as number)
      return (sort.asc ? c : -c) || a.gu.localeCompare(b.gu, 'ko')
    })
  }, [items, sort])
  const worstGu = useMemo(() => byGu(items).filter((r) => r.total >= 5).sort((a, b) => pct(a.price, a.total) - pct(b.price, b.total))[0], [items])
  const gus = useMemo(() => [...new Set(items.map((x) => x.gu))].sort((a, b) => a.localeCompare(b, 'ko')), [items])
  const list = useMemo(() => {
    const t = FILTERS.find((f) => f.id === filter)!.test
    const s = q.trim().toLowerCase()
    return items.filter((x) => t(x) && (!gu || x.gu === gu) && (!s || x.name.toLowerCase().includes(s)))
  }, [items, filter, gu, q])
  useEffect(() => setShown(PAGE), [filter, gu, q])

  const todo = (raw?.todoFind ?? 0) + (raw?.todoHome ?? 0)
  const runs = [...(raw?.runs ?? [])].reverse().slice(0, 12)
  const goList = (f: Filter, g = '') => {
    setFilter(f)
    setGu(g)
    setQ('')
    document.getElementById('explorer')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  // 다음에 할 일: 효과가 큰 순서(빈 곳 수가 많은 것부터)
  const actions = [
    { n: total - k.price, text: `요금 미확인 ${fmt(total - k.price)}곳`, why: '사용자가 가장 먼저 보는 정보. 화면에서는 예시 요금으로 채워져 있어요', go: () => goList('noPrice') },
    worstGu && { n: worstGu.total - worstGu.price, text: `요금 확인률이 가장 낮은 구: ${worstGu.gu} ${Math.round(pct(worstGu.price, worstGu.total))}%`, why: `${fmt(worstGu.total)}곳 중 ${fmt(worstGu.price)}곳만 확인 (5곳 이상인 구 기준)`, go: () => goList('noPrice', worstGu.gu) },
    { n: total - k.top3any, text: `TOP 3(수건·드라이기·세신) 정보 없는 곳 ${fmt(total - k.top3any)}곳`, why: '가기 전 걱정거리. 네이버 홈 수집 → 판정으로 채워요', go: () => goList('noTop3') },
    { n: k.linked - k.review, text: `방문자 후기 안 받은 곳 ${fmt(Math.max(k.linked - k.review, 0))}곳`, why: 'TOP 3(수건·드라이기·세신) 판정의 주요 근거예요. 수집 시작을 누르면 150곳씩 받아요' },
    { n: k.linked - k.blog, text: `블로그 리뷰 안 받은 곳 ${fmt(Math.max(k.linked - k.blog, 0))}곳`, why: '요금·수건 안내가 자세한 글이 많아요. 후기 다음 순서로 받아요' },
    { n: k.idFail, text: `네이버 ID 못 찾음 ${fmt(k.idFail)}곳`, why: `그중 ${fmt(k.idWeak)}곳은 후보는 있었지만 기준 미달. 사람이 확인해 curated/naver_match_manual.csv에 넣어요`, go: () => goList('idFail') },
    { n: count(items, (x) => !!x.big), text: `대형 시설 ${fmt(count(items, (x) => !!x.big))}곳(공공데이터 면적 ${fmt(Math.round(bigMin))}㎡ 이상)`, why: '동네 목욕탕 느낌인지 사람이 보고 판단해요. 빼려면 Claude에게 이름을 알려 주세요(자동으로 빼지 않아요)', go: () => goList('big') },
    { n: k.stale, text: `수집한 지 30일 넘은 곳 ${fmt(k.stale)}곳`, why: '요금·영업 정보가 바뀌었을 수 있어요', go: () => goList('stale') },
    { n: todo, text: `받을 페이지 ${fmt(todo)}개 남음`, why: "'수집 시작'을 누르면 한 번에 150곳씩 받아요" },
  ]
    .filter((a): a is { n: number; text: string; why: string; go?: () => void } => !!a && a.n > 0)
    .sort((a, b) => b.n - a.n)

  if (err) return <div className="dash"><div className="toast toast-error" role="alert">{err}</div></div>
  if (!raw) return <div className="dash"><p className="hint">불러오는 중…</p></div>
  if (!total) return <div className="dash"><div className="card"><p>화면 데이터(onsen.json)가 비어 있어요. 수집 탭에서 '화면 데이터 만들기'를 실행해 주세요.</p></div></div>

  const sortBtn = (key: SortKey, label: string) => (
    <th scope="col" aria-sort={sort.key === key ? (sort.asc ? 'ascending' : 'descending') : 'none'}>
      <button className="th-btn" onClick={() => setSort((s) => ({ key, asc: s.key === key ? !s.asc : key === 'gu' }))}>
        {label}
        <span aria-hidden className="th-arrow">{sort.key === key ? (sort.asc ? '▲' : '▼') : ''}</span>
      </button>
    </th>
  )

  return (
    <div className="dash">
      <div className="dash-head">
        <p className="hint">
          기준: 화면 데이터 <strong>{fmt(total)}곳</strong> · 데이터 기준일 {raw.baseDate ?? '–'} · 숫자는 파일에서 바로 계산해요
        </p>
        <button className="btn btn-outline btn-sm" onClick={load} data-tour="reload" title="데이터 파일을 다시 읽어 숫자를 새로 세요. 수집은 하지 않아요">숫자 다시 읽기</button>
      </div>

      <section className="kpis" aria-label="핵심 지표" data-tour="kpis">
        {[
          { t: '요금 확인', a: k.price, d: '대인 요금이 확인된 곳(가격표·공식·제보 확인)' },
          { t: 'TOP 3 정보', a: k.top3any, d: '수건·드라이기·세신 중 하나라도 확인' },
          { t: '네이버 연결', a: k.linked, d: '네이버 플레이스 ID가 이어진 곳' },
          { t: '홈 수집 완료', a: k.home, d: '네이버 홈 페이지를 받아 읽은 곳' },
          { t: '30일 안 수집', a: k.fresh30, d: '홈 수집일이 30일 이내' },
        ].map((x) => (
          <div className="kpi" key={x.t} title={x.d}>
            <div className="kpi-title">{x.t}</div>
            <div className="kpi-value">{pct(x.a, total)}<small>%</small></div>
            <div className="kpi-sub">{fmt(x.a)} / {fmt(total)}곳</div>
            <div className="kpi-bar"><span style={{ width: `${pct(x.a, total)}%` }} /></div>
          </div>
        ))}
      </section>

      <div className="dash-grid">
        <section className="card" aria-labelledby="todo-t" data-tour="actions">
          <h2 id="todo-t" className="card-title">다음에 할 일</h2>
          <ol className="actions">
            {actions.map((a, i) => (
              <li key={i} className="action">
                <span className="action-rank">{i + 1}</span>
                <div className="action-body">
                  <div className="action-text">{a.text}</div>
                  <div className="action-why">{a.why}</div>
                </div>
                {a.go && <button className="btn btn-outline btn-sm" onClick={a.go}>목록 보기</button>}
              </li>
            ))}
            {actions.length === 0 && <li className="hint">비어 있는 곳이 없어요</li>}
          </ol>
        </section>

        <section className="card" aria-labelledby="stage-t">
          <h2 id="stage-t" className="card-title">단계별 확보 현황</h2>
          <p className="hint chart-note">전체 {fmt(total)}곳 대비. 요금은 네이버 말고 공식·제보로도 채워지므로 단계마다 따로 셌어요.</p>
          <Bar label="화면에 나오는 곳" value={total} total={total} />
          <Bar label="네이버 연결" value={k.linked} total={total} />
          <Bar label="홈 수집 완료" value={k.home} total={total} />
          <Bar label="후기 수집 완료" value={k.review} total={total} note="방문자 후기 탭(방문일 포함). TOP 3 판정 근거" />
          <Bar label="블로그 수집 완료" value={k.blog} total={total} note="블로그 리뷰 탭(작성일 포함). TOP 3 판정 근거" />
          <Bar label="시설 정보 판정됨" value={k.facts} total={total} note="facts가 하나라도 있음" />
          <Bar label="요금 확인" value={k.price} total={total} />
        </section>

        <section className="card" aria-labelledby="field-t">
          <h2 id="field-t" className="card-title">항목별 채움률</h2>
          <p className="hint chart-note">상세 화면에 보이는 항목. 낮을수록 &lsquo;알려 주기&rsquo;로 보이는 곳이 많아요.</p>
          <Bar label="대인 요금" value={k.price} total={total} />
          <Bar label="소인 요금" value={k.child} total={total} />
          <Bar label="수건" value={k.towel} total={total} />
          <Bar label="드라이기" value={k.dryer} total={total} />
          <Bar label="세신" value={k.seshin} total={total} />
          <Bar label="영업시간·휴무" value={k.hours} total={total} />
          <Bar label="주차" value={k.parking} total={total} />
          <Bar label="사진" value={k.photo} total={total} />
          <Bar label="전화번호" value={k.tel} total={total} />
        </section>

        <section className="card" aria-labelledby="fresh-t">
          <h2 id="fresh-t" className="card-title">수집 신선도</h2>
          <p className="hint chart-note">네이버 홈 수집일 기준(오늘 {new Date().toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' })}, 한국 시간).</p>
          {FRESH.map((f) => (
            <Bar key={f.key} label={f.key} value={count(items, (x) => f.test(x.ageDays))} total={total} muted={f.key === '수집 안 함'} />
          ))}
          <h3 className="sub-title">네이버 ID 찾기 결과</h3>
          <dl className="mini">
            <div><dt>이미 연결</dt><dd>{fmt(k.linked)}곳</dd></div>
            <div><dt>못 찾음</dt><dd>{fmt(k.idFail - k.idWeak)}곳</dd></div>
            <div><dt>기준 미달(사람 확인)</dt><dd>{fmt(k.idWeak)}곳</dd></div>
            <div><dt>아직 안 찾아봄</dt><dd>{fmt(k.untried)}곳</dd></div>
          </dl>
        </section>
      </div>

      <section className="card" aria-labelledby="gu-t">
        <h2 id="gu-t" className="card-title">구별 커버리지</h2>
        <p className="hint chart-note">기본은 요금 확인률이 낮은 구부터. 머리글을 누르면 정렬이 바뀌어요. 행을 누르면 그 구의 미확인 목록으로 가요.</p>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                {sortBtn('gu', '구')}
                {sortBtn('total', '곳 수')}
                {sortBtn('linked', '네이버 연결')}
                {sortBtn('home', '홈 수집')}
                {sortBtn('price', '요금 확인')}
                {sortBtn('top3', 'TOP 3')}
              </tr>
            </thead>
            <tbody>
              {guRows.map((r) => (
                <tr key={r.gu} className="row-link" onClick={() => goList('noPrice', r.gu)}>
                  <th scope="row">{r.gu}</th>
                  <td className="num">{fmt(r.total)}</td>
                  <td><Meter a={r.linked} b={r.total} /></td>
                  <td><Meter a={r.home} b={r.total} /></td>
                  <td><Meter a={r.price} b={r.total} /></td>
                  <td><Meter a={r.top3} b={r.total} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card" id="explorer" aria-labelledby="list-t">
        <h2 id="list-t" className="card-title">
          장소 목록 <span className="count">{fmt(list.length)}곳</span>
        </h2>
        <div className="filters">
          <input className="input" type="search" placeholder="이름으로 찾기" value={q} onChange={(e) => setQ(e.target.value)} aria-label="이름으로 찾기" />
          <select className="input" value={gu} onChange={(e) => setGu(e.target.value)} aria-label="구">
            <option value="">서울 전체</option>
            {gus.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </div>
        <div className="chips" role="radiogroup" aria-label="상태로 거르기">
          {FILTERS.map((f) => (
            <button key={f.id} role="radio" aria-checked={filter === f.id} className={filter === f.id ? 'chip on' : 'chip'} onClick={() => setFilter(f.id)}>
              {f.label} <span className="chip-n">{fmt(count(items, (x) => f.test(x) && (!gu || x.gu === gu)))}</span>
            </button>
          ))}
        </div>
        {list.length === 0 ? (
          <div className="empty">
            <p>조건에 맞는 곳이 없어요.</p>
            <button className="btn btn-outline btn-sm" onClick={() => goList('all')}>필터 초기화</button>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">이름</th>
                  <th scope="col">구</th>
                  <th scope="col">구분</th>
                  <th scope="col">대인 요금</th>
                  <th scope="col">TOP 3</th>
                  <th scope="col">네이버</th>
                  <th scope="col">홈 수집일</th>
                  <th scope="col">면적(공공데이터)</th>
                </tr>
              </thead>
              <tbody>
                {list.slice(0, shown).map((x) => (
                  <tr key={x.id}>
                    <th scope="row" className="name">{x.name}</th>
                    <td>{x.gu}</td>
                    <td>{x.kind}</td>
                    <td className="num">
                      {x.priceOk ? `${fmt(x.price!.adult!)}원` : <span className="tag tag-muted">미확인</span>}
                    </td>
                    <td>{x.top3 > 0 ? `${x.top3}/3` : <span className="tag tag-muted">없음</span>}</td>
                    <td>
                      {x.linked ? <span className="tag tag-ok">연결</span> : x.idResult ? <span className="tag tag-warn">{x.idResult}</span> : <span className="tag tag-muted">안 찾아봄</span>}
                    </td>
                    <td className="num">
                      {x.homeDate || '–'}
                      {x.ageDays != null && x.ageDays > 30 && <span className="tag tag-warn">오래됨</span>}
                    </td>
                    <td className="num" title={x.bizType}>
                      {x.area ? `㎡` : '–'}
                      {x.big && <span className="tag tag-warn">대형</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {list.length > shown && (
              <button className="btn btn-outline more" onClick={() => setShown((s) => s + PAGE)}>
                {fmt(Math.min(PAGE, list.length - shown))}곳 더 보기 ({fmt(shown)}/{fmt(list.length)})
              </button>
            )}
          </div>
        )}
      </section>

      <section className="card" aria-labelledby="runs-t">
        <h2 id="runs-t" className="card-title">수집 기록 <span className="count">이 PC 최근 {runs.length}번</span></h2>
        {runs.length === 0 ? (
          <p className="hint">아직 이 도구로 실행한 기록이 없어요.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">언제</th>
                  <th scope="col">무엇을</th>
                  <th scope="col">방법</th>
                  <th scope="col">결과</th>
                  <th scope="col">저장</th>
                  <th scope="col">걸린 시간</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r, i) => (
                  <tr key={i}>
                    <td className="num">{new Date(r.at * 1000).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                    <td>{planName(r.plan)}</td>
                    <td>{r.engine === 'claude' ? 'Claude' : r.engine === 'direct' ? '직접' : '–'}</td>
                    <td>
                      <span className={r.ok ? 'tag tag-ok' : 'tag tag-warn'}>{r.ok ? '완료' : '멈춤'}</span> <span className="run-msg">{r.message}</span>
                    </td>
                    <td className="num">{r.saved != null ? `${fmt(r.saved)}개` : '–'}</td>
                    <td className="num">{r.seconds >= 60 ? `${Math.round(r.seconds / 60)}분` : `${r.seconds}초`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
