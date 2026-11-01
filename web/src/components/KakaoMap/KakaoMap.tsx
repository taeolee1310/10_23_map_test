import { useEffect, useRef, useState } from 'react'
import { hasXY, type LatLng, type Place } from '../../lib/onsen'

// 지도는 카카오 JavaScript SDK(JS 키만 사용). 장소 검색은 파이썬이 하므로 services 라이브러리는 쓰지 않는다.
const API = { sdk: 'https://dapi.kakao.com/v2/maps/sdk.js' } // 🔌 지도 SDK 주소는 여기 한 곳에만
const BUBBLE_OVER = 120 // 이보다 많으면, 멀리서 볼 때 구별 묶음 풍선으로 보여 준다
const BUBBLE_LEVEL = 7 // 지도 단계가 이 이상(멀리)일 때만 풍선, 가까이 가면 핀
const MAX_PINS = 200 // 핀은 최대 200개
// 핀은 Figma 'Outline Pin'(304:2) 에셋 3장(몸통 + 윤곽 + 욕조)을 겹쳐 쓴다(MainScreen.css의 .pin__body, .pin__outline, .pin__tub). 색은 컬러 시스템의 핀 토큰.

export type MapBounds = { sw: LatLng; ne: LatLng }
export type FitRequest = { n: number; pts: LatLng[] }

type Props = {
  points: Place[] // 지도에 찍을 곳 (좌표 없는 곳은 알아서 뺀다)
  selId: string | null
  hotId: string | null
  me: LatLng | null
  fit: FitRequest
  onSelect: (id: string) => void
  onHover: (id: string | null) => void
  onBounds: (b: MapBounds) => void
  onStatus: (s: 'ready' | 'error') => void
}

let sdkPromise: Promise<void> | null = null

function loadSdk(key: string) {
  if (sdkPromise) return sdkPromise
  sdkPromise = new Promise<void>((resolve, reject) => {
    const sc = document.createElement('script')
    sc.src = `${API.sdk}?appkey=${encodeURIComponent(key)}&autoload=false`
    sc.onload = () => {
      try {
        window.kakao.maps.load(() => resolve())
      } catch {
        reject(new Error('sdk'))
      }
    }
    sc.onerror = () => reject(new Error('sdk'))
    document.head.appendChild(sc)
  })
  sdkPromise.catch(() => {
    sdkPromise = null // 다시 시도할 수 있게 비운다
  })
  return sdkPromise
}

