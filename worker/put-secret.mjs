// Worker 비밀 값을 줄바꿈 없이 정확히 넣는다(PowerShell 파이프는 끝에 CRLF를 붙여 토큰이 어긋났다, 2026-11-06).
//   사용: SECRET_VALUE 환경 변수에 값을 두고  node put-secret.mjs <이름>   (값은 출력하지 않는다)
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const name = process.argv[2]
const value = process.env.SECRET_VALUE
if (!name || !value) {
  console.error('사용: SECRET_VALUE=값 node put-secret.mjs 이름')
  process.exit(1)
}
const cwd = path.dirname(fileURLToPath(import.meta.url))
const p = spawn('npx', ['wrangler', 'secret', 'put', name], { cwd, shell: true, stdio: ['pipe', 'ignore', 'inherit'] })
p.stdin.end(value)
p.on('exit', (code) => {
  console.log(code === 0 ? `${name}: 넣었어요` : `${name}: 실패(${code})`)
  process.exit(code ?? 1)
})
