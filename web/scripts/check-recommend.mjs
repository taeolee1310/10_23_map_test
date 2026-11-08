// 추천순 점검: 실제 데이터(web/public/data/onsen.json)로 정보 점수 분포와 추천순 앞쪽을 보여 주고, 규칙이 지켜지는지 확인한다.
// 실행(web 폴더): node scripts/check-recommend.mjs   (Node 22.18+ / 24: .ts를 바로 읽는다)
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { infoScore, recommendScore, sortPlaces, km } from '../src/lib/onsen.ts'

const data = JSON.parse(readFileSync(new URL('../public/data/onsen.json', import.meta.url), 'utf8').replace(/^﻿/, ''))
const places = data.places
const now = Date.now()

// 1. 분포
const dist = new Map()
for (const p of places) dist.set(infoScore(p, now), (dist.get(infoScore(p, now)) ?? 0) + 1)
console.log(`정보 점수 분포(전체 ${places.length}곳, 점수: 곳 수):`, [...dist.entries()].sort((a, b) => b[0] - a[0]).map(([s, n]) => `${s}점 ${n}`).join(' · '))

// 2. 위치 모를 때: 점수 높은 순, 같으면 이름순
const noMe = sortPlaces(places.map((p) => ({ ...p, dist: null })), 'auto', false)
for (let i = 1; i < noMe.length; i++) {
  const a = infoScore(noMe[i - 1], now)
  const b = infoScore(noMe[i], now)
  assert.ok(a > b || (a === b && noMe[i - 1].name.localeCompare(noMe[i].name, 'ko') <= 0), `순서 어긋남: ${noMe[i - 1].name} → ${noMe[i].name}`)
}
console.log('✓ 위치 모를 때: 정보 점수 높은 순, 같으면 이름순')
console.log('  앞 5곳:', noMe.slice(0, 5).map((p) => `${p.name}(${infoScore(p, now)}점)`).join(', '))

// 3. 위치 알 때(서울시청): 추천 점수 높은 순, 거리 반영
const me = { lat: 37.5665, lng: 126.978 }
const withMe = places.map((p) => ({ ...p, dist: p.lat != null && p.lng != null ? km(me.lat, me.lng, p.lat, p.lng) : null }))
const near = sortPlaces(withMe, 'auto', true)
for (let i = 1; i < near.length; i++) assert.ok(recommendScore(near[i - 1], now) >= recommendScore(near[i], now), '추천 점수 순서 어긋남')
console.log('✓ 위치 알 때(서울시청 가정): 추천 점수 = 정보 점수 ÷ (1 + 거리/2km) 높은 순')
console.log('  앞 5곳:', near.slice(0, 5).map((p) => `${p.name}(${infoScore(p, now)}점, ${p.dist?.toFixed(1)}km)`).join(', '))

// 4. 같은 정보면 가까운 곳이 위
const base = { ...places[0], dist: 1 }
assert.ok(recommendScore(base, now) > recommendScore({ ...base, dist: 3 }, now))
console.log('✓ 같은 정보면 가까운 곳이 위')

// 5. 요금 없는 곳은 0점에서 시작(예시 요금은 점수에 안 들어감)
const ex = places.find((p) => !p.price && p.price_example)
if (ex) {
  assert.ok(infoScore({ ...ex, photo: undefined, facts: undefined }, now) === 0)
  console.log('✓ 예시 요금은 점수에 넣지 않음')
}
console.log('모두 통과')