export default function KakaoMap(props: Props) {
  const { points, selId, hotId, me, fit } = props
  const boxRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<any>(null)
  const overlaysRef = useRef<any[]>([])
  const pinElsRef = useRef<Record<string, HTMLElement>>({})
  const meRef = useRef<any>(null)
  const cb = useRef(props) // 이벤트에서 늘 최신 콜백을 부르도록
  cb.current = props
  const readyRef = useRef(false)
  const [view, setView] = useState<{ level: number; sw: LatLng; ne: LatLng } | null>(null)
  const [mapReady, setMapReady] = useState(false) // 지도 객체는 ref라서, 만들어진 뒤 아래 효과들이 다시 돌게 한다

  // 지도 만들기 (한 번)
  useEffect(() => {
    const key = import.meta.env.KAKAO_JS_KEY as string | undefined
    if (!key) {
      cb.current.onStatus('error')
      return
    }
    let dead = false
    const timer = window.setTimeout(() => {
      if (!readyRef.current) cb.current.onStatus('error')
    }, 12000)
    loadSdk(key)
      .then(() => {
        if (dead || !boxRef.current) return
        const kakao = window.kakao
        const map = new kakao.maps.Map(boxRef.current, { center: new kakao.maps.LatLng(37.5665, 126.978), level: 8 })
        mapRef.current = map
        readyRef.current = true
        kakao.maps.event.addListener(map, 'idle', () => {
          const b = map.getBounds()
          const sw = b.getSouthWest()
          const ne = b.getNorthEast()
          const box = { sw: { lat: sw.getLat(), lng: sw.getLng() }, ne: { lat: ne.getLat(), lng: ne.getLng() } }
          cb.current.onBounds(box)
          setView({ level: map.getLevel(), ...box })
        })
        kakao.maps.event.addListener(map, 'tilesloaded', () => cb.current.onStatus('ready'))
        map.relayout()
        setMapReady(true)
      })
      .catch(() => cb.current.onStatus('error'))
    const onResize = () => mapRef.current?.relayout()
    window.addEventListener('resize', onResize)
    return () => {
      dead = true
      window.clearTimeout(timer)
      window.removeEventListener('resize', onResize)
    }
  }, [])

  // 핀 그리기. 많으면 구별 묶음 풍선으로 보여 준다
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const kakao = window.kakao
    overlaysRef.current.forEach((o) => o.setMap(null))
    overlaysRef.current = []
    pinElsRef.current = {}
    const all = points.filter(hasXY)
    const zoomedOut = !view || view.level >= BUBBLE_LEVEL
    if (zoomedOut && all.length > BUBBLE_OVER) {
      const list = all
      const g: Record<string, typeof list> = {}
      list.forEach((d) => (g[d.gu] = g[d.gu] || []).push(d))
      Object.keys(g).forEach((s) => {
        const items = g[s]
        const lat = items.reduce((a, d) => a + d.lat, 0) / items.length
        const lng = items.reduce((a, d) => a + d.lng, 0) / items.length
        const el = document.createElement('button')
        el.className = 'bubble'
        el.dataset.size = items.length < 10 ? 's' : items.length < 30 ? 'm' : 'l' // 개수가 많을수록 조금 크게
        el.setAttribute('aria-label', `${s} ${items.length}곳, 눌러서 확대`)
        const num = document.createElement('span')
        num.className = 'bubble__n'
        num.textContent = String(items.length)
        const small = document.createElement('small')
        small.textContent = s // 이름은 textContent로
        el.append(num, small)
        el.addEventListener('click', () => map.setLevel(BUBBLE_LEVEL - 2, { anchor: new kakao.maps.LatLng(lat, lng) })) // 눌러서 확대
        overlaysRef.current.push(
          new kakao.maps.CustomOverlay({ map, position: new kakao.maps.LatLng(lat, lng), content: el, yAnchor: 0.5, zIndex: 2 }),
        )
      })
      return
    }
    // 가까이 보고 있으면 화면 안(여유 20%)의 핀만 그린다. 고른 곳은 항상 그린다
    const padLat = view ? (view.ne.lat - view.sw.lat) * 0.2 : 0
    const padLng = view ? (view.ne.lng - view.sw.lng) * 0.2 : 0
    const near = view
      ? all.filter(
          (d) =>
            d.id === selId ||
            (d.lat >= view.sw.lat - padLat && d.lat <= view.ne.lat + padLat && d.lng >= view.sw.lng - padLng && d.lng <= view.ne.lng + padLng),
        )
      : all
    const list = near.length > MAX_PINS ? near.slice(0, MAX_PINS) : near
    list.forEach((d) => {
      const sel = selId === d.id
      const el = document.createElement('button')
      el.className = 'pin' + (sel ? ' sel' : '')
      el.setAttribute('aria-label', d.name)
      el.innerHTML = '<span class="pin__body"></span><span class="pin__outline"></span><span class="pin__tub"></span>' + (sel ? '<i class="spl"><b></b><b></b><b></b></i>' : '')
      el.addEventListener('click', () => cb.current.onSelect(d.id))
      el.addEventListener('mouseenter', () => cb.current.onHover(d.id))
      el.addEventListener('mouseleave', () => cb.current.onHover(null))
      pinElsRef.current[d.id] = el
      overlaysRef.current.push(
        new kakao.maps.CustomOverlay({
          map,
          position: new kakao.maps.LatLng(d.lat, d.lng),
          content: el,
          yAnchor: 1,
          zIndex: sel ? 10 : 3,
        }),
      )
    })
  }, [points, selId, mapReady, view])

  // 목록에서 마우스를 올린 곳의 핀 강조
  useEffect(() => {
    Object.entries(pinElsRef.current).forEach(([id, el]) => el.classList.toggle('hot', id === hotId))
  }, [hotId, points, selId, mapReady])

  // 보이는 범위 맞추기: 요청이 올 때만
  useEffect(() => {
    const map = mapRef.current
    if (!map || !fit.pts.length) return
    const kakao = window.kakao
    if (fit.pts.length === 1) {
      map.setLevel(4)
      map.setCenter(new kakao.maps.LatLng(fit.pts[0].lat, fit.pts[0].lng))
      return
    }
    const b = new kakao.maps.LatLngBounds()
    fit.pts.forEach((p) => b.extend(new kakao.maps.LatLng(p.lat, p.lng)))
    map.setBounds(b, 40, 40, 40, 40)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fit.n, mapReady])

  // 선택한 곳으로 이동
  useEffect(() => {
    const map = mapRef.current
    if (!map || !selId) return
    const d = points.find((p) => p.id === selId)
    if (!d || !hasXY(d)) return
    if (map.getLevel() > 6) map.setLevel(5)
    map.panTo(new window.kakao.maps.LatLng(d.lat, d.lng))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selId])

  // 내 위치 점
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (meRef.current) meRef.current.setMap(null)
    meRef.current = null
    if (!me) return
    const dot = document.createElement('div')
    dot.className = 'me'
    meRef.current = new window.kakao.maps.CustomOverlay({
      map,
      position: new window.kakao.maps.LatLng(me.lat, me.lng),
      content: dot,
      zIndex: 1,
    })
  }, [me, mapReady])

  // 핀치·드래그를 못 쓰는 사람도 확대·축소할 수 있게 누르는 버튼(위치 버튼과 같은 모양)
  const zoomBy = (d: number) => {
    const map = mapRef.current
    if (map) map.setLevel(map.getLevel() + d, { animate: true })
  }
  return (
    <>
      <div id="map" ref={boxRef} role="application" aria-label="목욕탕 지도" />
      <div className="zoomtools">
        <button type="button" className="fab" aria-label="지도 확대" onClick={() => zoomBy(-1)}>
          ＋
        </button>
        <button type="button" className="fab" aria-label="지도 축소" onClick={() => zoomBy(1)}>
          －
        </button>
      </div>
    </>
  )
}

