import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import KakaoMap, { type FitRequest, type MapBounds } from '../../components/KakaoMap'
import OnsenLogo from '../../components/OnsenLogo'
import {
  DEFAULT_FILTERS,
  KINDS,
  REPORT_URL,
  filterPlaces,
  hasXY,
  km,
  sortPlaces,
  sortRegions,
  type Filters,
  type LatLng,
  type Place,
  type PlaceWithDist,
} from '../../lib/onsen'
import { IconHeart, IconDrop, IconLeaf, IconLocate, IconPin, IconSearch } from './Icons'
import PlaceDetail from './PlaceDetail'
import PlaceList from './PlaceList'
import PlacePreview from './PlacePreview'
import './MainScreen.css'

const DATA_URL = '/data/onsen.json' // export_web_data.py가 만든다
const PAGE = 60
const FAV_KEY = 'onsen_fav'

type Loaded = { baseDate: string; places: Place[] }

export default function MainScreen() {
  const [data, setData] = useState<Loaded | null>(null)
  const [loadError, setLoadError] = useState(false)

  useEffect(() => {
    fetch(DATA_URL)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('data'))))
      .then((j: Loaded) => setData(j))
      .catch(() => setLoadError(true))
  }, [])

  if (loadError) {
    return (
      <div className="onsen-main" id="shell">
        <p className="note">⛔ 온천 목록을 불러오지 못했어요. 터미널에서 python export_web_data.py를 먼저 실행해 주세요</p>
      </div>
    )
  }
  if (!data) {
    return (
      <div className="onsen-main" id="shell">
        <div className="sk" />
      </div>
    )
  }
  if (!data.places.length) {
    return (
      <div className="onsen-main" id="shell">
        <p className="note">온천 목록이 비어 있어요. python onsen_merge.py와 python export_web_data.py를 다시 실행해 주세요</p>
      </div>
    )
  }
  return <MainBody data={data} />
}

