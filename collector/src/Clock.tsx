import { useEffect, useState } from 'react'
import { pcTimeZone, TZ } from './time'

// 머리말 시계: 지금 한국 시각. 예상 끝나는 시각·수집 신선도·'다시 받기' 기준이 모두 이 시각에서 나온다.
export default function Clock() {
  const [t, setT] = useState(Date.now())
  useEffect(() => {
    const i = window.setInterval(() => setT(Date.now()), 1000)
    return () => window.clearInterval(i)
  }, [])
  const d = new Date(t)
  const time = d.toLocaleTimeString('ko-KR', { timeZone: TZ, hour: 'numeric', minute: '2-digit', second: '2-digit' })
  const date = d.toLocaleDateString('ko-KR', { timeZone: TZ, month: 'long', day: 'numeric', weekday: 'short' })
  const other = pcTimeZone() !== TZ
  return (
    <div className="clock" title={other ? `이 PC 시간대(${pcTimeZone()})와 달라도 한국 시간으로 셉니다` : '모든 시간은 한국 시간 기준이에요'}>
      <span className="clock-time" aria-live="off">{time}</span>
      <span className="clock-date">
        {date} · 한국 시간{other ? ' (PC 시간대와 다름)' : ''}
      </span>
    </div>
  )
}
