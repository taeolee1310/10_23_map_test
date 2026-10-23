import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/palette.css'
import './styles/motion.css'
import './index.css'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
