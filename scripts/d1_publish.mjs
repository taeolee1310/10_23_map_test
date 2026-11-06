// 탕방 데이터 DB(Cloudflare D1)에 초안을 올리고 '공개'하는 관리 도구. 수집 PC에서만 쓴다.
//   실행(프로젝트 폴더): node --env-file=.env scripts/d1_publish.mjs <명령>
//   .env에 필요한 값(값은 setup.ps1이 넣는다): TANGBANG_API(Worker 주소), TANGBANG_ADMIN_TOKEN
// 명령:
//   status                  공개 중인 스냅샷·초안·새 제보 수
//   ingest [파일]           web/public/data/onsen.json(기본)을 초안으로 올린다(바뀐 곳만 씀). 사용자 화면은 안 바뀜
//   diff                    공개본과 초안의 차이(새로 생긴 곳·빠진 곳·바뀐 곳·요금 바뀐 곳)
//   publish [--force] [--note 메모]   검증 통과 시 초안을 공개(1분 안에 사용자 화면에 반영)
//   rollback [스냅샷id]     직전(또는 지정한) 공개본으로 되돌린다
//   reports [new|reviewed|applied|rejected]   제보 목록
//   report-set <id> <상태> [메모]             제보 상태 바꾸기
// 토큰 값은 출력하지 않는다.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const API = (process.env.TANGBANG_API || '').replace(/\/+$/, '')
const TOKEN = process.env.TANGBANG_ADMIN_TOKEN || ''
const [cmd = 'status', ...args] = process.argv.slice(2)

if (!API || !TOKEN) {
  console.error('⛔ TANGBANG_API와 TANGBANG_ADMIN_TOKEN이 필요해요. `node --env-file=.env scripts/d1_publish.mjs ...`로 실행하거나 worker/setup.ps1을 먼저 돌려 주세요.')
  process.exit(1)
}

async function call(method, p, body) {
  const r = await fetch(API + p, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const j = await r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` }))
  if (!r.ok || !j.ok) {
    console.error(`⛔ ${method} ${p} 실패: ${j.error || r.status}`)
    for (const x of j.problems || []) console.error(`  - ${x}`)
    process.exit(2)
  }
  return j
}

const flag = (name) => args.includes(name)
const opt = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

if (cmd === 'status') {
  const s = await call('GET', '/admin/status')
  console.log(`공개 중인 스냅샷: ${s.active ?? '없음'}`)
  console.log(`초안: ${s.draft.count}곳 · 기준일 ${s.draft.baseDate ?? '-'} · 마지막으로 올린 때 ${s.draft.updatedAt ?? '-'}`)
  console.log(`새 제보: ${s.newReports}건`)
  for (const x of s.snapshots) console.log(`  #${x.id} ${x.created_at} ${x.place_count}곳${x.note ? ` · ${x.note}` : ''}`)
} else if (cmd === 'ingest') {
  const file = path.resolve(ROOT, args[0] || 'web/public/data/onsen.json')
  const data = JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, ''))
  const j = await call('POST', '/admin/ingest', { baseDate: data.baseDate, places: data.places })
  console.log(`초안 올림: ${j.received}곳 받음 · 새로 쓰거나 바뀐 곳 ${j.upserted} · 빠진 곳 ${j.deleted} (사용자 화면은 아직 그대로)`)
} else if (cmd === 'diff') {
  const d = await call('GET', '/admin/diff')
  const c = d.counts
  console.log(`공개본 ${c.live}곳 → 초안 ${c.draft}곳 · 새로 생김 ${c.added} · 빠짐 ${c.removed} · 내용 바뀜 ${c.changed} · 대인 요금 바뀜 ${c.priceChanged}`)
  if (d.added.length) console.log(`  새로 생김: ${d.added.join(', ')}`)
  if (d.removed.length) console.log(`  빠짐: ${d.removed.join(', ')}`)
  for (const p of d.priceChanges) console.log(`  요금: ${p.name} ${p.before ?? '없음'} → ${p.after ?? '없음'}`)
} else if (cmd === 'publish') {
  const j = await call('POST', '/admin/publish', { force: flag('--force'), note: opt('--note') })
  console.log(`공개했어요: 스냅샷 #${j.from ?? '-'} → #${j.to} (${j.count}곳). 1분 안에 사용자 화면에 반영돼요.`)
} else if (cmd === 'rollback') {
  const j = await call('POST', '/admin/rollback', args[0] ? { to: Number(args[0]) } : {})
  console.log(`되돌렸어요: 스냅샷 #${j.from} → #${j.to}`)
} else if (cmd === 'reports') {
  const j = await call('GET', `/admin/reports?status=${encodeURIComponent(args[0] || 'new')}`)
  for (const r of j.reports)
    console.log(`#${r.id} ${r.created_at.slice(0, 16)} ${r.place_name} · 입장료 ${r.adult ?? '-'} 수건 ${r.towel ?? '-'} 세신 ${r.scrub ?? '-'} · ${r.source}${r.flags ? ` · [${r.flags}]` : ''}${r.memo ? ` · ${r.memo}` : ''}`)
  console.log(`${j.reports.length}건`)
} else if (cmd === 'report-set') {
  const [id, st, ...note] = args
  await call('POST', `/admin/reports/${Number(id)}`, { status: st, note: note.join(' ') })
  console.log(`제보 #${id} → ${st}`)
} else {
  console.error(`모르는 명령: ${cmd}`)
  process.exit(1)
}
