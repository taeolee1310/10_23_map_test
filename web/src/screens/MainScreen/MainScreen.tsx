import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import KakaoMap, { type FitRequest, type MapBounds } from '../../components/KakaoMap'
import OnsenLogo from '../../components/OnsenLogo'
import MilkLoader from '../../components/MilkLoader'
import PullRefresh from '../../components/MilkLoader/PullRefresh'
import {
  DEFAULT_FILTERS,
  filterPlaces,
  hasXY,
  km,
  NEAR_KM,
  guAt,
  type GuBoundary,
  sortPlaces,
  type Filters,
  type LatLng,
  type Place,
  type PlaceWithDist,
} from '../../lib/onsen'
import GlideSelect from '../../components/GlideSelect'
import PriceReport from '../../components/PriceReport'
import Onboarding, { type TourStep } from '../../components/Onboarding'
import { IconBanana, IconDrop, IconHelp, IconLocate, IconPin, IconSearch } from './Icons'
import PlaceDetail from './PlaceDetail'
import { worries, reportKnown } from './PlaceFacts'
import PlaceList from './PlaceList'
import PlacePreview from './PlacePreview'
import './MainScreen.css'
import { fetchPlaces } from '../../lib/api'
import { track } from '../../lib/track'
import { fetchStories, go, type Story } from '../../lib/stories'
import BottomNav from '../../components/BottomNav/BottomNav'

// 목록 데이터는 lib/api.ts가 받는다(데이터 API → 실패하면 정적 파일 /data/onsen.json)
// 손가락이 주 입력인 기기에서는 드롭다운 항목을 크게(누르기 쉬운 높이)
const TOUCH = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches

const SORTS = [
  { value: 'auto', label: '추천순' },
  { value: 'dist', label: '가까운 순' },
  { value: 'name', label: '이름순' },
]
const PAGE = 60
const TOUR_KEY = 'tangbang:onboarding:v3' // 안내를 한 번 봤는지(이 브라우저에만 저장). v2: 미리보기 칩·핀 두 번 누르기(2026-11-02), v3: 상세 TOP 3 단계 추가(2026-11-02)
const TOUR_KEY_MAG = 'tangbang:onboarding:v5' // v4: 매거진 단계 추가(2026-11-08), v5: 모바일은 매거진이 하단 네비게이션 바의 탭으로 옮겨 감(2026-11-10). 공개된 매거진 글이 있을 때만 이 키와 단계를 쓴다(글이 없으면 매거진 버튼도 안 보임)
const NARROW = '(max-width: 820px)' // MainScreen.css 모바일 기준과 같다
// 온보딩 4단계 문구
const TOUR_TEXT = [
  { title: '내 위치 먼저 확인', body: '내 주변 목욕탕 버튼을 누르면 가까운 곳부터 볼 수 있어요. 위치는 거리 계산에만 쓰고 저장하거나 보내지 않아요.' },
  { title: '목욕탕 고르기', body: '목록에서 목욕탕을 누르면 지도에 위치가 나와요. 바나나우유를 누르면 담아 둘 수 있어요.' },
  { title: '가기 전에 한눈에', body: "대인·소인 요금과 수건·드라이기·세신 정보를 카드에서 바로 볼 수 있어요." },
  { title: '자세히 보는 두 가지 방법', body: "카드의 '자세히 보기'를 누르거나, 지도에서 고른 핀을 한 번 더 누르면 자세한 정보로 넘어가요." },
  { title: '가기 전 걱정 TOP 3', body: '자세한 정보 맨 위에서 수건·드라이기·세신 정보를 먼저 확인하세요. 모르는 항목은 알려 주시면 확인한 뒤 반영해요.' },
]
// 매거진으로 가는 곳: 넓은 화면은 제목 옆 버튼, 모바일은 하단 네비게이션 바의 탭
const TOUR_TEXT_MAG = { title: '목욕 이야기 매거진', body: '탕 속 비밀, 목욕 꿀팁, 별난 목욕탕, 동네 수다를 모았어요.', wide: '위쪽 매거진 버튼으로 언제든 읽을 수 있어요.', narrow: '아래 매거진 탭으로 언제든 읽을 수 있어요.' }
const FAV_KEY = 'onsen_fav'
// 담아둔 곳 백업: 같은 목록을 서버 쿠키(web/api/favs.js)에도 적어 두고, 사파리가 localStorage를 지웠을 때 되살린다
const FAV_BACKUP = '/api/favs'
const saveFavBackup = (ids: string[]) => {
  fetch(FAV_BACKUP, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }), keepalive: true }).catch(() => {
    /* 백업 실패는 화면에 알리지 않는다(브라우저 저장은 이미 됨) */
  })
}

