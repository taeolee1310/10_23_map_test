import type { ReactNode } from 'react'
import { go } from '../../lib/stories'
import './BottomNav.css'

// 모바일 하단 네비게이션 바(820px 이하에서만 보인다. 넓은 화면은 상단 버튼·메뉴를 그대로 쓴다).
// 탭을 더할 때는 TABS에 한 줄을 더하고, 그 화면에서 <BottomNav current="키" />를 그리면 된다(배지·소통 탭 예정, 2026-11-10).
export type NavKey = 'map' | 'magazine'

const icon = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true }
const TABS: { key: NavKey; label: string; href: string; icon: ReactNode }[] = [
  {
    key: 'map',
    label: '홈', // 지도·목록이 있는 첫 화면. 사용자에게는 '홈'으로 부른다(2026-11-10)
    href: '/',
    icon: (
      <svg {...icon}>
        <path d="M4 11.2 12 4.5l8 6.7" />
        <path d="M6.2 9.6V19h11.6V9.6" />
        <path d="M10 19v-5h4v5" />
      </svg>
    ),
  },
  {
    key: 'magazine',
    label: '매거진',
    href: '/magazine',
    icon: (
      <svg {...icon}>
        <path d="M12 6.6C10.4 5.4 8.2 4.8 5 4.8v12.6c3.2 0 5.4.6 7 1.8 1.6-1.2 3.8-1.8 7-1.8V4.8c-3.2 0-5.4.6-7 1.8z" />
        <path d="M12 6.6v12.6" />
      </svg>
    ),
  },
]

type Props = {
  current: NavKey
  /** 지금 화면의 탭을 다시 눌렀을 때(예: 지도 화면 맨 위로). 없으면 그 탭의 첫 화면으로 간다 */
  onCurrent?: () => void
}

export default function BottomNav({ current, onCurrent }: Props) {
  return (
    <nav className="bnav" aria-label="주요 화면">
      {TABS.map((t) => (
        <a
          key={t.key}
          href={t.href}
          data-tab={t.key}
          aria-current={t.key === current ? 'page' : undefined}
          onClick={(e) => {
            e.preventDefault()
            if (t.key === current && onCurrent) onCurrent()
            else go(t.href)
          }}
        >
          {t.icon}
          <span>{t.label}</span>
        </a>
      ))}
    </nav>
  )
}