// 상세 화면(모바일)의 지도. SDK는 위 loadSdk를 같이 쓴다.
// - 작은 지도(기본): 손가락 스크롤을 막지 않도록 끌기·확대를 끄고, '전체보기'(onExpand)로 크게 연다.
// - 전체 지도(interactive): 끌기·확대를 켜고, 아래 바텀시트에 가리는 높이(offsetY)만큼 핀을 위로 올려 보여 준다.
export function MiniMap({ lat, lng, name, active, interactive = false, offsetY = 0, onExpand }: { lat: number; lng: number; name: string; active: boolean; interactive?: boolean; offsetY?: number; onExpand?: () => void }) {
  const boxRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<any>(null)
  const pinRef = useRef<any>(null)
  const [err, setErr] = useState(false)

  const recenter = () => {
    const map = mapRef.current
    if (!map) return
    map.relayout()
    map.setCenter(new window.kakao.maps.LatLng(lat, lng))
    if (offsetY) map.panBy(0, offsetY)
  }

  useEffect(() => {
    const key = import.meta.env.KAKAO_JS_KEY as string | undefined
    if (!key) return setErr(true)
    let dead = false
    loadSdk(key)
      .then(() => {
        if (dead || !boxRef.current) return
        const kakao = window.kakao
        const pos = new kakao.maps.LatLng(lat, lng)
        if (!mapRef.current) {
          mapRef.current = new kakao.maps.Map(boxRef.current, { center: pos, level: interactive ? 3 : 4, draggable: interactive, scrollwheel: interactive, disableDoubleClickZoom: !interactive })
        }
        pinRef.current?.setMap(null)
        const el = document.createElement('span')
        el.className = 'pin sel'
        el.setAttribute('aria-label', name) // 이름은 속성(글자)으로만 넣는다
        el.innerHTML = '<span class="pin__body"></span><span class="pin__outline"></span><span class="pin__tub"></span>'
        pinRef.current = new kakao.maps.CustomOverlay({ map: mapRef.current, position: pos, content: el, yAnchor: 1 })
        recenter()
      })
      .catch(() => !dead && setErr(true))
    return () => {
      dead = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lng, name, interactive])

  // 화면이 밀려 들어온 뒤 크기를 다시 재고 가운데로 맞춘다
  useEffect(() => {
    if (!active) return
    const t = window.setTimeout(recenter, 380)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, lat, lng, offsetY])

  return (
    <div className={`d-map${interactive ? ' d-map--full' : ''}`} role={interactive ? undefined : 'img'} aria-label={`${name} 위치 지도`}>
      <div ref={boxRef} className="d-map__canvas" />
      {err && <p className="d-map__err">지도를 불러오지 못했어요. 아래 길찾기로 위치를 확인해 주세요.</p>}
      {onExpand && !err && (
        <button type="button" className="d-map__more" onClick={onExpand}>
          전체보기
        </button>
      )}
    </div>
  )
}
