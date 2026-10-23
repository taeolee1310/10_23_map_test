import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 카카오 콘솔 JavaScript SDK 도메인에는 http://localhost:5173 을 등록한다.
export default defineConfig({
  plugins: [react()],
  // 프로젝트 루트의 .env를 읽되 KAKAO_JS_ 로 시작하는 값만 브라우저로 보낸다. (REST 키는 접두어가 달라 절대 안 나간다)
  envDir: '..',
  envPrefix: 'KAKAO_JS_',
  // 카카오는 등록한 주소(localhost)에서만 지도를 준다. 127.0.0.1로 열리지 않게 주소를 정해서 연다.
  server: { port: 5173, strictPort: true, open: 'http://localhost:5173/' },
})
