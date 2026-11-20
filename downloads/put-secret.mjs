// 도구함 Worker 비밀 값을 파일에서 읽어 줄바꿈 없이 넣는다(값은 화면에 내지 않는다).
//   사용: node put-secret.mjs <이름> <값이 든 파일>
//   주인이 비밀번호를 정할 때:  node put-secret.mjs DOWNLOAD_CODE   (파일 없이 실행하면 숫자를 물어본다, 입력은 화면에 보이지 않는다)
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const [name, file] = process.argv.slice(2)
if (!name) {
  console.error('사용: node put-secret.mjs <이름> [값이 든 파일]')
  process.exit(1)
}
const cwd = path.dirname(fileURLToPath(import.meta.url))
const wrangler = path.join(cwd, '..', 'worker', 'node_modules', 'wrangler', 'bin', 'wrangler.js')

async function ask() {
  // 숫자 비밀번호를 화면에 보이지 않게 받는다
  process.stdout.write('비밀번호(숫자 4~10자리): ')
  process.stdin.setRawMode?.(true)
  let v = ''
  for await (const chunk of process.stdin) {
    for (const ch of chunk.toString()) {
      if (ch === '\r' || ch === '\n') { process.stdin.setRawMode?.(false); process.stdout.write('\n'); return v }
      if (ch === '\u0003') process.exit(130)
      if (ch === '\u007f' || ch === '\b') v = v.slice(0, -1)
      else v += ch
    }
  }
  return v
}

let value = file ? readFileSync(file, 'utf8').trim() : await ask()
if (name === 'DOWNLOAD_CODE' && !/^\d{4,10}$/.test(value)) {
  console.error('비밀번호는 숫자 4~10자리여야 해요(도구함 화면이 숫자 칸으로 받는다). 8자리 이상을 권해요.')
  process.exit(1)
}
const p = spawn(process.execPath, [wrangler, 'secret', 'put', name], { cwd, stdio: ['pipe', 'ignore', 'inherit'] })
p.stdin.end(value)
value = ''
p.on('exit', (code) => {
  console.log(code === 0 ? `${name}: 넣었어요` : `${name}: 실패(${code})`)
  process.exit(code ?? 1)
})
