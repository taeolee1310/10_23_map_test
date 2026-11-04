import { useEffect, useMemo, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
// 미리보기는 서비스의 실제 목록 카드 컴포넌트와 CSS를 그대로 쓴다(서비스에 보이는 모양과 같게)
import PlaceList from '../../web/src/screens/MainScreen/PlaceList'
import '../../web/src/screens/MainScreen/MainScreen.css'
import type { PlaceWithDist } from '../../web/src/lib/onsen'
import { daysBefore, todayKst } from './time'

// 사진 고르기: 업체 등록 사진 후보 중 대표 사진을 사람이 골라 data/curated/place_photos.csv에 저장한다.
// 고른 사진은 '화면 데이터 만들기'(export_web_data)를 돌리면 서비스 목록 카드에 나온다.

type Cand = { kakaoId: string; naverId: string; name: string; photos: { url: string; w?: number; h?: number }[]; fetchedAt?: string }
type Activity = { review?: string; blog?: string }
type Chosen = { kakaoId: string; naverId: string; name: string; url: string; kind: string; source: string; checked: string }
type Raw = { candidates: Cand[]; chosen: Chosen[]; places: PlaceWithDist[] | null; baseDate: string | null; activity?: Record<string, Activity> }

// 네이버 업체 사진 주소의 올린 날: ldb-phinf.pstatic.net/20200606_5/… → 2020-06-06
const posted = (u: string) => {
  const m = /pstatic\.net\/(\d{4})(\d{2})(\d{2})_/.exec(u)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : ''
}
// 양질의 정보 기준: 최근 1년(365일) 안
const FRESH_FROM = daysBefore(365)

type Filter = 'todo' | 'done' | 'none' | 'all'
const KINDS = ['외관', '내부', '탕'] as const
const PAGE = 12

const fmt = (n: number) => n.toLocaleString('ko-KR')
// 서비스는 업체 사진 원본 대신 180px 정사각 썸네일 주소를 쓴다(export_web_data의 load_photos와 같은 변환)
const thumb = (u: string) =>
  'https://search.pstatic.net/common/?autoRotate=true&type=f180_180&src=' +
  encodeURIComponent(u).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())

