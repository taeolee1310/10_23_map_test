import { useEffect, useRef, useState, type CSSProperties } from 'react'
import OnsenLogo from '../OnsenLogo'
import './OnsenIntro.css'

export type OnsenIntroProps = {
  onEnter?: () => void
}

const LEAVE_MS = 700 // 눌렀을 때 화면이 천천히 옅어지는 시간 (CSS의 --intro-leave와 같게)

// 요소마다 나타나는 시점을 CSS 변수로 넘긴다
const at = (ms: number) => ({ '--d': `${ms}ms` }) as CSSProperties

/**
 * 인트로: 편집 디자인(포스터·여행 안내서) 느낌의 비대칭 2단 구성.
 * 왼쪽에 카피와 CTA, 오른쪽에 온천에서 쉬는 캐릭터 한 장면(단색 일러스트).
 * 움직임은 천천히·부드럽게. 재생과 쉼을 번갈아 반복한다.
 */
export default function OnsenIntro({ onEnter }: OnsenIntroProps) {
  const [isLeaving, setIsLeaving] = useState(false)
  const timerRef = useRef<number | null>(null)

  const handleEnter = () => {
    if (isLeaving) return
    setIsLeaving(true)
    timerRef.current = window.setTimeout(() => onEnter?.(), LEAVE_MS)
  }

  useEffect(
    () => () => {
      if (timerRef.current) window.clearTimeout(timerRef.current)
    },
    [],
  )

  return (
    <main className={`onsen-intro${isLeaving ? ' onsen-intro--leaving' : ''}`} aria-labelledby="onsen-intro-title">
      <header className="onsen-intro__bar onsen-intro__reveal" style={at(0)}>
        <span className="onsen-intro__brand">
          <OnsenLogo className="onsen-intro__mark" height={34} autoPlay={false} calm />
          <span className="onsen-intro__wordmark">
            탕방<small>TANGBANG</small>
          </span>
        </span>
        <span className="onsen-intro__guide">KOREA ONSEN GUIDE</span>
      </header>

      <div className="onsen-intro__body">
        <div className="onsen-intro__copy">
          <p className="onsen-intro__eyebrow onsen-intro__reveal" style={at(250)}>
            한국의 온천을 찾아서
          </p>
          <h1 id="onsen-intro-title" className="onsen-intro__reveal" style={at(450)}>
            오늘은,
            <br />
            따뜻한 곳으로.
          </h1>
          <p className="onsen-intro__sub onsen-intro__reveal" style={at(750)}>
            아직 몰랐던 온천을 발견하는 작은 여행.
          </p>
        </div>

        <div className="onsen-intro__art onsen-intro__reveal" style={at(500)}>
          {/* 장면은 먼저 자리 잡고, 잠시 뒤부터 움직임을 반복한다(재생 4초 → 쉼 2.2초) */}
          <OnsenLogo className="onsen-intro__scene" height="var(--intro-art-h)" title="온천에 몸을 담근 탕방 캐릭터" cycle={4} delay={1100} rest={2200} loop calm />
        </div>

        <div className="onsen-intro__cta onsen-intro__reveal" style={at(1000)}>
          <button className="onsen-intro__button" type="button" onClick={handleEnter} disabled={isLeaving}>
            <span>온천 찾아보기</span>
            <span className="onsen-intro__arrow" aria-hidden="true">
              →
            </span>
          </button>
        </div>
      </div>

      <p className="onsen-intro__status" aria-live="polite">
        {isLeaving ? '온천 찾기 화면으로 이동합니다.' : ''}
      </p>
    </main>
  )
}
