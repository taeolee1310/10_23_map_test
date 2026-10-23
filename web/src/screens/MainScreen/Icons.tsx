const base = { fill: 'none', stroke: 'currentColor', strokeLinecap: 'round' as const, 'aria-hidden': true }

export const IconPin = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" strokeWidth="2.2" {...base}>
    <path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z" />
    <circle cx="12" cy="9.5" r="2.5" />
  </svg>
)
export const IconDrop = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" strokeWidth="2.2" {...base}>
    <path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z" />
  </svg>
)
export const IconLeaf = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" strokeWidth="2.2" {...base}>
    <path d="M5 19c0-9 5-14 15-14 0 10-5 15-14 15" />
    <path d="M5 19c3-4 6-6 9-8" />
  </svg>
)
export const IconHeart = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" strokeWidth={size > 14 ? 2 : 2.2} strokeLinejoin="round" {...base}>
    <path d="M12 20s-7-4.6-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.4-7 10-7 10z" />
  </svg>
)
export const IconSearch = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" strokeWidth="2" {...base}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
)
export const IconLocate = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" strokeWidth="2" {...base}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
  </svg>
)

export const HintPin = () => (
  <svg width="54" height="54" viewBox="0 0 32 32" aria-hidden="true">
    <path d="M16 1.8C9.6 1.8 4.8 6.5 4.8 12.6c0 7.6 11.2 18.4 11.2 18.4s11.2-10.8 11.2-18.4C27.2 6.5 22.4 1.8 16 1.8z" fill="#dff1fb" />
    <g fill="none" stroke="#03A3EA" strokeWidth="1.5" strokeLinecap="round">
      <path d="M12.6 13.4c-1.6-1.5 1.5-2.8 0-4.7M17.4 13.4c-1.6-1.5 1.5-2.8 0-4.7" />
      <path d="M9.6 17c1.5-1.3 3-1.3 4.5 0s3 1.3 4.5 0 3-1.3 3.8 0M10.6 20.4c1.3-1.1 2.6-1.1 3.9 0s2.6 1.1 3.9 0" />
    </g>
  </svg>
)
