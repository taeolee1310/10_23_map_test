// 매거진 글: 받기·주소·본문 해석. 글은 Cloudflare Worker(D1 stories 표)에 있고, 운영자가 /magazine/write에서 쓰고 공개한다.
import { API_BASE } from './api'

export type StoryCategory = 'unknown' | 'tips' | 'special' | 'people'
export const CATEGORIES: { value: StoryCategory; label: string; short: string }[] = [
  { value: 'unknown', label: '몰랐던 이야기', short: '몰랐던' },
  { value: 'tips', label: '도움이 되는 정보', short: '정보' },
  { value: 'special', label: '특별한 목욕탕', short: '특별한 곳' },
  { value: 'people', label: '사람들의 사연', short: '사연' },
]
export const catLabel = (c: string) => CATEGORIES.find((x) => x.value === c)?.label ?? c

export type Story = {
  id: number
  slug: string
  title: string
  category: StoryCategory
  summary: string
  cover: string
  author: string
  place_ids: string[]
  status: 'draft' | 'published' | 'hidden'
  published_at: string | null
  updated_at: string
  body?: string
}

const TIMEOUT = 8000

export async function fetchStories(): Promise<Story[]> {
  if (!API_BASE) return []
  const r = await fetch(`${API_BASE}/api/stories`, { signal: AbortSignal.timeout(TIMEOUT) })
  if (!r.ok) throw new Error('stories')
  return ((await r.json()) as { stories: Story[] }).stories
}

export async function fetchStory(slug: string): Promise<Story | null> {
  if (!API_BASE) return null
  const r = await fetch(`${API_BASE}/api/stories/${encodeURIComponent(slug)}`, { signal: AbortSignal.timeout(TIMEOUT) })
  if (r.status === 404) return null
  if (!r.ok) throw new Error('story')
  return ((await r.json()) as { story: Story }).story
}

// 작성 화면용(편집 토큰). 토큰은 이 탭에만(sessionStorage) 둔다
export const EDITOR_KEY = 'tangbang:editor'
export async function editorCall<T>(method: 'GET' | 'POST', token: string, body?: unknown): Promise<{ status: number; data: T }> {
  const r = await fetch(`${API_BASE}/api/editor/stories`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  })
  return { status: r.status, data: (await r.json().catch(() => ({}))) as T }
}

// 한국 날짜 '11.08'과 영문 요일 'Sun.'
export function storyDate(iso: string | null) {
  if (!iso) return { md: '--.--', wd: '' }
  const d = new Date(Date.parse(iso) + 9 * 3600_000)
  const md = `${String(d.getUTCMonth() + 1).padStart(2, '0')}.${String(d.getUTCDate()).padStart(2, '0')}`
  return { md, wd: ['Sun.', 'Mon.', 'Tue.', 'Wed.', 'Thu.', 'Fri.', 'Sat.'][d.getUTCDay()] }
}

// 본문 해석: 빈 줄 = 문단, '## ' = 소제목, '> ' = 인용, '![설명](https://…)' 한 줄 = 사진. HTML은 쓰지 않는다(화면은 글자로만 넣는다)
export type Block = { kind: 'p' | 'h' | 'quote'; text: string } | { kind: 'img'; src: string; alt: string }
export function parseBody(body: string): Block[] {
  const out: Block[] = []
  for (const chunk of body.replace(/\r\n?/g, '\n').split(/\n\s*\n/)) {
    const t = chunk.trim()
    if (!t) continue
    const img = /^!\[([^\]]*)\]\((https:\/\/[^)\s]+)\)$/.exec(t)
    if (img) out.push({ kind: 'img', alt: img[1], src: img[2] })
    else if (t.startsWith('## ')) out.push({ kind: 'h', text: t.slice(3).trim() })
    else if (t.startsWith('>')) out.push({ kind: 'quote', text: t.split('\n').map((l) => l.replace(/^>\s?/, '')).join('\n') })
    else out.push({ kind: 'p', text: t })
  }
  return out
}

// 주소: /magazine, /magazine/<slug>, /magazine/write. 화면 전환은 history로 하고 popstate로 되돌린다
export type Route = { name: 'home' } | { name: 'magazine' } | { name: 'story'; slug: string } | { name: 'write' }
export function routeOf(path: string): Route {
  const p = path.replace(/\/+$/, '')
  if (p === '/magazine') return { name: 'magazine' }
  if (p === '/magazine/write') return { name: 'write' }
  const m = /^\/magazine\/([a-z0-9-]{1,60})$/.exec(p)
  if (m) return { name: 'story', slug: m[1] }
  return { name: 'home' }
}
export function go(path: string) {
  if (location.pathname === path) return
  history.pushState({}, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}