type Loaded = { baseDate: string; places: Place[] }

export default function MainScreen() {
  const [data, setData] = useState<Loaded | null>(null)
  const [loadError, setLoadError] = useState(false)

  const loadData = useCallback(() => {
    setLoadError(false)
    fetchPlaces<Loaded>()
      .then((j) => setData(j))
      .catch(() => setLoadError(true))
  }, [])
  useEffect(() => loadData(), [loadData])
  // 당겨서 새로고침: 화면(필터·선택)은 그대로 두고 목록만 다시 받는다. 실패하면 지금 목록을 그대로 둔다
  const refresh = useCallback(
    () =>
      fetchPlaces<Loaded>({ cache: 'no-cache' }).then((j) => setData(j)),
    [],
  )

  let body
  if (loadError) {
    body = (
      <div className="onsen-main" id="shell">
        <div className="loaderr" role="alert">
          <b>목욕탕 목록을 불러오지 못했어요</b>
          <p>인터넷 연결을 확인한 뒤 다시 불러와 주세요. 계속 안 되면 잠시 뒤에 다시 들어와 주세요.</p>
          <button className="btn" onClick={loadData}>다시 불러오기</button>
        </div>
      </div>
    )
  } else if (!data) {
    body = (
      <div className="onsen-main" id="shell">
        <div className="sk" />
      </div>
    )
  } else if (!data.places.length) {
    body = (
      <div className="onsen-main" id="shell">
        <p className="note">목욕탕 목록이 비어 있어요. 데이터 만들기(onsen_merge → export_web_data)를 다시 실행해 주세요</p>
      </div>
    )
  } else {
    body = <MainBody data={data} onRefresh={refresh} />
  }
  // 로더는 실제 데이터 요청이 진행 중일 때만 켜진다(성공·실패·시간 초과 모두 loading이 꺼지며 로더가 나간다)
  return (
    <>
      <MilkLoader loading={!data && !loadError} />
      {body}
    </>
  )
}

