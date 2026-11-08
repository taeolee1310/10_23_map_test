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
  gu: string
  lat: number | null
  lng: number | null
  tel: string
  kind: string
  women_only: boolean
  url: string
  checked_at: string
  source: string
  price: Price | null
  price_estimate: PriceEstimate | null
  // 요금을 확인하지 못한 곳의 가상 값(구별 확인 요금 중앙값). 화면에는 반드시 '예시'로 표시한다
  price_example?: { adult: number; basis: string }
  photo?: string // 대표 사진(네이버 플레이스 업체 등록 사진) 주소
  parking: Parking[] | null // null=조회 안 됨, []=반경 안에 없음
  parking_radius: number | null
  facts?: Facts
}

// 가기 전에 알고 싶은 세부 정보. 직접 확인한 곳에만 있고, 없는 칸은 키 자체가 없다(추측으로 채우지 않는다).
export type DayKo = '월' | '화' | '수' | '목' | '금' | '토' | '일'
export type DryerInfo = { paid?: boolean; none?: boolean; has?: boolean; price?: number; low?: boolean }
export type TowelMode ={ mode: 'unlimited' | 'limited'; count?: number }
export type Facts = {
  // 전신 세신 금액: 남녀가 같으면 price_full, 다르면 price_men·price_women (한쪽만 확인된 곳은 그쪽만)
  seshin?: { payment?: 'cash_only' | 'card_ok'; price_full?: number; price_men?: number; price_women?: number; price_mini?: number; beds?: number; reservation?: boolean }
  towel?: { women?: TowelMode; men?: TowelMode } // 여탕·남탕이 다를 수 있다
  // 드라이기: 맨 위는 어느 탕인지 모르는 공통 값, women·men은 탕별 값(여탕은 유료인 곳이 많다).
  // paid: 무료·유료, none: 없음, has: 있다고만 확인(무료·유료 모름), price: 유료 금액, low: 근거가 후기 1건뿐이라 신뢰도가 낮다
  hairdryer?: DryerInfo & { women?: DryerInfo; men?: DryerInfo }
  // 가격표의 추가 요금. night.extra는 (야간 − 주간)을 코드로 계산한 값, overtime.label은 가게가 적은 문구 그대로
  fees?: { clothes?: number; night?: { price: number; extra?: number }; overtime?: { price: number; label?: string } }
  facility?: { baths?: { name: string; temp_c?: number }[]; sauna?: string[]; open_air?: boolean; water?: string }
  supplies?: { shampoo?: boolean; bodywash?: boolean }
  // closed_days: 가게가 등록한 휴무 문구 그대로('연중무휴' 등). hours: 요일별 영업시간(가게가 등록한 문구 그대로, 휴무일은 '정기휴무 …')
  convenience?: { parking_height_m?: number; open_24h?: boolean; sleeping_room?: boolean; closed_days?: string; hours?: Partial<Record<DayKo, string>> }
  // 가기 전 알아 둘 것: 최근 1년 네이버 후기·블로그에서 자동으로 뽑은 '등록 정보와 실제가 다른 점'(judge_facts judge_notices). 후기 문장을 그대로 옮기지 않고 정해진 문장으로 만든다
  notices?: { text: string; date: string; count?: number; source?: string }[]
  source?: string
  checked?: string
}

export type PlaceWithDist = Place & { dist: number | null }
export type LatLng = { lat: number; lng: number }

export type Filters = {
  q: string
  gu: string[] // 고른 구(여러 개 가능). 빈 목록 = 전체 지역
  priceOnly: boolean
  favOnly: boolean
}

export const DEFAULT_FILTERS: Filters = { q: '', gu: [], priceOnly: true, favOnly: false }

export const KIND_CLASS: Record<string, string> = { 온천: 'k0', '온천 숙박': 'k1', '온천 목욕탕·사우나': 'k2', '목욕탕·사우나': 'k2' }

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
  if (p.price_example) return '예시 · 성인 ' + won(p.price_example.adult) // 가상 값은 항상 '예시'를 앞에 붙인다
  return '요금 미확인'
}

// 확인한 요금은 그대로, 확인 못 한 곳은 '예시' 요금(옅은 칩)과 아래 한 줄로 확인 전임을 알린다.
export const priceState = (p: Place): 'confirmed' | 'estimate' | 'none' =>
  p.price ? 'confirmed' : p.price_example || p.price_estimate ? 'estimate' : 'none'
// 예시 요금은 요금 칩의 '예시' 표시로 충분해 따로 안내 문장을 두지 않는다(사용자 결정 2026-11-04). 요금 제보 링크만 남긴다
export const PRICE_NOTE = { confirmed: '가게가 올린 요금' } as const

