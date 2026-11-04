import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

// 탕방 데이터 수집 도구 창 화면. 색·움직임 토큰은 web/src/styles에서 그대로 가져온다(한 곳에서만 관리).
const root = fileURLToPath(new URL('..', import.meta.url))

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    host: '127.0.0.1',
    port: 1420,
    strictPort: true,
    fs: { allow: [root] },
  },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2021' },
})
