// 매거진 작성용 편집 토큰을 만들어 .env(TANGBANG_EDITOR_TOKEN)와 Worker 비밀 값(EDITOR_TOKEN)에 넣는다. 처음 한 번만.
//   실행(프로젝트 폴더): node worker/setup-editor.mjs
// 토큰 값은 화면에 출력하지 않는다. 작성 화면(/magazine/write)에 넣을 때는 .env의 TANGBANG_EDITOR_TOKEN 값을 직접 복사한다.
// 이미 .env에 있으면 새로 만들지 않고 그 값을 Worker에 다시 넣는다(토큰이 어긋났을 때 고치는 용도로도 쓴다).
import { readFileSync, appendFileSync, existsSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const envFile = path.join(here, '..', '.env')
const KEY = 'TANGBANG_EDITOR_TOKEN'
const text = existsSync(envFile) ? readFileSync(envFile, 'utf8') : ''
const line = text.split(/\r?\n/).find((l) => l.startsWith(KEY + '='))
let token = line ? line.slice(KEY.length + 1).trim() : ''
if (!token) {
  token = randomBytes(24).toString('base64url')
  appendFileSync(envFile, (text && !text.endsWith('\n') ? '\n' : '') + `${KEY}=${token}\n`)
  console.log(`.env에 ${KEY}를 새로 만들었어요(${token.length}자)`)
} else console.log(`.env의 ${KEY}를 그대로 써요(${token.length}자)`)
const r = spawnSync('node', ['put-secret.mjs', 'EDITOR_TOKEN'], { cwd: here, env: { ...process.env, SECRET_VALUE: token }, stdio: 'inherit', shell: process.platform === 'win32' })
process.exit(r.status ?? 1)
