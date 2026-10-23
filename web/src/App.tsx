import { useState } from 'react'
import OnsenIntro from './components/OnsenIntro'
import MainScreen from './screens/MainScreen/MainScreen'

export default function App() {
  const [showIntro, setShowIntro] = useState(true)

  // 첫 진입에는 인트로를 전체 화면으로 보여 주고, onEnter가 불리면 숨기고 메인 화면을 보여 준다.
  if (showIntro) return <OnsenIntro onEnter={() => setShowIntro(false)} />
  return <MainScreen />
}
