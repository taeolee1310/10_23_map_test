export type Price = {
  adult: number | null
  weekend: number | null
  towel: number | null
  parking: number | null
  child: number | null
  none: boolean
  memo: string
  source: string
  checked: string
}

export type Parking = { name: string; dist: number; addr: string; kind: string; url: string }

export type Place = {
  id: string
  name: string
  addr: string
  sido: string
  lat: number | null
  lng: number | null
  tel: string
  kind: string
  url: string
  checked_at: string
  source: string
  price: Price | null
  parking: Parking[] | null // null=조회 안 됨, []=반경 안에 없음
  parking_radius: number | null
}

export type PlaceWithDist = Place & { dist: number | null }
export type LatLng = { lat: number; lng: number }

export type Filters = {
  q: string
  sido: string
  kind: string
  priceOnly: boolean
  favOnly: boolean
}

export const DEFAULT_FILTERS: Filters = { q: '', sido: '전체', kind: '', priceOnly: false, favOnly: false }

export const KINDS: [string, string][] = [
  ['', '전체'],
  ['온천', '온천'],
  ['온천 목욕탕·사우나', '목욕탕·사우나'],
  ['온천 숙박', '숙박'],
]
export const KIND_CLASS: Record<string, string> = { 온천: 'k0', '온천 숙박': 'k1', '온천 목욕탕·사우나': 'k2' }

export const hasXY = (p: Place): p is Place & { lat: number; lng: number } => p.lat != null && p.lng != null

// 두 좌표 사이 직선거리(km)
export function km(a: number, b: number, c: number, d: number) {
  const r = (x: number) => (x * Math.PI) / 180
  const dl = r(c - a)
  const dn = r(d - b)
  const h = Math.sin(dl / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(dn / 2) ** 2
  return 12742 * Math.asin(Math.sqrt(h))
}

export const fmtDist = (d: number) => (d < 1 ? Math.round(d * 1000) + 'm' : d.toFixed(d < 10 ? 1 : 0) + 'km')
export const won = (n: number) => Number(n).toLocaleString('ko-KR') + '원'

// API로 받은 주소·전화는 형식을 확인한 것만 링크로 쓴다 (javascript: 같은 주소 차단)
export const safeUrl = (u: string) => (/^https?:\/\/(place\.)?map\.kakao\.com\//.test(u || '') ? u : '')
export const safeTel = (t: string) => (/^[0-9+\-() ]{5,20}$/.test(t || '') ? t : '')

export function priceLabel(p: Place) {
  if (p.price && p.price.adult != null) return '성인 ' + won(p.price.adult)
  return p.price ? '가격 일부만 확인' : '가격 정보 없음'
}

export function mapLinks(p: Place, me: LatLng | null) {
  if (p.lat == null || p.lng == null) {
    const q = 'https://map.kakao.com/link/search/' + encodeURIComponent(p.name)
    return { car: q, pt: q }
  }
  const to = encodeURIComponent(p.name) + ',' + p.lat + ',' + p.lng
  if (!me) return { car: 'https://map.kakao.com/link/to/' + to, pt: 'https://map.kakao.com/link/to/' + to }
  const from = encodeURIComponent('내 위치') + ',' + me.lat + ',' + me.lng
  return {
    car: 'https://map.kakao.com/link/by/car/' + from + '/' + to,
    pt: 'https://map.kakao.com/link/by/publictransit/' + from + '/' + to,
  }
}

export function filterPlaces<T extends Place>(places: T[], f: Filters, favs: Set<string>): T[] {
  const q = f.q.trim().toLowerCase()
  return places.filter(
    (d) =>
      (f.sido === '전체' || d.sido === f.sido) &&
      (!f.kind || d.kind === f.kind) &&
      (!f.priceOnly || d.price) &&
      (!f.favOnly || favs.has(d.id)) &&
      (!q || (d.name + ' ' + d.addr).toLowerCase().includes(q)),
  )
}

export function sortPlaces(list: PlaceWithDist[], sort: string, hasMe: boolean) {
  const a = list.slice()
  const by = sort === 'auto' ? (hasMe ? 'dist' : 'name') : sort
  if (by === 'dist' && hasMe) {
    // 좌표 없는 곳은 거리를 모르니 맨 뒤로
    a.sort((x, y) => (x.dist ?? Infinity) - (y.dist ?? Infinity))
  } else {
    a.sort((x, y) => x.sido.localeCompare(y.sido, 'ko') || x.name.localeCompare(y.name, 'ko'))
  }
  return a
}
