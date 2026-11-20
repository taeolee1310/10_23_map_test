// 인기순에 쓰는 것: 서버의 목욕탕별 인기 점수 받기, 이 브라우저에서 '추천해요'를 누른 곳 기억하기.
// 계산 규칙은 lib/onsen.ts popularScore. 몇 명이 봤는지 같은 숫자는 화면에 보여 주지 않는다(순서에만 쓴다).
import { API_BASE } from './api'
import type { PopScores } from './onsen'

const TIMEOUT = 6000
let cache: Promise<PopScores> | null = null

/** 인기 점수 표. 못 받으면 빈 표(그러면 인기순은 정보 점수 순서가 된다). 한 번 받으면 화면을 닫을 때까지 다시 받지 않는다 */
export function fetchPopular(): Promise<PopScores> {
  if (!API_BASE) return Promise.resolve({})
  cache ??= fetch(`${API_BASE}/api/popular`, { signal: AbortSignal.timeout(TIMEOUT) })
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => (j && j.ok && j.scores && typeof j.scores === 'object' ? (j.scores as PopScores) : {}))
    .catch(() => {
      cache = null // 다음에 다시 시도
      return {}
    })
  return cache
}

const LIKE_KEY = 'tangbang:likes'

export function readLikes(): Set<string> {
  try {
    const v = JSON.parse(localStorage.getItem(LIKE_KEY) || '[]')
    return new Set(Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [])
  } catch {
    return new Set()
  }
}

export function writeLikes(s: Set<string>) {
  try {
    localStorage.setItem(LIKE_KEY, JSON.stringify([...s].slice(-500)))
  } catch {
    /* 저장소가 막힌 환경: 이번 화면에서만 기억한다 */
  }
}