function PickCard({
  place,
  cand,
  chosen,
  act,
  busy,
  onSave,
}: {
  place: PlaceWithDist
  cand?: Cand
  chosen?: Chosen
  act?: Activity
  busy: boolean
  onSave: (url: string, kind: string) => Promise<void>
}) {
  const photos = cand?.photos ?? []
  const lastPhoto = photos.map((p) => posted(p.url)).filter(Boolean).sort().pop() ?? ''
  const dates = [
    { label: '마지막 사진', d: lastPhoto },
    { label: '마지막 후기', d: act?.review ?? '' },
    { label: '마지막 블로그', d: act?.blog ?? '' },
  ]
  // 사진 날짜는 내외부 확인용이라 판단에서 뺀다. 후기·블로그가 1년 넘게 없으면 영업·요금이 바뀌었을 수 있다
  const quiet = dates.slice(1).every((x) => !x.d || x.d < FRESH_FROM)
  const [url, setUrl] = useState(chosen?.url ?? '')
  const initKind = chosen?.url ? chosen.kind || '외관' : '외관'
  const [kind, setKind] = useState(initKind)
  useEffect(() => {
    setUrl(chosen?.url ?? '')
    setKind(initKind)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosen?.url, chosen?.kind])
  // 아직 안 본 곳은 '사진 없이 두기'도 저장할 수 있다(확인했다는 기록)
  const changed = !chosen || url !== chosen.url || (!!url && kind !== initKind)
  // 지금 고른 사진을 넣은 서비스 목록 카드(거리·담아두기 상태는 미리보기에 필요 없어 비운다)
  const preview: PlaceWithDist = { ...place, photo: url ? thumb(url) : undefined, dist: null } as PlaceWithDist
  const noop = () => {}

  return (
    <section className="card pick" aria-label={`${place.name} 사진 고르기`}>
      <header className="pick-head">
        <div className="pick-title">
          <h3>{place.name}</h3>
          <span className="pick-sub">
            {place.gu} · {place.kind}
          </span>
        </div>
        {chosen ? (
          <span className={chosen.url ? 'tag tag-ok' : 'tag tag-muted'} title={`${chosen.checked}에 확인`}>
            {chosen.url ? `고름 · ${chosen.kind || '종류 없음'}` : '사진 없이 두기로 함'}
          </span>
        ) : (
          <span className="tag tag-muted">아직 안 고름</span>
        )}
      </header>

      <div className={quiet ? 'pick-dates quiet' : 'pick-dates'}>
        {dates.map((x) => (
          <span key={x.label} className={x.label === '마지막 사진' || (x.d && x.d >= FRESH_FROM) ? 'pick-date' : 'pick-date old'}>
            {x.label} <b>{x.d || '없음'}</b>
          </span>
        ))}
        {quiet && <span className="pick-date-note">최근 1년 후기·블로그가 없어요. 영업 여부와 요금이 바뀌었을 수 있어요.</span>}
      </div>

      {photos.length ? (
        <div className="pick-grid" role="radiogroup" aria-label="대표 사진 후보">
          {photos.map((p, i) => (
            <button
              key={p.url}
              role="radio"
              aria-checked={url === p.url}
              aria-label={`후보 ${i + 1}${chosen?.url === p.url ? ' (지금 서비스 사진)' : ''}`}
              className={url === p.url ? 'pick-tile on' : 'pick-tile'}
              onClick={() => setUrl(p.url)}
            >
              <img src={p.url} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
              {chosen?.url === p.url && <span className="pick-now">지금 사진</span>}
            </button>
          ))}
          <button role="radio" aria-checked={url === ''} className={url === '' ? 'pick-tile none on' : 'pick-tile none'} onClick={() => setUrl('')}>
            사진 없이 두기
          </button>
        </div>
      ) : (
        <p className="hint">사진 후보가 아직 없어요. 수집 탭에서 '수집 시작'을 누르면 후기 다음 순서로 사진 후보를 받아요. 업체가 등록한 사진이 아예 없는 곳도 있어요.</p>
      )}

      {url && (
        <div className="pick-kind">
          <span className="refresh-label">무엇이 찍혔나요</span>
          <div className="chips chips-sm" role="radiogroup" aria-label="사진 종류">
            {KINDS.map((k) => (
              <button key={k} role="radio" aria-checked={kind === k} className={kind === k ? 'chip on' : 'chip'} onClick={() => setKind(k)}>
                {k}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="pick-preview">
        <div className="pick-preview-label">서비스 목록에서 이렇게 보여요</div>
        <div className="onsen-main svc-preview" aria-hidden="true">
          <PlaceList
            list={[preview]}
            total={1}
            shown={1}
            selId={null}
            hotId={null}
            favs={new Set()}
            animKey={0}
            onSelect={noop}
            onDetail={noop}
            onFav={noop}
            onHover={noop}
            onMore={noop}
            onReset={noop}
            onReport={noop}
          />
        </div>
      </div>

      <div className="pick-actions">
        {changed && <span className="pick-changed">저장하지 않은 변경이 있어요</span>}
        <button className="btn btn-outline btn-sm" onClick={() => { setUrl(chosen?.url ?? ''); setKind(initKind) }} disabled={!chosen || !changed || busy}>
          되돌리기
        </button>
        <button className="btn btn-primary btn-sm" onClick={() => onSave(url, kind)} disabled={!changed || busy}>
          {url ? '이 사진으로 정하기' : '사진 없이 두기'}
        </button>
      </div>
    </section>
  )
}

export default function Photos({ active, running, onApply, onSaved }: { active: boolean; running: boolean; onApply: () => void; onSaved: () => void }) {
  const [raw, setRaw] = useState<Raw | null>(null)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [filter, setFilter] = useState<Filter>('todo')
  const [gu, setGu] = useState('')
  const [q, setQ] = useState('')
  const [shown, setShown] = useState(PAGE)
  const [busy, setBusy] = useState(false)
  const [savedCount, setSavedCount] = useState(0)

  const load = () =>
    invoke<Raw>('photos')
      .then((r) => {
        setRaw(r)
        setErr('')
      })
      .catch((e) => setErr(String(e)))
  useEffect(() => {
    if (active) load()
  }, [active])

  const cand = useMemo(() => new Map((raw?.candidates ?? []).map((c) => [c.kakaoId, c])), [raw])
  const chosen = useMemo(() => new Map((raw?.chosen ?? []).map((c) => [c.kakaoId, c])), [raw])
  const places = raw?.places ?? []
  const state = (p: PlaceWithDist): Filter => (chosen.has(p.id) ? 'done' : cand.get(p.id)?.photos?.length ? 'todo' : 'none')
  const counts = useMemo(() => {
    const c = { todo: 0, done: 0, none: 0, all: places.length }
    for (const p of places) if (!gu || p.gu === gu) c[state(p) as 'todo' | 'done' | 'none']++
    return c
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [places, cand, chosen, gu])
  const gus = useMemo(() => [...new Set(places.map((p) => p.gu))].sort((a, b) => a.localeCompare(b, 'ko')), [places])
  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    return places.filter((p) => (filter === 'all' || state(p) === filter) && (!gu || p.gu === gu) && (!s || p.name.toLowerCase().includes(s)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [places, filter, gu, q, cand, chosen])
  useEffect(() => setShown(PAGE), [filter, gu, q])

  const save = async (p: PlaceWithDist, url: string, kind: string) => {
    setBusy(true)
    setMsg('')
    try {
      await invoke('pick_photo', {
        kakaoId: p.id,
        naverId: cand.get(p.id)?.naverId ?? chosen.get(p.id)?.naverId ?? '',
        name: p.name,
        url,
        kind: url ? kind : '',
        today: todayKst(),
      })
      setSavedCount((n) => n + 1)
      onSaved()
      setMsg(url ? `${p.name}: 대표 사진을 정했어요` : `${p.name}: 사진 없이 두기로 했어요`)
      await load()
    } catch (e) {
      setMsg(String(e))
    } finally {
      setBusy(false)
    }
  }

  if (err) return <div className="dash"><div className="toast toast-error" role="alert">{err}</div></div>
  if (!raw) return <div className="dash"><p className="hint">불러오는 중…</p></div>

  const FILTERS: { id: Filter; label: string }[] = [
    { id: 'todo', label: '고를 곳' },
    { id: 'done', label: '확인한 곳' },
    { id: 'none', label: '후보 없음' },
    { id: 'all', label: '전체' },
  ]

  return (
    <div className="dash photos">
      <div className="photos-top card">
        <div className="photos-intro">
          <h2 className="card-title">대표 사진 고르기</h2>
          <p className="hint">
            네이버 업체 등록 사진 중 <strong>탕·외관·내부</strong>가 잘 보이는 한 장을 골라요. 사람 얼굴, 가격표, 다른 가게 사진은 고르지 않아요.
            고른 사진은 사람이 확인한 값으로 저장돼요(<code>data/curated/place_photos.csv</code>). ① 이 사진으로 정하기 → ② 화면 데이터에 반영 → ③ Claude Code에 커밋·푸시 요청, 세 번째까지 해야 서비스에 나와요.
          </p>
        </div>
        <div className="photos-apply">
          <div className="photos-progress">
            <strong>{fmt(counts.done)}</strong> / {fmt(counts.all)}곳 확인
            {savedCount > 0 && <span className="pick-changed"> · 이번에 {savedCount}번 저장, 아직 서비스 데이터에는 반영 전</span>}
          </div>
          <button className="btn btn-primary btn-sm" onClick={onApply} disabled={running || savedCount === 0} title="export_web_data를 돌려 onsen.json에 반영해요">
            화면 데이터에 반영
          </button>
        </div>
      </div>

      {msg && <div className="toast toast-success" role="status"><span className="toast-dot" aria-hidden />{msg}</div>}

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
            {f.label} <span className="chip-n">{fmt(counts[f.id])}</span>
          </button>
        ))}
      </div>

      {list.length === 0 ? (
        <div className="card empty">
          <p>{filter === 'todo' ? '고를 곳이 없어요. 모두 골랐거나 후보가 없어요.' : '조건에 맞는 곳이 없어요.'}</p>
          <button className="btn btn-outline btn-sm" onClick={() => { setFilter('all'); setGu(''); setQ('') }}>필터 초기화</button>
        </div>
      ) : (
        <div className="pick-list">
          {list.slice(0, shown).map((p) => (
            <PickCard key={p.id} place={p} cand={cand.get(p.id)} chosen={chosen.get(p.id)} act={raw?.activity?.[p.id]} busy={busy || running} onSave={(url, kind) => save(p, url, kind)} />
          ))}
        </div>
      )}
      {list.length > shown && (
        <button className="btn btn-outline more" onClick={() => setShown((s) => s + PAGE)}>
          {fmt(Math.min(PAGE, list.length - shown))}곳 더 보기 ({fmt(shown)}/{fmt(list.length)})
        </button>
      )}
    </div>
  )
}