// 요금 칩은 확인한 요금만 진하게, 미확인은 옅은 회색
export const priceClass = (p: Place) => (p.price ? '' : ' unknown')

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
      (!f.gu.length || f.gu.includes(d.gu)) &&
      (!f.priceOnly || d.price) &&
      (!f.favOnly || favs.has(d.id)) &&
      (!q || (d.name + ' ' + d.addr).toLowerCase().includes(q)),
  )
}

// ───────── 추천순 ─────────
// 추천 = "가기 전에 알고 갈 수 있는 정보가 많은 곳"을 먼저 보여 준다. 인기·광고·후기 별점은 쓰지 않는다(데이터가 없고, 정보가 확실한 곳이 동네 목욕탕을 고를 때 가장 쓸모 있음).
// 정보 점수(0~10점, 항목마다 확인된 것만 센다):
//   확인된 성인 입장료 3점 · 확인일이 최근 1년 안 1점 · 수건 1점 · 드라이기 1점 · 세신(금액 또는 결제 방법) 1점 · 대표 사진 1점 · 영업시간 1점 · 가기 전 알아 둘 것 1점
// 내 위치를 알면 가까울수록 높게: 추천 점수 = 정보 점수 ÷ (1 + 거리km ÷ 2). 2km 떨어지면 절반, 6km면 1/4.
//   (같은 정보면 가까운 곳이 위, 1km 안의 정보 없는 곳보다 3km 떨어진 정보 많은 곳이 위에 올 수 있다)
// 점수가 같으면 가까운 순 → 이름순.
export const RECOMMEND_HALF_KM = 2
const FRESH_MS = 365 * 86400_000

export function infoScore(p: Place, now = Date.now()) {
  const f = p.facts
  let s = 0
  if (p.price?.adult != null) {
    s += 3
    const t = Date.parse(p.price.checked)
    if (!Number.isNaN(t) && now - t <= FRESH_MS) s += 1
  }
  if (f?.towel?.women || f?.towel?.men) s += 1
  const d = f?.hairdryer
  if (d && (d.paid != null || d.none || d.has || d.women || d.men)) s += 1
  const sh = f?.seshin
  if (sh && (sh.price_full || sh.price_men || sh.price_women || sh.payment)) s += 1
  if (p.photo) s += 1
  if (f?.convenience?.hours && Object.keys(f.convenience.hours).length) s += 1
  if (f?.notices?.length) s += 1
  return s
}

export function recommendScore(p: PlaceWithDist, now = Date.now()) {
  const info = infoScore(p, now)
  return p.dist == null ? info : info / (1 + p.dist / RECOMMEND_HALF_KM)
}

export function sortPlaces(list: PlaceWithDist[], sort: string, hasMe: boolean) {
  const a = list.slice()
  if (sort === 'auto') {
    const now = Date.now()
    const score = new Map(a.map((p) => [p.id, recommendScore(hasMe ? p : { ...p, dist: null }, now)]))
    return a.sort(
      (x, y) =>
        score.get(y.id)! - score.get(x.id)! ||
        (hasMe ? (x.dist ?? Infinity) - (y.dist ?? Infinity) : 0) ||
        x.name.localeCompare(y.name, 'ko'),
    )
  }
  const by = sort
  if (by === 'dist' && hasMe) {
    // 좌표 없는 곳은 거리를 모르니 맨 뒤로
    a.sort((x, y) => (x.dist ?? Infinity) - (y.dist ?? Infinity))
  } else if (by === 'name' && hasMe) {
    // 내 위치 기반 이름순: 반경 안의 곳을 구와 상관없이 가나다순으로
    a.sort((x, y) => x.name.localeCompare(y.name, 'ko'))
  } else {
    a.sort((x, y) => x.gu.localeCompare(y.gu, 'ko') || x.name.localeCompare(y.name, 'ko'))
  }
  return a
}

// 내 위치를 아는 상태에서 '이름순'을 고르면 이 반경(km) 안의 곳만 가나다순으로 보여 준다(사용자 결정 2026-11-08)
export const NEAR_KM = 3

// 서울 25개 구 경계(통계청 SGIS 2018, 공공누리 제1유형). export_gu_boundary(러스트)가 만든 seoul-gu.json을 읽는다.
export type GuBoundary = Record<string, [number, number][][]>

function inRing(x: number, y: number, ring: [number, number][]) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

// 이 좌표가 속한 구 이름. 서울 밖이면 빈 글자
export function guAt(lat: number, lng: number, b: GuBoundary): string {
  for (const [name, rings] of Object.entries(b)) if (rings.some((r) => inRing(lng, lat, r))) return name
  return ''
}
