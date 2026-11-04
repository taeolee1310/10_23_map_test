// 시간은 모두 한국 시간(KST, Asia/Seoul) 기준. 이 PC의 시간대가 달라도 같은 날짜·시각으로 센다.
export const TZ = 'Asia/Seoul'

/** 지금 KST 날짜 'YYYY-MM-DD' */
export function todayKst(now = Date.now()): string {
  return new Date(now).toLocaleDateString('sv-SE', { timeZone: TZ }) // sv-SE는 YYYY-MM-DD 모양
}

/** 'YYYY-MM-DD'가 오늘(KST)로부터 며칠 전인지. 읽을 수 없으면 null */
export function daysAgo(date: string, now = Date.now()): number | null {
  const a = Date.parse(`${date}T00:00:00Z`)
  const b = Date.parse(`${todayKst(now)}T00:00:00Z`)
  return Number.isFinite(a) ? Math.max(0, Math.round((b - a) / 86_400_000)) : null
}

/** 오늘(KST)에서 n일 전 날짜 'YYYY-MM-DD' */
export function daysBefore(n: number, now = Date.now()): string {
  const b = Date.parse(`${todayKst(now)}T00:00:00Z`) - n * 86_400_000
  return new Date(b).toISOString().slice(0, 10)
}

export const pcTimeZone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return TZ
  }
}
