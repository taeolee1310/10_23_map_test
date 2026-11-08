import { lazy, Suspense, useEffect, useState } from 'react'
import BathhouseIntro from './components/BathhouseIntro'
import MainScreen from './screens/MainScreen/MainScreen'
import { routeOf, type Route } from './lib/stories'

// 매거진·작성 화면은 들어갈 때만 내려받는다(지도 화면을 무겁게 하지 않게)
const Magazine = lazy(() => import('./screens/Magazine/Magazine'))
const Editor = lazy(() => import('./screens/Magazine/Editor'))
const HOME_TITLE = document.title // index.html의 제목. 매거진에서 돌아오면 되돌린다

export default function App() {
  const [route, setRoute] = useState<Route>(() => routeOf(location.pathname))
  // 첫 진입이 지도 화면일 때만 인트로를 보여 준다(매거진 링크로 바로 들어온 사람은 글부터 본다)
  const [showIntro, setShowIntro] = useState(() => routeOf(location.pathname).name === 'home')

  useEffect(() => {
    const onPop = () => setRoute(routeOf(location.pathname))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  useEffect(() => {
    if (route.name === 'home') document.title = HOME_TITLE
  }, [route.name])

  if (route.name === 'magazine' || route.name === 'story' || route.name === 'write') {
    return (
      <Suspense fallback={null}>
        {route.name === 'write' ? <Editor /> : <Magazine slug={route.name === 'story' ? route.slug : null} />}
      </Suspense>
    )
  }
  // 인트로를 본 뒤 onEnter가 불리면 메인 화면을 보여 준다
  if (showIntro) return <BathhouseIntro onEnter={() => setShowIntro(false)} />
  return <MainScreen />
}
