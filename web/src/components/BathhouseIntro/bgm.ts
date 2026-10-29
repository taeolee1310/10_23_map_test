// 인트로 배경음악. 소리가 뚝 켜지고 꺼지지 않게 모든 변화를 디졸브(서서히 겹쳐 사라짐)로 처리한다.
//  - 시작: FADE_IN_MS 동안 서서히 커진다
//  - 끝(나가기·끄기): 부드럽게 줄어든 뒤 멈춘다. 컴포넌트가 사라져도 끝까지 줄어든다
//  - 반복 이음새: 곡의 끝 LOOP_FADE_S초는 줄고, 다시 시작하는 처음 LOOP_FADE_S초는 커진다
// 사람 귀는 소리 크기를 로그로 느끼므로 단계(level)를 제곱해서 음량에 쓴다.

export const FADE_IN_MS = 1500
export const FADE_OUT_MS = 1800
const LOOP_FADE_S = 0.4 // 15초짜리 잔잔한 곡이라 길게 줄이면 15초마다 숨쉬듯 들린다

const smooth = (p: number) => p * p * (3 - 2 * p)

export type Bgm = {
  /** 켠다(자동재생이 막혔으면 아무 일도 없고, 다음에 다시 부르면 된다). 서서히 커진다 */
  play: () => void
  /** 전체 음량(0~1). 페이드 곡선 위에 곱해진다 */
  setVolume: (v: number) => void
  /** 서서히 줄이고 멈춘다 */
  fadeOut: (ms?: number) => void
  /** 줄이는 중이어도 끝까지 줄인 뒤 정리한다. 컴포넌트가 사라질 때 부른다 */
  release: () => void
}

export function createBgm(src: string, initialVolume: number): Bgm {
  let volume = initialVolume
  const audio = new Audio(src)
  audio.loop = true
  audio.volume = 0
  let level = 0
  let from = 0
  let to = 0
  let t0 = 0
  let dur = 1
  let raf = 0
  let disposed = false

  const loopEnv = () => {
    const d = audio.duration
    if (!Number.isFinite(d) || d < LOOP_FADE_S * 4) return 1 // 짧은 곡은 이음새 처리 안 함
    const t = audio.currentTime
    const edge = Math.min(t, d - t)
    return edge >= LOOP_FADE_S ? 1 : smooth(Math.max(0, edge) / LOOP_FADE_S)
  }

  const tick = (now: number) => {
    const p = Math.min(1, (now - t0) / dur)
    level = from + (to - from) * smooth(p)
    audio.volume = Math.min(1, volume * level * level * loopEnv())
    if (to === 0 && p >= 1) {
      audio.pause()
      raf = 0
      if (disposed) audio.src = ''
      return
    }
    raf = requestAnimationFrame(tick)
  }

  const go = (target: number, ms: number) => {
    from = level
    to = target
    t0 = performance.now()
    dur = Math.max(1, ms)
    if (!raf) raf = requestAnimationFrame(tick)
  }

  return {
    play() {
      if (disposed || (to === 1 && !audio.paused)) return // 이미 커지는 중이거나 켜져 있으면 다시 시작하지 않는다
      audio.play().then(
        () => {
          if (disposed) {
            // 재생이 시작되기 전에 정리된 경우(개발 모드의 효과 재실행): 소리를 켜지 않고 멈춘다
            audio.pause()
            audio.src = ''
            return
          }
          go(1, FADE_IN_MS * (1 - level))
        },
        () => {},
      )
    },
    setVolume(v) {
      volume = Math.min(1, Math.max(0, v))
      if (!raf) audio.volume = Math.min(1, volume * level * level * loopEnv())
    },
    fadeOut(ms = FADE_OUT_MS) {
      if (to !== 0 && !audio.paused) go(0, ms * level)
    },
    release() {
      disposed = true
      if (audio.paused) {
        cancelAnimationFrame(raf)
        audio.src = ''
        return
      }
      if (to !== 0) go(0, FADE_OUT_MS * level)
    },
  }
}
