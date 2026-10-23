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
  <span className="pin-static" aria-hidden="true">
    <span className="pin__outline" />
    <span className="pin__tub" />
  </span>
)
