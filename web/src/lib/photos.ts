// 매거진 사진 올리기(작성 화면 전용): 고른 사진을 브라우저에서 줄인 뒤 Worker(POST /api/editor/photos → R2)에 올린다.
// 서버(Worker)도 형식(JPEG·PNG·WebP)과 크기(5MB)를 다시 검사하므로 여기 검사는 빨리 알려 주려는 용도다.
import { API_BASE } from './api'

export const PHOTO_MAX_WIDTH = 1600
export const PHOTO_MAX_BYTES = 5 * 1024 * 1024 // Worker MAX_PHOTO와 같게
const JPEG_QUALITY = 0.85
const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp']
export const PHOTO_ACCEPT = ACCEPTED.join(',')

// 화면에 보여 줄 수 있는 실패. status는 서버가 준 번호(서버를 부르기 전에 막은 것은 0)
export class PhotoError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

const TYPE_TEXT = 'jpg·png·webp 사진만 올릴 수 있어요.'
const SIZE_TEXT = '5MB 넘는 사진이에요. 더 작은 사진으로 골라 주세요.'

// 파일을 가로 최대 1600px로 줄여 JPEG(품질 0.85)로 다시 인코딩한다.
// canvas에 그려서 새로 만든 JPEG에는 원본의 EXIF(위치 GPS·촬영 기기·촬영 시각 등)가 들어가지 않는다. 다시 인코딩하는 이 과정이 위치 정보를 지우는 방법이라, 이미 작은 사진도 건너뛰지 않고 항상 거친다.
// 사진 방향(EXIF orientation)은 브라우저가 그릴 때 이미 적용하므로 돌아가 보이지 않는다. 투명한 PNG는 흰 바탕에 그린다(JPEG는 투명을 못 담아 검게 나오므로).
export async function shrinkPhoto(file: File): Promise<Blob> {
  if (file.type && !ACCEPTED.includes(file.type)) throw new PhotoError(415, TYPE_TEXT)
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    try {
      await img.decode()
    } catch {
      throw new PhotoError(0, `사진을 열지 못했어요. ${TYPE_TEXT}`)
    }
    const scale = Math.min(1, PHOTO_MAX_WIDTH / img.naturalWidth)
    const w = Math.max(1, Math.round(img.naturalWidth * scale))
    const h = Math.max(1, Math.round(img.naturalHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new PhotoError(0, '이 브라우저에서는 사진을 줄일 수 없어요.')
    ctx.fillStyle = 'white' // 화면 색이 아니라 사진 픽셀에 들어가는 값이라 CSS 색 토큰을 쓰지 않는다
    ctx.fillRect(0, 0, w, h)
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, 0, 0, w, h)
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', JPEG_QUALITY))
    if (!blob) throw new PhotoError(0, '사진을 줄이지 못했어요. 다른 사진으로 해 주세요.')
    if (blob.size > PHOTO_MAX_BYTES) throw new PhotoError(413, SIZE_TEXT)
    return blob
  } finally {
    URL.revokeObjectURL(url)
  }
}

// 암호 틀림(401)·잠금(429)은 글 저장과 같은 횟수 제한이라 안내 문장을 작성 화면의 authText가 만든다. 그래서 서버가 준 값(left·retry)을 그대로 담아 던진다.
export type PhotoAuthFail = { left?: number; retry?: number }
export class PhotoAuthError extends PhotoError {
  constructor(status: number, public data: PhotoAuthFail) {
    super(status, '')
  }
}

// 줄인 사진을 올리고 사진 주소(url)를 받는다. 실패하면 PhotoError(화면에 보여 줄 문장 포함) 또는 PhotoAuthError를 던진다.
export async function uploadPhoto(token: string, photo: Blob): Promise<string> {
  const fd = new FormData()
  fd.append('file', photo, 'photo.jpg') // Content-Type은 브라우저가 경계선(boundary)과 함께 붙인다
  let r: Response
  try {
    r = await fetch(`${API_BASE}/api/editor/photos`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: fd,
      signal: AbortSignal.timeout(30000),
    })
  } catch {
    throw new PhotoError(0, '인터넷 연결을 확인하고 다시 눌러 주세요.')
  }
  const data = (await r.json().catch(() => ({}))) as { ok?: boolean; url?: string } & PhotoAuthFail
  if (r.ok && data.ok && data.url) return data.url
  if (r.status === 401 || r.status === 429) throw new PhotoAuthError(r.status, data)
  if (r.status === 413) throw new PhotoError(413, SIZE_TEXT)
  if (r.status === 415) throw new PhotoError(415, TYPE_TEXT)
  if (r.status === 503) throw new PhotoError(503, '사진 올리기가 아직 준비되지 않았어요(Worker에 사진 저장소가 연결되지 않음).')
  throw new PhotoError(r.status, '사진을 올리지 못했어요. 잠시 뒤 다시 해 주세요.')
}
