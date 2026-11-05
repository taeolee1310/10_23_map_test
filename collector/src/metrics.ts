// 대시보드 숫자 계산. 원천: web/public/data/onsen.json(화면에 나가는 곳) + data/collected 수집 파일.
// 숫자는 모두 여기서 계산하고, 어떤 조건으로 셌는지는 Dashboard.tsx의 설명 문장에 같이 적는다.

export type Place = {
  id: string
  name: string
  gu: string
  kind: string
  source: string
  tel?: string
  photo?: unknown
  parking?: unknown
  price?: { adult?: number | null; child?: number | null; none?: boolean; checked?: string } | null
  price_example?: { adult?: number } | null
  facts?: { towel?: unknown; hairdryer?: unknown; seshin?: unknown; convenience?: unknown; checked?: string } | null
}
type Row = Record<string, string>
export type Run = {
  at: number
  plan: string
  engine: string
  ok: boolean
  message: string
  saved: number | null
  failed: number | null
  fetchState: string | null
  seconds: number
}
export type Raw = {
  baseDate: string | null
  places: Place[] | null
  home: Row[]
  found: Row[]
  naverPlaces: Row[]
  manual: Row[]
  reviews: { kakaoId: string; collectedAt: string; keyword: number }[]
  blogs: { kakaoId: string; collectedAt: string; keyword: number }[]
  license: Row[]
  todoHome: number | null
  todoFind: number | null
  runs: Run[]
  usage?: import('./Usage').UsageRow[]
}

export type Item = Place & {
  linked: boolean
  homeDate: string
  homeOk: boolean
  ageDays: number | null
  priceOk: boolean
  childOk: boolean
  top3: number // 수건·드라이기·세신 중 확인된 개수
  hours: boolean
  idResult: string // 일치 / 못 찾음 / 못 찾음(기준 미달) / ''(시도 안 함)
  reviewDate: string // 방문자 후기 탭을 받은 날(없으면 '')
  blogDate: string // 블로그 리뷰 탭을 받은 날(없으면 '')
  area: number | null // 공공데이터(목욕장업 인허가) 소재지면적 ㎡. 못 맞춘 곳은 null
  bizType: string // 업태(공동탕업·찜질시설 등)
  big?: boolean // 면적 상위 5%(대형 시설). 표시만 하고 빼지 않는다
}

import { daysAgo } from './time'
// 며칠 지났는지는 한국 시간(KST) 날짜로 센다
export const daysSince = (date: string): number | null => daysAgo(date)

export function build(raw: Raw): Item[] {
  const naverId = new Map<string, string>()
  for (const r of [...raw.naverPlaces, ...raw.manual, ...raw.home]) if (r['카카오ID'] && r['네이버ID']) naverId.set(r['카카오ID'], r['네이버ID'])
  const home = new Map<string, Row>()
  for (const r of raw.home) {
    const prev = home.get(r['카카오ID'])
    if (!prev || (r['수집일'] ?? '') >= (prev['수집일'] ?? '')) home.set(r['카카오ID'], r)
  }
  const reviews = new Map((raw.reviews ?? []).map((r) => [r.kakaoId, r.collectedAt] as const))
  const blogs = new Map((raw.blogs ?? []).map((r) => [r.kakaoId, r.collectedAt] as const))
  const lic = new Map((raw.license ?? []).map((r) => [r['카카오ID'], r] as const))
  const found = new Map<string, string>()
  for (const r of raw.found) found.set(r['카카오ID'], r['결과'] ?? '')
  return (raw.places ?? []).map((p) => {
    const h = home.get(p.id)
    const f = p.facts ?? {}
    return {
      ...p,
      linked: naverId.has(p.id) || found.get(p.id) === '일치',
      homeDate: h?.['수집일'] ?? '',
      homeOk: h?.['상태'] === 'ok',
      ageDays: h ? daysSince(h['수집일']) : null,
      priceOk: p.price?.adult != null,
      childOk: p.price?.child != null,
      top3: [f.towel, f.hairdryer, f.seshin].filter(Boolean).length,
      hours: !!f.convenience,
      idResult: found.get(p.id) ?? '',
      reviewDate: reviews.get(p.id) ?? '',
      blogDate: blogs.get(p.id) ?? '',
      area: lic.get(p.id)?.['면적'] ? Number(lic.get(p.id)!['면적']) || null : null,
      bizType: lic.get(p.id)?.['업태'] ?? '',
    }
  })
}

export const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0)
export const count = (xs: Item[], f: (x: Item) => boolean) => xs.reduce((n, x) => n + (f(x) ? 1 : 0), 0)

export type GuRow = { gu: string; total: number; linked: number; home: number; price: number; top3: number }
export function byGu(items: Item[]): GuRow[] {
  const m = new Map<string, Item[]>()
  for (const x of items) m.set(x.gu || '(구 없음)', [...(m.get(x.gu || '(구 없음)') ?? []), x])
  return [...m].map(([gu, xs]) => ({
    gu,
    total: xs.length,
    linked: count(xs, (x) => x.linked),
    home: count(xs, (x) => x.homeOk),
    price: count(xs, (x) => x.priceOk),
    top3: count(xs, (x) => x.top3 > 0),
  }))
}

export const FRESH = [
  { key: '7일 이내', test: (d: number | null) => d != null && d <= 7 },
  { key: '8~30일', test: (d: number | null) => d != null && d > 7 && d <= 30 },
  { key: '31~90일', test: (d: number | null) => d != null && d > 30 && d <= 90 },
  { key: '90일 넘음', test: (d: number | null) => d != null && d > 90 },
  { key: '수집 안 함', test: (d: number | null) => d == null },
]

/** 대형 시설 기준: 면적을 아는 곳 중 상위 5%의 경계(㎡). 대형이라고 바로 빼지 않고, 사람이 보고 판단하게 표시만 한다 */
export function bigThreshold(items: Item[]): number {
  const a = items.map((x) => x.area ?? 0).filter((v) => v > 0).sort((x, y) => x - y)
  return a.length ? a[Math.floor(a.length * 0.95)] : Infinity
}