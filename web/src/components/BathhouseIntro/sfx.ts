// 오리 효과음. 배경음악(bgm.ts)과 따로 한 번씩 짧게 울린다.
//  - 연달아 눌러도 소리가 겹쳐 시끄럽지 않게, 한 번 울리는 동안(또는 MIN_GAP_MS 안)에는 다시 울리지 않는다.
//  - 파일이 없거나 재생이 막혀도 아무 일도 없다(인트로 사용을 막지 않는다).
const MIN_GAP_MS = 350

export type Sfx = {
  play: () => void
  release: () => void
}

export function createSfx(src: string, volume = 0.5): Sfx {
  const audio = new Audio(src)
  audio.preload = 'auto'
  audio.volume = volume
  let last = 0
  return {
    play() {
      const now = performance.now()
      if (now - last < MIN_GAP_MS) return
      last = now
      audio.currentTime = 0
      audio.play().catch(() => {})
    },
    release() {
      audio.pause()
      audio.src = ''
    },
  }
}
