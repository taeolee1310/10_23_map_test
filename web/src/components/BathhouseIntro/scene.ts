import bgUrl from '../../assets/bathhouse/bg.webp'
import origUrl from '../../assets/bathhouse/orig.webp'
import reflectionUrl from '../../assets/bathhouse/reflection-texture.webp'
import maskSkyUrl from '../../assets/bathhouse/mask-sky.svg'
import maskCloudAUrl from '../../assets/bathhouse/mask-cloud-a.svg'
import maskCloudBUrl from '../../assets/bathhouse/mask-cloud-b.svg'
import maskSunUrl from '../../assets/bathhouse/mask-sun.svg'
import maskWaterUrl from '../../assets/bathhouse/mask-water.svg'
import maskWaterDetailUrl from '../../assets/bathhouse/mask-water-detail.svg'
import maskFountainUrl from '../../assets/bathhouse/mask-fountain.svg'
import { STREAM_LEFT, STREAM_RIGHT, STREAM_Y0, STREAM_Y1 } from './streamEdges'

/**
 * Figma 'Bathhouse_Motion_v3 / 원본 질감 복원'(381:2)의 레이어를 그대로 합친다.
 * 쓰는 에셋은 이 Figma 파일에서 받은 것뿐이다: 배경(수증기·물줄기 제거), 원본 일러스트(2배 해상도), 반사 질감, 수증기 질감, 마스크 SVG. (수증기는 CSS 마스크로 원본 PNG를 그대로 쓴다)
 * 좌표는 모두 Figma 원본 1536×1024 기준이다.
 */
export const STAGE_W = 1536
export const STAGE_H = 1024
const BASE_SCALE = 2 // 바탕은 원본 일러스트(3072×2048) 해상도로 합친다

const load = (url: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`이미지를 불러오지 못했어요: ${url}`))
    img.src = url
  })

const canvas = (w: number, h: number) => {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w))
  c.height = Math.max(1, Math.round(h))
  return c
}

const toUrl = (c: HTMLCanvasElement) =>
  new Promise<string>((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(URL.createObjectURL(b)) : reject(new Error('이미지를 만들지 못했어요'))), 'image/png'),
  )

type Box = { x: number; y: number; w: number; h: number }

/** 원본 일러스트에서 Figma 마스크(mask-alpha) 모양만 오려 낸다. 마스크 상자 크기의 조각을 돌려준다. */
function cutOriginal(orig: HTMLImageElement, mask: HTMLImageElement, box: Box, scale: number) {
  const c = canvas(box.w * scale, box.h * scale)
  const ctx = c.getContext('2d')!
  const k = orig.naturalWidth / STAGE_W // 원본 파일은 무대의 2배 크기
  ctx.drawImage(orig, box.x * k, box.y * k, box.w * k, box.h * k, 0, 0, c.width, c.height)
  ctx.globalCompositeOperation = 'destination-in'
  ctx.drawImage(mask, 0, 0, c.width, c.height)
  return c
}

export type Piece = Box & { url: string }

export type Scene = {
  /** 움직이지 않는 바탕. 배경 → 하늘 원경 → 원본 물결 → 포말(물줄기 줄기는 지운 상태) */
  base: HTMLCanvasElement
  /** 해: 원본 태양과 광선(스크린 합성, 밝기만 변한다) */
  sun: Piece
  /** 창 앞 고정 레이어: 구름 덩어리 둘레의 창틀·스카이라인·나뭇잎. 바탕과 같은 그림이고 구름 모양만 비어 있어서, 구름 덩어리가 움직여도 이 뒤로 가려진다 */
  frame: Piece
  /** 수면 반사광: 원본 반사에서 밝은 부분만(스크린 합성, 밝기만 변한다) */
  reflection: Piece
}

// 물줄기 줄기를 지우는 범위: 줄기 윤곽 + 테두리. 아래쪽은 서서히 원본을 남겨서 애니메이션 물줄기가 거품 뒤로 이어지게 한다.
const ERASE_PAD = 3.5
const ERASE_FULL_Y = STREAM_Y1 - 36
const ERASE_END_Y = STREAM_Y1 - 24