function MainBody({ data, onRefresh }: { data: Loaded; onRefresh: () => Promise<unknown> }) {
  const { places } = data
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS)
  const [sort, setSort] = useState('auto')
  const [inView, setInView] = useState(false)
  const [bounds, setBounds] = useState<MapBounds | null>(null)
  const [me, setMe] = useState<LatLng | null>(null)
  const [nearGu, setNearGu] = useState('') // '내 주변 목욕탕'을 눌렀을 때 안내하는, 내 위치가 속한 구
  const [note, setNote] = useState('')
  // 위치를 구하는 중인지. fill은 '내 주변 목욕탕' 버튼의 물 채움 단계: idle(없음) → run(차오르는 중) → done(가득 찬 뒤 사라짐)
  const [locating, setLocating] = useState(false)
  const [fill, setFill] = useState<'idle' | 'run' | 'done'>('idle')
  const fillTimer = useRef(0)
  const busy = useRef(false) // 구하는 중에 또 누른 것은 받지 않는다
  const [toast, setToast] = useState('')
  const [toastOn, setToastOn] = useState(false) // 글자는 남겨 두고 보이고 안 보이는 것만 바꿔, 사라질 때도 부드럽게
  const [selId, setSelId] = useState<string | null>(null)
  const [hotId, setHotId] = useState<string | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [tourOpen, setTourOpen] = useState(false)
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

  // 담아두기: 브라우저(localStorage)에 저장하고 서버 쿠키에 백업한다. 접속 주소(IP)와는 상관없다.
  // 브라우저 저장이 비어 있으면(처음 왔거나 사파리가 7일 뒤 지움) 백업에서 되살린다. 막힌 환경이면 이번 방문 동안만
  const [favs, setFavs] = useState<Set<string>>(() => {
    try {
      return new Set<string>(JSON.parse(localStorage.getItem(FAV_KEY) || '[]'))
    } catch {
      return new Set<string>()
    }
  })
  useEffect(() => {
    let stored: string | null = null
    try {
      stored = localStorage.getItem(FAV_KEY)
    } catch {
      return
    }
    if (stored !== null) return
    fetch(FAV_BACKUP)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { ids?: string[] } | null) => {
        const ids = (j?.ids ?? []).filter((id) => places.some((p) => p.id === id)) // 지금 목록에 있는 곳만
        try {
          localStorage.setItem(FAV_KEY, JSON.stringify(ids)) // 빈 목록도 적어 두어 다음에는 묻지 않는다
        } catch {
          /* 저장소가 막힌 환경 */
        }
        if (ids.length) setFavs((prev) => new Set([...prev, ...ids]))
      })
      .catch(() => {
        /* 백업을 못 읽으면 빈 상태로 둔다 */
      })
  }, [places])
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
      saveFavBackup([...next])
      return next
    })
    if (!favsRef.current.has(id)) track('fav') // 담은 것만 센다(뺀 것은 세지 않음). 상태 갱신 함수 밖에서 불러 두 번 세지 않는다
  }, [])

  // 계산 (화면의 숫자와 지도·목록은 모두 아래 같은 표에서 나온다)
  const withDist: PlaceWithDist[] = useMemo(
    () => places.map((p) => ({ ...p, dist: me && hasXY(p) ? km(me.lat, me.lng, p.lat, p.lng) : null })),
    [places, me],
  )
  const filtered = useMemo(() => filterPlaces(withDist, filters, favs), [withDist, filters, favs])
  // 지역 드롭다운 항목: 전체 목록에서 구별 곳 수를 센다(가나다순)
  // 구별 개수는 지역을 뺀 나머지 필터를 적용한 목록에서 센다(고르면 목록 숫자와 같아진다)
  const guPool = useMemo(() => filterPlaces(places, { ...filters, gu: [] }, favs), [places, filters, favs])
  const guList = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of guPool) if (p.gu) m.set(p.gu, (m.get(p.gu) ?? 0) + 1)
    for (const g of filters.gu) if (!m.has(g)) m.set(g, 0) // 고른 구가 0곳이어도 선택 표시는 남긴다
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], 'ko'))
  }, [guPool, filters.gu])
  const guOptions = useMemo(
    () => [{ value: '', label: '전체 지역', tag: String(guPool.length) }, ...guList.map(([g, n]) => ({ value: g, label: g, tag: String(n) }))],
    [guList, guPool.length],
  )
  // '지도 범위로 보기'가 꺼져 있으면 지도가 움직여도 같은 배열이라 핀을 다시 그리지 않는다
  // 내 위치를 알고 '이름순'이면 반경 NEAR_KM 안의 곳만 남긴다(지도·목록·숫자가 같은 목록을 쓰도록 여기서 거른다)
  const nearOnly = !!me && sort === 'name'
  const nearby = useMemo(
    () => (nearOnly ? filtered.filter((d) => d.dist != null && d.dist <= NEAR_KM) : filtered),
    [filtered, nearOnly],
  )
  const inside = useMemo(
    () =>
      inView && bounds
        ? nearby.filter((d) => hasXY(d) && d.lat >= bounds.sw.lat && d.lat <= bounds.ne.lat && d.lng >= bounds.sw.lng && d.lng <= bounds.ne.lng)
        : nearby,
    [nearby, inView, bounds],
  )
  const view = useMemo(() => sortPlaces(inside, sort, !!me), [inside, sort, me])
  const mapPoints = useMemo(() => inside.filter(hasXY), [inside])

  const pricedCount = useMemo(() => places.filter((d) => d.price).length, [places])
  const unconfirmedCount = useMemo(() => places.filter((d) => !d.price).length, [places])
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
      setNote('이 브라우저에서는 위치를 쓸 수 없어요. 검색으로 목욕탕을 찾아 보세요.')
      return
    }
    if (busy.current) return
    busy.current = true
    setLocating(true)
    window.clearTimeout(fillTimer.current)
    setFill('run')
    // 끝나면: 물이 가득 찬 뒤(성공) 또는 바로(실패) 원래 버튼으로 돌아간다
    const finish = (ok: boolean) => {
      busy.current = false
      setLocating(false)
      setFill(ok ? 'done' : 'idle')
      if (ok) fillTimer.current = window.setTimeout(() => setFill('idle'), 700)
    }
    setNote('가까운 목욕탕까지 직선거리를 보여 드리려고 지금 위치를 한 번만 사용해요. 저장하거나 서버로 보내지 않아요.')
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude }
        if (p.lat < 33 || p.lat > 39 || p.lng < 124 || p.lng > 132) {
          setNote('한국 밖에 계신 것 같아요. 검색으로 목욕탕을 찾아 보세요.')
          setMe(null)
          finish(false)
          return
        }
        finish(true)
        setNote('')
        setMe(p)
        after?.(p)
      },
      (err) => {
        finish(false)
        setNote(
          err.code === 1
            ? '위치 권한이 꺼져 있어요. 괜찮아요, 검색으로 목욕탕을 찾을 수 있어요.'
            : err.code === 2
              ? '이 기기에서 위치를 구하지 못했어요. 기기의 위치 서비스를 켜 보시거나, 지역을 고르거나 검색으로 찾아 보세요.'
              : '지금은 위치를 가져오지 못했어요. 지역을 고르거나 검색으로 찾아 보세요.',
        )
      },
      { timeout: 10000, maximumAge: 60000 },
    )
  }, [])

  // 내 위치가 어느 구인지: 구 경계(seoul-gu.json)에서 찾는다. 처음 한 번만 불러온다. 서울 밖이거나 못 불러오면 태그를 숨긴다.
  const guBoundary = useRef<Promise<GuBoundary | null> | null>(null)
  const findGu = async (p: LatLng) => {
    guBoundary.current ??= fetch('/data/seoul-gu.json').then((r) => (r.ok ? (r.json() as Promise<GuBoundary>) : null)).catch(() => null)
    const b = await guBoundary.current
    return b ? guAt(p.lat, p.lng, b) : ''
  }
  const goNear = () => {
    track('near') // 누른 것을 센다(위치를 못 구해도 누른 사람 수는 남는다)
    locate((p) => {
      setSort('dist')
      setInView(false)
      const near = places
        .filter(hasXY)
        .map((d) => ({ d, k: km(p.lat, p.lng, d.lat, d.lng) }))
        .sort((a, b) => a.k - b.k)
        .slice(0, 8)
        .map((x) => x.d)
      setNearGu('')
      findGu(p).then(setNearGu)
      updateFilters({ favOnly: false })
      requestFit(near, [p]) // 위 updateFilters의 맞춤보다 나중에 불러서 이쪽이 이긴다
      showToast('내 위치를 찾았어요. 가까운 곳부터 보여 드려요')
    })
  }

  const reset = () => {
    setNearGu('')
    setQuery('')
    updateFilters(DEFAULT_FILTERS)
  }

  // 로고 = 홈: 메인 화면을 처음 연 상태로 되돌린다(상세 닫기, 선택·필터·검색·정렬 초기화, 맨 위로). 담아 둔 목욕탕은 그대로 둔다
  const goHome = () => {
    setLogoRun((n) => n + 1)
    window.clearTimeout(queryTimer.current)
    closeDetail()
    setSelId(null)
    setHotId(null)
    setSort('auto')
    setInView(false)
    setNote('')
    reset()
    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    document.getElementById('shell')?.scrollTo({ top: 0, behavior: smooth ? 'smooth' : 'auto' })
    window.scrollTo({ top: 0, behavior: smooth ? 'smooth' : 'auto' })
  }

  // 눌렀을 때 퍼지는 물결
  // 상세를 열 때 브라우저 기록에 한 단계를 쌓는다: 모바일의 뒤로가기(iPhone 가장자리 스와이프, 안드로이드 뒤로 제스처)가 곧 '목록으로'가 된다.
  const detailPushed = useRef(false)
  const openDetail = useCallback(() => {
    setDetailOpen(true)
    if (!tourOpen) track('detail') // 안내(온보딩)가 열어 주는 것은 세지 않는다
    if (detailPushed.current) return
    try {
      history.pushState({ tbDetail: true }, '')
      detailPushed.current = true
    } catch {
      /* 기록을 쓸 수 없는 환경: 상세만 열고 뒤로가기는 쓰지 않는다 */
    }
  }, [tourOpen])
  const closeDetail = useCallback(() => {
    if (!detailPushed.current) {
      setDetailOpen(false)
      return
    }
    history.back() // 실제로 닫는 건 아래 popstate가 한다(쌓아 둔 기록 한 단계도 함께 사라진다)
  }, [])
  useEffect(() => {
    const onPop = () => {
      detailPushed.current = false
      setDetailOpen(false)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  // 매거진: 공개된 글이 있을 때만 상단 '매거진' 버튼·상세의 '이 목욕탕 이야기'·안내 단계를 보여 준다(못 받아도 지도는 그대로)
  const [stories, setStories] = useState<Story[]>([])
  const [storiesReady, setStoriesReady] = useState(false)
  useEffect(() => {
    fetchStories()
      .then(setStories, () => {})
      .finally(() => setStoriesReady(true))
  }, [])
  const hasMag = stories.length > 0
  const tourKey = hasMag ? TOUR_KEY_MAG : TOUR_KEY

  // 온보딩: 처음 들어왔을 때 한 번만 자동으로 열고, 제목 옆 '어떻게 사용하는 거예요?' 버튼으로 다시 볼 수 있다.
  // 매거진 글이 있는지 확인한 뒤에 정한다(글이 생기면 v4로 올라가 이미 본 사람도 한 번 더 본다). 저장소를 못 쓰는 브라우저에서는 매번 띄우지 않는다.
  useEffect(() => {
    if (!storiesReady) return
    try {
      if (localStorage.getItem(tourKey) === '1') return
    } catch {
      return
    }
    const t = window.setTimeout(() => setTourOpen(true), 900)
    return () => window.clearTimeout(t)
  }, [storiesReady, tourKey])
  const closeTour = useCallback(() => {
    setTourOpen(false)
    try {
      localStorage.setItem(tourKey, '1')
      localStorage.setItem(TOUR_KEY, '1')
    } catch {
      /* 저장하지 못해도 안내는 닫힌다 */
    }
  }, [tourKey])
  const openMagazine = () => go('/magazine')
  // 안내에서 비출 목욕탕: 미리보기 카드 칩(요금·TOP 3)이 가장 많이 나오는 곳. 지금 고른 곳에 TOP 3가 있으면 그대로 둔다.
  const chipScore = (p: (typeof view)[number]) => worries(p.facts).length + (p.price?.adult != null ? 1 : 0) + (p.price?.child != null ? 1 : 0)
  const pickForTour = () => {
    const cur = view.find((p) => p.id === selId)
    if (cur && worries(cur.facts).length) return
    // 목록 위쪽 카드 중에서 고른다(4단계에서 카드를 비춘다. 아래쪽을 고르면 화면이 수천 px 스크롤돼 안내가 길을 잃는다)
    const shownList = view.slice(0, Math.min(shown, 6))
    const pick = shownList.reduce<(typeof view)[number] | undefined>((best, p) => (!best || chipScore(p) > chipScore(best) ? p : best), undefined)
    if (pick) select(pick.id, 'list')
  }
  const tourSteps: TourStep[] = [
    {
      target: '.quick .qp',
      title: TOUR_TEXT[0].title,
      body: TOUR_TEXT[0].body,
      action: { label: '내 위치 확인하기', run: goNear },
      onEnter: () => closeDetail(),
    },
    {
      target: '#list .item',
      title: TOUR_TEXT[1].title,
      body: TOUR_TEXT[1].body,
      onEnter: () => closeDetail(), // '이전'으로 돌아올 때 상세가 열려 있으면 닫는다(3·4단계도 같다)
    },
    {
      target: '.preview',
      title: TOUR_TEXT[2].title,
      body: TOUR_TEXT[2].body,
      onEnter: () => {
        closeDetail()
        pickForTour()
      },
    },
    {
      target: '#list .item.on',
      pulse: '#list .item.on .item-detail',
      title: TOUR_TEXT[3].title,
      body: TOUR_TEXT[3].body,
      onEnter: () => {
        closeDetail()
        if (!selId) pickForTour()
      },
    },
    {
      // 마지막: 상세를 열어 맨 위 TOP 3를 비춘다. 안내를 마치면 상세는 열린 채로 둔다(바로 둘러볼 수 있게)
      target: '#detail.open .sec.worry',
      title: TOUR_TEXT[4].title,
      body: TOUR_TEXT[4].body,
      onEnter: () => {
        if (!selId) pickForTour()
        openDetail()
      },
    },
    ...(hasMag
      ? [
          {
            // 매거진 글이 있을 때만: 상단 '매거진' 버튼(모바일은 하단 바의 매거진 탭)을 비춘다
            target: window.matchMedia(NARROW).matches ? '.bnav [data-tab="magazine"]' : '.mag-entry--wide',
            title: TOUR_TEXT_MAG.title,
            body: `${TOUR_TEXT_MAG.body} ${window.matchMedia(NARROW).matches ? TOUR_TEXT_MAG.narrow : TOUR_TEXT_MAG.wide}`,
            onEnter: () => closeDetail(),
          },
        ]
      : []),
  ]
  // 요금 제보: 제보 창을 열고, 보낸 결과는 알림으로 알려 준다
  const [reportFor, setReportFor] = useState<{ id: string; name: string; known?: ReturnType<typeof reportKnown> } | null>(null)
  const reportPrice = (id: string) => {
    const p = places.find((d) => d.id === id)
    track('report_open')
    setReportFor({ id, name: p?.name ?? id, known: p ? reportKnown(p) : undefined }) // 이미 확인된 칸은 채워서, 모르는 칸만 빈칸으로 보여 준다
  }
  const guText = filters.gu.length > 1 ? `${filters.gu[0]} 외 ${filters.gu.length - 1}개 구` : filters.gu[0] ?? ''
  const count = (nearOnly ? `내 위치 ${NEAR_KM}km 안 ` : '') + (guText ? guText + ' ' : '') + (inView && bounds ? `지도 안 ${view.length}곳` : `${view.length}곳`)

  const openTour = () => {
    closeDetail()
    setTourOpen(true)
  }

  return (
    <div className={`onsen-main${hasMag ? ' onsen-main--bnav' : ''}`} id="shell">
      {TOUCH && <PullRefresh scrollerId="shell" onRefresh={onRefresh} />}
      <header className="hero">
        <div className="hero-copy">
          <div className="brand">
            {/* 로고 = 홈: 누르면 메인 화면 처음 상태로 돌아간다 */}
            <button type="button" className="brand-badge" aria-label="탕방 홈으로" onMouseEnter={() => setLogoRun((n) => n + 1)} onClick={goHome}>
              <OnsenLogo height="calc(var(--badge-logo) * 0.9)" title="탕방" playKey={logoRun} />
            </button>
            <div>
              <p className="eyebrow"><b>탕방</b> · 서울의 목욕탕을 찾아서</p>
              <div className="title-row">
                <h1>오늘, 어디서 몸을 담글까요?</h1>
                {/* 사용법(온보딩 다시 보기): 작은 '?' 아이콘은 리서치에서 사용법으로 읽히지 않아 글자 버튼으로 제목 옆에 둔다 */}
                <button type="button" className="help help--wide" data-tip="클릭하면 사용법을 알려드려요" onClick={openTour}>
                  어떻게 사용하는 거예요?<IconHelp />
                </button>
                {hasMag && (
                  <button type="button" className="help mag-entry mag-entry--wide" onClick={openMagazine}>
                    매거진
                  </button>
                )}
              </div>
              <p className="sub">아직 몰랐던 서울의 목욕탕을 발견하는 즐거움.</p>
            </div>
          </div>
          <div>
          {/* 모바일: 제목 옆 대신 검색창 위 왼쪽에 짧게 '사용법'으로 둔다 */}
          <button type="button" className="help help--narrow" onClick={openTour}>
            <IconHelp />사용법
          </button>
          <label className="search">
            <IconSearch />
            <span className="sr">목욕탕 검색</span>
            <input type="search" placeholder="이름이나 구로 찾기" autoComplete="off" value={query} onChange={(e) => onQuery(e.target.value)} />
          </label>
          <div className="quick">
            {/* 위치를 구하는 동안(길면 10초) 버튼에 물이 차오른다(인트로 '목욕탕 찾아보기' 버튼과 같은 물). 물은 장식이고 글자는 물 위 레이어 */}
            <button className="qp qp--near" data-fill={fill} aria-busy={locating} onClick={goNear}>
              <span className="qp-label"><IconPin />{locating ? '내 위치 찾는 중…' : '내 주변 목욕탕'}</span>
              <span className="qp-fill" aria-hidden="true">
                <svg className="qp-wave" viewBox="0 0 120 12" preserveAspectRatio="none" focusable="false">
                  <defs>
                    <linearGradient id="qp-liquid-grad" x1="0" x2="1">
                      <stop offset="0" className="qp-stop--a" />
                      <stop offset="1" className="qp-stop--b" />
                    </linearGradient>
                  </defs>
                  <path d="M0 6 Q 15 0 30 6 T 60 6 T 90 6 T 120 6 V12 H0 Z" fill="url(#qp-liquid-grad)" />
                </svg>
              </span>
            </button>
            <button className="qp" disabled={!pricedCount} title={pricedCount ? '' : '확인된 곳이 생기면 열려요'} onClick={() => updateFilters({ priceOnly: true })}>
              <IconDrop />확인된 곳{pricedCount ? <b>{pricedCount}</b> : null}
            </button>
            <button
              className="qp"
              disabled={!favs.size}
              style={filters.favOnly ? { background: 'var(--color-accent-soft)' } : undefined}
              onClick={() => updateFilters({ favOnly: !filters.favOnly })}
            >
              <IconBanana on={filters.favOnly} size={18} />담아둔 곳{favs.size ? <b>{favs.size}</b> : null}
            </button>
          </div>
          </div>
        </div>
      </header>

      <div id="app">
        <section id="panel" aria-label="목욕탕 목록">
          <div className="filters">
            {/* 지역(구) 드롭다운: 여러 구를 고를 수 있다. 고른 구는 선택 색으로 보이고, 목록 위 개수 앞에도 적힌다. 항목이 많아 메뉴 안에서 스크롤한다 */}
            <span className={`sel-gu${filters.gu.length ? ' on' : ''}`}>
              <GlideSelect
                ariaLabel="지역"
                options={guOptions}
                multiple
                allValue=""
                values={filters.gu}
                onValuesChange={(v) => updateFilters({ gu: v })}
                size={TOUCH ? 'lg' : 'md'}
                radius={14}
                menuWidth={184}
                maxMenuHeight={320}
                accentColor="var(--secondary)"
                surfaceColor="var(--card)"
                highlightColor="var(--soft)"
                textColor="var(--ink)"
              />
              {filters.gu.length > 0 && (
                <button type="button" className="sel-clear" aria-label={`${filters.gu.join(', ')} 선택 해제`} onClick={() => updateFilters({ gu: [] })}>
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M2 2l6 6M8 2L2 8" /></svg>
                </button>
              )}
            </span>
            <div className="swrow">
              <label className="sw">
                <input type="checkbox" checked={filters.priceOnly} onChange={(e) => updateFilters({ priceOnly: e.target.checked })} />
                <i />
                <span>확인된 곳</span>
              </label>
            </div>
          </div>
          {note && <div className="note">{note}</div>}
          <div className="listhead">
            <span className="lh-count">
              <b aria-live="polite">{count}</b>
              {nearGu && <em className="gu-tag" title="지금 위치가 속한 구예요">내 위치 · {nearGu}</em>}
            </span>
            {/* 색은 기존 정렬 드롭다운 그대로: 글자·체크는 링크색(--secondary), 바탕은 카드 흰색, 고르는 알약은 칩 바탕(--soft) */}
            <GlideSelect
              ariaLabel="정렬"
              options={SORTS}
              value={sort}
              onChange={(v) => {
                setSort(v)
                if (v === 'auto' || v === 'dist' || v === 'name') track(`sort_${v}`)
                if (v === 'dist' && !me) locate()
                if (v === 'name' && me) {
                  // 이름순은 내 위치 반경 안만 보여 주므로 목록을 처음부터, 지도는 그 곳들과 내 위치가 보이게 맞춘다
                  setShown(PAGE)
                  setAnimKey((k) => k + 1)
                  requestFit(filtered.filter((d) => d.dist != null && d.dist <= NEAR_KM), [me])
                }
              }}
              size="sm"
              radius={12}
              menuWidth={128}
              align="right"
              accentColor="var(--secondary)"
              surfaceColor="var(--card)"
              highlightColor="var(--soft)"
              textColor="var(--secondary)"
            />
          </div>
          {/* 추천 기준을 숨기지 않는다(계산은 lib/onsen.ts infoScore·recommendScore) */}
          {sort === 'auto' && (
            <p className="sort-hint">{me ? '추천순: 요금·수건·드라이기 같은 정보가 확인된 곳을 먼저, 가까울수록 위에' : '추천순: 요금·수건·드라이기 같은 정보가 확인된 곳을 먼저'}</p>
          )}
          <PlaceList
            list={view}
            total={nearby.length}
            shown={shown}
            selId={selId}
            hotId={hotId}
            favs={favs}
            animKey={animKey}
            onSelect={(id) => select(id, 'list')}
            onDetail={(id) => {
              select(id, 'list')
              openDetail()
            }}
            onFav={toggleFav}
            onHover={setHotId}
            onMore={() => setShown((s) => s + PAGE)}
            onReset={() => {
              if (nearOnly) setSort('auto') // 반경 안에 한 곳도 없을 때 초기화가 이름순 반경 제한도 푼다
              reset()
            }}
            onReport={reportPrice}
            emptyText={nearOnly && !nearby.length ? `내 위치 ${NEAR_KM}km 안에는 목욕탕이 없어요. 추천순이나 가까운 순으로 바꿔 보세요.` : undefined}
          />
          <PlaceDetail place={selected} open={detailOpen} me={me} onClose={closeDetail} onLocate={() => locate()} onReport={reportPrice} stories={selected ? stories.filter((s) => s.place_ids.includes(selected.id)) : []} />
        </section>

        <aside id="side">
          <div className="mapcard">
            <KakaoMap
              points={mapPoints}
              selId={selId}
              hotId={hotId}
              me={me}
              fit={fit}
              onSelect={(id) => (id === selId ? openDetail() : select(id, 'map'))} // 고른 핀을 한 번 더 누르면 상세로
              onHover={setHotId}
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
            {/* 위치를 구하는 동안은 지도 위 알림이 계속 떠 있다(버튼이 화면 밖에 있어도 알 수 있게) */}
            <div id="toast" role="status" className={locating || toastOn ? 'show' : ''}>{locating ? '내 위치를 찾고 있어요…' : toast}</div>
          </div>
          <PlacePreview
            place={selected}
            total={places.length}
            pricedCount={pricedCount}
            unconfirmedCount={unconfirmedCount}
            me={me}
            fav={!!selected && favs.has(selected.id)}
            swapKey={selected?.id ?? ''}
            onFav={toggleFav}
            onReport={reportPrice}
          />
        </aside>
      </div>
      <p className="graytip" style={{ margin: '0 8px 4px' }}>
        출처: 행정안전부 온천이용업소 현황, 서울시 목욕장업 인허가 정보, 카카오 로컬 API(장소·주차장 검색), 요금: 업체 가격표(네이버 플레이스)·행안부 착한가격업소, 지도: 카카오맵, 구 경계: 통계청 SGIS(공공누리 제1유형). 데이터 기준일 {data.baseDate}.
      </p>
      <PriceReport place={reportFor} onClose={() => setReportFor(null)} onMessage={showToast} />
      {/* 모바일 하단 네비게이션 바: 갈 곳이 둘 이상일 때만(공개된 매거진 글이 있을 때). 홈 탭을 다시 누르면 맨 위로 */}
      {hasMag && <BottomNav current="map" onCurrent={() => document.getElementById('shell')?.scrollTo({ top: 0, behavior: 'smooth' })} />}
      <Onboarding steps={tourSteps} open={tourOpen} onClose={closeTour} />
    </div>
  )
}