function MainBody({ data }: { data: Loaded }) {
  const { places } = data
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS)
  const [sort, setSort] = useState('auto')
  const [inView, setInView] = useState(false)
  const [bounds, setBounds] = useState<MapBounds | null>(null)
  const [me, setMe] = useState<LatLng | null>(null)
  const [note, setNote] = useState('')
  const [toast, setToast] = useState('')
  const [toastOn, setToastOn] = useState(false) // 글자는 남겨 두고 보이고 안 보이는 것만 바꿔, 사라질 때도 부드럽게
  const [selId, setSelId] = useState<string | null>(null)
  const [hotId, setHotId] = useState<string | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [shown, setShown] = useState(PAGE)
  const [animKey, setAnimKey] = useState(0)
  const [mapStatus, setMapStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [fit, setFit] = useState<FitRequest>(() => ({
    n: 1, // 지도가 준비되면 전체가 보이게 한 번 맞춘다
    pts: places.filter(hasXY).map((d) => ({ lat: d.lat, lng: d.lng })),
  }))
  const [query, setQuery] = useState('')
  const [logoRun, setLogoRun] = useState(0) // 로고에 마우스를 올릴 때마다 모션을 한 번 다시 재생
  const fromMap = useRef(false)
  const queryTimer = useRef<number | undefined>(undefined)
  const toastTimer = useRef<number | undefined>(undefined)

  // 담아두기: 브라우저에만 저장. 막힌 환경이면 이번 방문 동안만
  const [favs, setFavs] = useState<Set<string>>(() => {
    try {
      return new Set<string>(JSON.parse(localStorage.getItem(FAV_KEY) || '[]'))
    } catch {
      return new Set<string>()
    }
  })
  const toggleFav = useCallback((id: string) => {
    setFavs((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      try {
        localStorage.setItem(FAV_KEY, JSON.stringify([...next]))
      } catch {
        /* 저장소가 막힌 환경 */
      }
      return next
    })
  }, [])

  // 계산 (화면의 숫자와 지도·목록은 모두 아래 같은 표에서 나온다)
  const withDist: PlaceWithDist[] = useMemo(
    () => places.map((p) => ({ ...p, dist: me && hasXY(p) ? km(me.lat, me.lng, p.lat, p.lng) : null })),
    [places, me],
  )
  const filtered = useMemo(() => filterPlaces(withDist, filters, favs), [withDist, filters, favs])
  // '지도 범위로 보기'가 꺼져 있으면 지도가 움직여도 같은 배열이라 핀을 다시 그리지 않는다
  const inside = useMemo(
    () =>
      inView && bounds
        ? filtered.filter((d) => hasXY(d) && d.lat >= bounds.sw.lat && d.lat <= bounds.ne.lat && d.lng >= bounds.sw.lng && d.lng <= bounds.ne.lng)
        : filtered,
    [filtered, inView, bounds],
  )
  const view = useMemo(() => sortPlaces(inside, sort, !!me), [inside, sort, me])
  const mapPoints = useMemo(() => inside.filter(hasXY), [inside])

  const regionCounts = useMemo(() => {
    const c: Record<string, number> = {}
    places.forEach((d) => (c[d.sido] = (c[d.sido] || 0) + 1))
    return c
  }, [places])
  const regions = useMemo(() => sortRegions(Object.keys(regionCounts)), [regionCounts])
  const pricedCount = useMemo(() => places.filter((d) => d.price).length, [places])
  const estimateCount = useMemo(() => places.filter((d) => d.price_estimate).length, [places])
  const selected = useMemo(() => withDist.find((d) => d.id === selId) ?? null, [withDist, selId])

  const requestFit = useCallback((list: Place[], extra: LatLng[] = []) => {
    const pts = [...list.filter(hasXY).map((d) => ({ lat: d.lat, lng: d.lng })), ...extra]
    setFit((f) => ({ n: f.n + 1, pts }))
  }, [])

  // 필터를 바꾸면 목록을 처음부터 보여 주고, 지도는 걸러진 곳이 다 보이게 맞춘다
  const filtersRef = useRef(filters)
  const favsRef = useRef(favs)
  filtersRef.current = filters
  favsRef.current = favs
  const updateFilters = useCallback(
    (patch: Partial<Filters>) => {
      const next = { ...filtersRef.current, ...patch }
      filtersRef.current = next
      setFilters(next)
      setShown(PAGE)
      setAnimKey((k) => k + 1)
      requestFit(filterPlaces(places, next, favsRef.current))
    },
    [places, requestFit],
  )

  const onQuery = (v: string) => {
    setQuery(v)
    window.clearTimeout(queryTimer.current)
    queryTimer.current = window.setTimeout(() => updateFilters({ q: v }), 250)
  }

  const select = useCallback((id: string, from: 'map' | 'list') => {
    fromMap.current = from === 'map'
    setSelId(id)
  }, [])
  useEffect(() => {
    if (!selId || !fromMap.current) return
    fromMap.current = false
    document.querySelector('.onsen-main .item.on')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [selId])

  // 위치: 거리 계산에만 쓰고 저장하거나 보내지 않는다
  const showToast = (msg: string) => {
    setToast(msg)
    setToastOn(true)
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToastOn(false), 3500)
  }
  const locate = useCallback((after?: (p: LatLng) => void) => {
    if (!navigator.geolocation) {
      setNote('이 브라우저에서는 위치를 쓸 수 없어요. 지역을 고르거나 검색으로 온천을 찾아 보세요.')
      return
    }
    setNote('가까운 온천까지 직선거리를 보여 드리려고 지금 위치를 한 번만 사용해요. 저장하거나 서버로 보내지 않아요.')
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude }
        if (p.lat < 33 || p.lat > 39 || p.lng < 124 || p.lng > 132) {
          setNote('한국 밖에 계신 것 같아요. 지역을 고르거나 검색으로 온천을 찾아 보세요.')
          setMe(null)
          return
        }
        setNote('')
        setMe(p)
        after?.(p)
      },
      (err) =>
        setNote(
          err.code === 1
            ? '위치 권한이 꺼져 있어요. 괜찮아요, 지역을 고르거나 검색으로 온천을 찾을 수 있어요.'
            : '지금은 위치를 가져오지 못했어요. 지역을 고르거나 검색으로 찾아 보세요.',
        ),
      { timeout: 10000, maximumAge: 60000 },
    )
  }, [])

  const goNear = () =>
    locate((p) => {
      setSort('dist')
      setInView(false)
      const near = places
        .filter(hasXY)
        .map((d) => ({ d, k: km(p.lat, p.lng, d.lat, d.lng) }))
        .sort((a, b) => a.k - b.k)
        .slice(0, 8)
        .map((x) => x.d)
      updateFilters({ sido: '전체', favOnly: false })
      requestFit(near, [p]) // 위 updateFilters의 맞춤보다 나중에 불러서 이쪽이 이긴다
    })

  const reset = () => {
    setQuery('')
    updateFilters(DEFAULT_FILTERS)
  }

  // 눌렀을 때 퍼지는 물결
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('.onsen-main .open, .onsen-main .qp, .onsen-main .seg button, .onsen-main .btn')
      if (!t || (t as HTMLButtonElement).disabled) return
      const r = t.getBoundingClientRect()
      const s = Math.max(r.width, r.height) * 2
      const span = document.createElement('span')
      span.className = 'rip'
      span.style.cssText = `width:${s}px;height:${s}px;left:${e.clientX - r.left - s / 2}px;top:${e.clientY - r.top - s / 2}px`
      t.appendChild(span)
      window.setTimeout(() => span.remove(), 700)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [])

  const closeDetail = useCallback(() => setDetailOpen(false), [])
  // 요금 제보: 제보 받을 주소(REPORT_URL)가 정해지면 그곳으로, 아직이면 안내만 한다
  const reportPrice = (id: string) => {
    const p = places.find((d) => d.id === id)
    if (!REPORT_URL) {
      showToast('요금 제보 창구를 준비 중이에요')
      return
    }
    window.open(`${REPORT_URL}${REPORT_URL.includes('?') ? '&' : '?'}place=${encodeURIComponent(p?.name ?? id)}`, '_blank', 'noopener')
  }
  const count = inView && bounds ? `지도 안 ${view.length}곳` : `${view.length}곳`

  return (
    <div className="onsen-main" id="shell">
      <header className="hero">
        <div className="hero-copy">
          <div className="brand">
            <span className="brand-badge" onMouseEnter={() => setLogoRun((n) => n + 1)} onClick={() => setLogoRun((n) => n + 1)}>
              <OnsenLogo height="clamp(52px, 5.6vw, 72px)" title="탕방" playKey={logoRun} />
            </span>
            <div>
              <p className="eyebrow"><b>탕방</b> · 한국의 온천을 찾아서</p>
              <h1>오늘, 어디서 몸을 담글까요?</h1>
              <p className="sub">아직 몰랐던 전국의 온천을 발견하는 즐거움.</p>
            </div>
          </div>
          <div>
          <label className="search">
            <IconSearch />
            <span className="sr">온천 검색</span>
            <input type="search" placeholder="온천 이름이나 지역으로 찾기" autoComplete="off" value={query} onChange={(e) => onQuery(e.target.value)} />
          </label>
          <div className="quick">
            <button className="qp" onClick={goNear}><IconPin />내 주변 온천</button>
            <button className="qp" disabled={!pricedCount} title={pricedCount ? '' : '직접 확인한 곳이 생기면 열려요'} onClick={() => updateFilters({ priceOnly: true })}>
              <IconDrop />직접 확인한 곳{pricedCount ? <b>{pricedCount}</b> : null}
            </button>
            <button
              className="qp"
              onClick={() => updateFilters({ sido: [...regions].sort((a, z) => regionCounts[a] - regionCounts[z])[0] })}
            >
              <IconLeaf />아직 몰랐던 지역
            </button>
            <button
              className="qp"
              disabled={!favs.size}
              style={filters.favOnly ? { background: '#F6E8DF' } : undefined}
              onClick={() => updateFilters({ favOnly: !filters.favOnly })}
            >
              <IconHeart />담아둔 곳{favs.size ? <b>{favs.size}</b> : null}
            </button>
          </div>
          </div>
        </div>
      </header>

      <div id="app">
        <section id="panel" aria-label="온천 목록">
          <div className="filters">
            <label className="sel">
              <span className="sr">지역</span>
              <select value={filters.sido} onChange={(e) => updateFilters({ sido: e.target.value })}>
                <option value="전체">전국 {places.length}곳</option>
                {regions.map((r) => (
                  <option key={r} value={r}>{r} {regionCounts[r]}곳</option>
                ))}
              </select>
            </label>
            <div className="seg" role="group" aria-label="시설 유형">
              {KINDS.map(([v, l]) => (
                <button key={v} aria-pressed={filters.kind === v} onClick={() => updateFilters({ kind: v })}>{l}</button>
              ))}
            </div>
            <label className="sw">
              <input type="checkbox" checked={filters.priceOnly} onChange={(e) => updateFilters({ priceOnly: e.target.checked })} />
              <i />
              <span>직접 확인한 곳만</span>
            </label>
          </div>
          {note && <div className="note">{note}</div>}
          <div className="listhead">
            <span><b aria-live="polite">{count}</b></span>
            <select
              aria-label="정렬"
              value={sort}
              onChange={(e) => {
                setSort(e.target.value)
                if (e.target.value === 'dist' && !me) locate()
              }}
            >
              <option value="auto">추천순</option>
              <option value="dist">가까운 순</option>
              <option value="name">이름순</option>
            </select>
          </div>
          <PlaceList
            list={view}
            total={filtered.length}
            shown={shown}
            selId={selId}
            hotId={hotId}
            favs={favs}
            animKey={animKey}
            onSelect={(id) => select(id, 'list')}
            onFav={toggleFav}
            onHover={setHotId}
            onMore={() => setShown((s) => s + PAGE)}
            onReset={reset}
            onReport={reportPrice}
          />
          <PlaceDetail place={selected} open={detailOpen} me={me} onClose={closeDetail} onLocate={() => locate()} onReport={reportPrice} />
        </section>

        <aside id="side">
          <div className="mapcard">
            <KakaoMap
              points={mapPoints}
              selId={selId}
              hotId={hotId}
              me={me}
              fit={fit}
              onSelect={(id) => select(id, 'map')}
              onHover={setHotId}
              onPickSido={(s) => updateFilters({ sido: s })}
              onBounds={setBounds}
              onStatus={setMapStatus}
            />
            {mapStatus !== 'ready' && (
              <div className={`mapsk${mapStatus === 'error' ? ' err' : ''}`}>
                {mapStatus === 'error' ? (
                  <span>지도를 불러오지 못했어요.<br />카카오 콘솔에 <b>{window.location.origin}</b> 주소가<br />등록돼 있는지 확인해 보세요.</span>
                ) : (
                  '지도를 불러오는 중이에요'
                )}
              </div>
            )}
            <div className="maptools">
              <button className="tg" aria-pressed={inView} onClick={() => setInView((v) => !v)}>지도 범위로 보기</button>
              <button
                className="fab"
                aria-label="내 위치로 이동"
                onClick={() => locate(() => showToast('내 위치로 거리를 계산했어요'))}
              >
                <IconLocate />
              </button>
            </div>
            <div id="toast" role="status" className={toastOn ? 'show' : ''}>{toast}</div>
          </div>
          <PlacePreview
            place={selected}
            total={places.length}
            pricedCount={pricedCount}
            estimateCount={estimateCount}
            me={me}
            fav={!!selected && favs.has(selected.id)}
            swapKey={selected?.id ?? ''}
            onFav={toggleFav}
            onDetail={() => setDetailOpen(true)}
            onReport={reportPrice}
          />
        </aside>
      </div>
      <p className="graytip" style={{ margin: '0 8px 4px' }}>
        출처: 행정안전부 전국 온천이용업소 현황, 서울시 목욕장업 인허가 정보, 카카오 로컬 API(장소·주차장 검색), 요금: 행안부 착한가격업소·한국소비자원 참가격(서울 평균 추정), 지도: 카카오맵. 데이터 기준일 {data.baseDate}.
        위치는 이 브라우저에서 거리 계산에만 쓰고 저장하거나 보내지 않아요. 지도 위치를 못 찾은 곳은 목록에만 나와요.
      </p>
    </div>
  )
}
