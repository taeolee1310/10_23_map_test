// 담아둔 곳 백업(web/api/favs.js) 점검. 실행(web 폴더): node scripts/check-favs.mjs
import assert from 'node:assert/strict'
import handler, { parseIds, readCookie, cookieFor } from '../api/favs.js'

const fake = (method, { body, cookie } = {}) => {
  const out = { headers: {}, code: 0, body: null }
  const res = {
    setHeader: (k, v) => (out.headers[k.toLowerCase()] = v),
    status: (c) => ((out.code = c), res),
    json: (j) => ((out.body = j), res),
  }
  return { req: { method, body, headers: { cookie } }, res, out }
}

let t = fake('POST', { body: { ids: ['123', 'lic_45', '123', 'bad id', '<x>'] } })
await handler(t.req, t.res)
assert.equal(t.out.code, 200)
assert.equal(t.out.body.count, 2)
const set = t.out.headers['set-cookie']
assert.match(set, /^tb_favs=123\.lic_45;/)
assert.match(set, /HttpOnly/)
assert.match(set, /Path=\/api\/favs/)
assert.match(set, /Max-Age=34560000/)
console.log('✓ 저장: 중복·이상한 ID는 버리고 쿠키(HttpOnly, 400일, /api/favs에만)로 심음')

t = fake('GET', { cookie: `other=1; ${set.split(';')[0]}` })
await handler(t.req, t.res)
assert.deepEqual(t.out.body.ids, ['123', 'lic_45'])
console.log('✓ 읽기: 쿠키에서 목록을 되돌려 줌')

t = fake('POST', { body: { ids: [] } })
await handler(t.req, t.res)
assert.match(t.out.headers['set-cookie'], /Max-Age=0/)
console.log('✓ 빈 목록이면 쿠키를 지움')

assert.equal(parseIds(Array.from({ length: 300 }, (_, i) => `id${i}`).join('.')).length, 150)
assert.ok(cookieFor(Array.from({ length: 150 }, (_, i) => `1234567890${i}`)).length < 4096)
console.log('✓ 150곳까지만, 쿠키 4KB 안')

t = fake('POST', { body: 'not json' })
await handler(t.req, t.res)
assert.equal(t.out.code, 400)
t = fake('DELETE')
await handler(t.req, t.res)
assert.equal(t.out.code, 405)
assert.equal(readCookie(''), '')
console.log('✓ 잘못된 요청은 거절')
console.log('모두 통과')
