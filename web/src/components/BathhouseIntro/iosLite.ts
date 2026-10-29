// iPhone·iPad의 Safari에서 인트로가 잠깐 보이다가 탭이 죽는 문제를 좁히는 중이다(원인은 아직 모름).
// iOS에서만 무거운 처리를 단계별로 끈다. 숫자를 올려 가며 어느 단계에서 죽는지 확인한다.
//   0 = 정지한 그림만(캔버스·애니메이션 없음)
//   1 = 장면 합성(캔버스)·구름·물줄기·햇빛·수면 반사
//   2 = 수증기
//   3 = (건너뜀) 커서 연기: 마우스를 따라 움직이는 효과라 손가락이 주 입력인 기기에서는 항상 끈다
//   4 = 오리
// iOS가 아니면 전부 켠다(커서 연기만 마우스 기기에서).
export const IOS_LEVEL = 4

export const isIOS = () =>
  typeof navigator !== 'undefined' && (/iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1))

const ios = isIOS()
const on = (rank: number) => !ios || IOS_LEVEL >= rank

export const SCENE_ON = on(1)
export const STEAM_ON = on(2)
// 커서 연기(WebGL)는 마우스가 주 입력인 기기에서만 켠다. iOS와 손가락이 주 입력인 기기(pointer: coarse)에서는 끈다.
export const GHOST_ON = !ios && !(typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches)
export const DUCK_ON = on(4)
