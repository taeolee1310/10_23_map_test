import steamUrl from '../../assets/bathhouse/steam.webp'
import maskBack from '../../assets/bathhouse/steam-mask-back.svg'
import maskMid from '../../assets/bathhouse/steam-mask-mid.svg'
import maskFront from '../../assets/bathhouse/steam-mask-front.svg'
import maskEdge from '../../assets/bathhouse/steam-fade.svg'

// 수증기 층의 마스크 두 개(층 마스크 + '전경 타일 뒤로' 경계 마스크)를 미리 한 장에 구워 둔다.
// CSS 마스크 두 개를 겹친 큰 층 6장이 계속 움직이면 iPhone Safari가 매 프레임 화면 크기의 임시 그림을 만들어야 해서 탭이 죽는다.
// 구워 둔 그림은 마스크 없이 이동·투명도만 움직이므로 훨씬 가볍다. 모양은 CSS 마스크와 같다(마스크 알파를 곱한다).
// 좌표는 Figma 원본 1536×1024 기준이다. 경계 마스크는 1539×1027을 (−1.5, −1.5)에 놓는다.
export type SteamGroup = 'back' | 'mid' | 'front'

const load = (url: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`이미지를 불러오지 못했어요: ${url}`))
    img.src = url
  })

const toUrl = (c: HTMLCanvasElement) =>
  new Promise<string>((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(URL.createObjectURL(b)) : reject(new Error('이미지를 만들지 못했어요'))), 'image/png'),
  )

/** scale: 원본 대비 크기(0.75면 1152×768). 한 번에 한 층씩 만들어 메모리를 아낀다. */
export async function bakeSteam(scale = 0.75): Promise<Record<SteamGroup, string>> {
  const W = Math.round(1536 * scale)
  const H = Math.round(1024 * scale)
  const [steam, edge, ...masks] = await Promise.all([load(steamUrl), load(maskEdge), load(maskBack), load(maskMid), load(maskFront)])
  const out = {} as Record<SteamGroup, string>
  const groups: SteamGroup[] = ['back', 'mid', 'front']
  for (let i = 0; i < groups.length; i++) {
    const c = document.createElement('canvas')
    c.width = W
    c.height = H
    const ctx = c.getContext('2d')!
    ctx.drawImage(steam, 0, 0, W, H)
    ctx.globalCompositeOperation = 'destination-in' // 마스크의 알파가 있는 곳만 남긴다
    ctx.drawImage(masks[i], 0, 0, W, H)
    ctx.drawImage(edge, -1.5 * scale, -1.5 * scale, 1539 * scale, 1027 * scale)
    out[groups[i]] = await toUrl(c)
    c.width = c.height = 0 // 바로 비운다
  }
  return out
}