export async function buildScene(): Promise<Scene> {
  const [bg, orig, refl, mCloudA, mCloudB, mSky, mSun, mWater, mWaterDetail, mFountain] = await Promise.all([
    load(bgUrl),
    load(origUrl),
    load(reflectionUrl),
    load(maskCloudAUrl),
    load(maskCloudBUrl),
    load(maskSkyUrl),
    load(maskSunUrl),
    load(maskWaterUrl),
    load(maskWaterDetailUrl),
    load(maskFountainUrl),
  ])

  // ---- 바탕 ----
  const S = BASE_SCALE
  const base = canvas(STAGE_W * S, STAGE_H * S)
  const ctx = base.getContext('2d')!
  ctx.drawImage(bg, 0, 0, base.width, base.height)
  const put = (piece: HTMLCanvasElement, box: Box) => ctx.drawImage(piece, box.x * S, box.y * S, box.w * S, box.h * S)

  const sky: Box = { x: 488.8, y: 33.8, w: 916.4, h: 320.4 }
  put(cutOriginal(orig, mSky, sky, S), sky)
  const waterDetail: Box = { x: 369, y: 614.698, w: 1185, h: 427.302 }
  put(cutOriginal(orig, mWaterDetail, waterDetail, S), waterDetail)

  const fountain: Box = { x: 1271.4, y: 491.4, w: 265.2, h: 219.892 }
  const fpiece = cutOriginal(orig, mFountain, fountain, S)
  const fctx = fpiece.getContext('2d')!
  fctx.globalCompositeOperation = 'destination-out'
  fctx.setTransform(S, 0, 0, S, -fountain.x * S, -fountain.y * S)
  const grad = fctx.createLinearGradient(0, ERASE_FULL_Y, 0, ERASE_END_Y)
  grad.addColorStop(0, 'rgba(0,0,0,1)')
  grad.addColorStop(1, 'rgba(0,0,0,0)')
  fctx.fillStyle = grad
  fctx.beginPath()
  const top = STREAM_Y0 - 6
  fctx.moveTo(STREAM_LEFT[0] - ERASE_PAD - 4, top)
  for (let i = 0; i < STREAM_LEFT.length; i += 2) fctx.lineTo(STREAM_LEFT[i] - ERASE_PAD, STREAM_Y0 + i)
  fctx.lineTo(STREAM_LEFT[STREAM_LEFT.length - 1] - ERASE_PAD, ERASE_END_Y)
  fctx.lineTo(STREAM_RIGHT[STREAM_RIGHT.length - 1] + ERASE_PAD, ERASE_END_Y)
  for (let i = STREAM_RIGHT.length - 1; i >= 0; i -= 2) fctx.lineTo(STREAM_RIGHT[i] + ERASE_PAD, STREAM_Y0 + i)
  fctx.lineTo(STREAM_RIGHT[0] + ERASE_PAD + 4, top)
  fctx.closePath()
  fctx.fill()
  put(fpiece, fountain)

  // ---- 창 앞 고정 레이어 ----
  // 하늘 쪽(구름 마스크 A·B) 모양만 비운 바탕 조각. 구름 덩어리(CSS)는 이 조각 뒤에서 움직인다.
  const CA: Box = { x: 880.5, y: 98.5, w: 161, h: 184 }
  const CB: Box = { x: 1058.5, y: 70.5, w: 210, h: 225 }
  const frameBox: Box = { x: 872.5, y: 62.5, w: 404, h: 241 }
  const fr = canvas(frameBox.w * S, frameBox.h * S)
  const frctx = fr.getContext('2d')!
  frctx.drawImage(base, frameBox.x * S, frameBox.y * S, frameBox.w * S, frameBox.h * S, 0, 0, fr.width, fr.height)
  frctx.globalCompositeOperation = 'destination-out'
  frctx.drawImage(mCloudA, (CA.x - frameBox.x) * S, (CA.y - frameBox.y) * S, CA.w * S, CA.h * S)
  frctx.drawImage(mCloudB, (CB.x - frameBox.x) * S, (CB.y - frameBox.y) * S, CB.w * S, CB.h * S)
  const frame = { ...frameBox, url: await toUrl(fr) }

  // ---- 해 ----
  const sunBox: Box = { x: 1080, y: 190, w: 185, h: 195 }
  const sun = { ...sunBox, url: await toUrl(cutOriginal(orig, mSun, sunBox, S)) }

  // ---- 수면 반사광: 원본 반사 ∩ 수면 마스크 ∩ 반사 질감의 명도(mask-luminance) ----
  const waterBox: Box = { x: 245, y: 602, w: 1291, h: 422 }
  const lum = canvas(STAGE_W, STAGE_H)
  const lctx = lum.getContext('2d', { willReadFrequently: true })!
  lctx.drawImage(refl, 0, 0, STAGE_W, STAGE_H)
  const img = lctx.getImageData(0, 0, STAGE_W, STAGE_H)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    const l = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255
    d[i + 3] = Math.round(l * d[i + 3]) // 알파 = 명도 × 알파
    d[i] = d[i + 1] = d[i + 2] = 255
  }
  lctx.putImageData(img, 0, 0)
  const rpiece = cutOriginal(orig, mWater, waterBox, 1)
  const rctx = rpiece.getContext('2d')!
  rctx.globalCompositeOperation = 'destination-in'
  rctx.drawImage(lum, waterBox.x, waterBox.y, waterBox.w, waterBox.h, 0, 0, rpiece.width, rpiece.height)
  const reflection = { ...waterBox, url: await toUrl(rpiece) }

  return { base, sun, reflection, frame }
}
