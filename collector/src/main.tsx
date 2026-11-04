import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// 색·움직임 토큰은 서비스 화면과 같은 파일을 쓴다(값을 여기 다시 적지 않는다)
import '../../web/src/styles/tangbang-colors.css'
import '../../web/src/styles/motion.css'
import './app.css'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
