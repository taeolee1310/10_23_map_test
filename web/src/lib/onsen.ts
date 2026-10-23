export type Price = {
  adult: number | null
  weekend: number | null
  towel: number | null
  parking: number | null
  child: number | null
  jjimjil: number | null // 찜질 이용 시 더 내는 요금
  none: boolean
  memo: string
  source: string
  checked: string
}

// 확인된 요금이 아니라, 근처 욕탕 요금을 바탕으로 낸 추정값
export type PriceEstimate = { adult: number; child: number | null; basis: string; checked: string }

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
  price_estimate: PriceEstimate | null
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
  ['온천 목욕탕·사우나', '목욕탕·사우나'], // 한국에서는 목욕탕·사우나가 가장 흔해서 전체 바로 다음에 둔다
  ['온천', '온천'],
  ['온천 숙박', '숙박'],
]
// 시·도 드롭다운 순서: 한국에서 흔히 쓰는 행정구역 순서(서울 → 광역시 → 경기 → 도 → 제주).
// 카카오가 새 행정구역명(전남광주통합특별시)으로 준 곳은 '광주·전남'으로 줄여 광주 바로 뒤에 둔다.
export const REGION_ORDER = ['서울', '부산', '대구', '인천', '광주', '광주·전남', '대전', '울산', '세종', '경기', '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주']
export const sortRegions = (list: string[]) => {
  const rank = (r: string) => {
    const i = REGION_ORDER.indexOf(r)
    return i < 0 ? REGION_ORDER.length : i // 목록에 없는 이름은 맨 뒤
  }
  return list.slice().sort((a, b) => rank(a) - rank(b) || a.localeCompare(b, 'ko'))
}

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
  if (p.price) return '가격 일부만 확인'
  if (p.price_estimate) return '성인 약 ' + won(p.price_estimate.adult)
  return '가격 정보 없음'
}

// 요금 상태: 실측확인(웹·영수증 등으로 검증된 실제 요금) / 실측불가(인근 시·군·구 평균 시세로 낸 추정) / 없음
export const priceState = (p: Place): 'confirmed' | 'estimate' | 'none' => (p.price ? 'confirmed' : p.price_estimate ? 'estimate' : 'none')
export const PRICE_BADGE = { confirmed: '실측확인', estimate: '실측불가' } as const
export const ESTIMATE_CAPTION = '인근 지역 평균 시세 기준'
// 요금 제보를 받을 주소(구글 폼 등). 비워 두면 화면에서 '곧 열릴 예정'이라고 알려 준다.
export const REPORT_URL: string = ''

// 칩 모양: 실측확인은 코랄, 실측불가는 회색, 없으면 옅은 회색
export const priceClass = (p: Place) => (p.price ? '' : p.price_estimate ? ' estimate' : ' unknown')

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
