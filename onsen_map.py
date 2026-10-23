"""'한국의 온천을 찾아서' 지도 화면 HTML을 만든다. 지도는 카카오 JavaScript SDK(JS 키만 사용).

onsen_html(js_key, places) → HTML 글자 한 덩어리. Streamlit의 st.iframe에 그대로 넣는다.
places: [{id, name, addr, sido, lat, lng, tel, kind, url, checked, price}] (price 없으면 None)
"""
import json

# 🔌 지도 SDK 주소는 여기 한 곳에만
API = {
    "sdk": "https://dapi.kakao.com/v2/maps/sdk.js",
}

# 브랜드 값은 여기 한 곳에만
BRAND = {
    "name": "한국의 온천을 찾아서",
    "ivory": "#F7F4EE",
    "charcoal": "#292D2B",
    "forest": "#536C60",
    "sand": "#D9C5A5",
    "terracotta": "#BD8067",
}

PIN_PATH = "M16 1.8C9.6 1.8 4.8 6.5 4.8 12.6c0 7.6 11.2 18.4 11.2 18.4s11.2-10.8 11.2-18.4C27.2 6.5 22.4 1.8 16 1.8z"
STEAM_PATH = "M12.6 13.4c-1.6-1.5 1.5-2.8 0-4.7M17.4 13.4c-1.6-1.5 1.5-2.8 0-4.7"
WAVE_PATH = "M9.6 17c1.5-1.3 3-1.3 4.5 0s3 1.3 4.5 0 3-1.3 3.8 0M10.6 20.4c1.3-1.1 2.6-1.1 3.9 0s2.6 1.1 3.9 0"


def mark_svg(fill, glyph, size=32):
    """물결과 수증기가 든 핀 모양 심볼. 헤더·지도 핀·파비콘에 같은 모양을 쓴다."""
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 32 32" aria-hidden="true">'
        f'<path d="{PIN_PATH}" fill="{fill}"/>'
        f'<g fill="none" stroke="{glyph}" stroke-width="1.5" stroke-linecap="round">'
        f'<path d="{STEAM_PATH}"/><path d="{WAVE_PATH}"/></g></svg>'
    )


HTML = r"""<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>__NAME__</title>
<style>
@import url('https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.css');
:root {
  --ivory: __ivory__; --char: __charcoal__; --forest: __forest__; --sand: __sand__; --terra: __terracotta__;
  --forest-d: #3F5449; --terra-d: #8F5840; --water: #6B8F86; --water-d: #4B6F66; --glow: #F4DCC6;
  --line: #E6DDCB; --muted: #655F55; --card: #FFFDF9; --soft: #F0E8D8; --stone: #CFC3AE;
  --shadow: 0 8px 24px rgba(79,60,40,.10); --shadow-s: 0 2px 8px rgba(79,60,40,.08);
}
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; background: var(--ivory); color: var(--char);
  font-family: 'Pretendard', -apple-system, 'Malgun Gothic', sans-serif; font-size: 14px; line-height: 1.5; }
button { font: inherit; color: inherit; cursor: pointer; }
:focus-visible { outline: 2px solid var(--forest); outline-offset: 2px; }
[hidden] { display: none !important; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

#shell { display: flex; flex-direction: column; height: 100%; padding: 12px; gap: 14px;
  background: radial-gradient(900px 300px at 85% -10%, rgba(244,220,198,.7), transparent 70%), var(--ivory); }

/* 첫 영역: 따뜻한 물가 */
.hero { position: relative; flex: none; display: flex; align-items: stretch; border-radius: 28px; overflow: hidden;
  background: linear-gradient(115deg, #F0E2CB 0%, #F6EEDF 55%, #F7F4EE 100%); box-shadow: var(--shadow-s); }
.hero-copy { position: relative; z-index: 2; padding: 20px 24px 18px; flex: 1; min-width: 0; }
.eyebrow { margin: 0 0 4px; font-size: 11px; font-weight: 700; letter-spacing: .18em; color: var(--terra-d); }
.hero h1 { margin: 0; font-size: 26px; line-height: 1.25; letter-spacing: -.03em; font-weight: 800; }
.hero .sub { margin: 4px 0 14px; color: var(--muted); font-size: 13px; }
.search { display: flex; align-items: center; gap: 8px; background: var(--card); border: 1.5px solid transparent; border-radius: 16px;
  padding: 0 14px; height: 46px; max-width: 520px; box-shadow: var(--shadow-s); transition: border-color .2s, box-shadow .25s; }
.search:focus-within { border-color: var(--water); box-shadow: 0 0 0 5px rgba(107,143,134,.18), var(--shadow-s); }
.search input { flex: 1; border: 0; outline: 0; background: transparent; font: inherit; color: var(--char); min-width: 0; }
.search svg { flex: none; color: var(--water-d); }
.quick { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
.qp { position: relative; overflow: hidden; display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--line); background: rgba(255,253,249,.85);
  border-radius: 999px; padding: 6px 12px; font-size: 13px; font-weight: 600; transition: transform .2s, background .2s, border-color .2s; }
.qp:hover:not(:disabled) { transform: translateY(-2px); border-color: var(--water); background: #fff; }
.qp:disabled { opacity: .55; cursor: default; }
.qp svg { color: var(--terra-d); }
.qp b { background: var(--terra); color: #fff; border-radius: 999px; padding: 0 7px; font-size: 11px; }
.scene { position: relative; z-index: 1; flex: none; width: 340px; align-self: flex-end; margin-right: 8px; }
.scene .steam path { fill: none; stroke: #D9C8AB; stroke-width: 5; stroke-linecap: round; opacity: 0; animation: rise 5s ease-in-out infinite; }
.scene .steam .b path { animation-delay: 1.6s; } .scene .steam .c path { animation-delay: 3.1s; }
@keyframes rise { 0% { opacity: 0; transform: translateY(16px); } 35% { opacity: .9; } 100% { opacity: 0; transform: translateY(-16px); } }
.scene .drift { animation: drift 9s ease-in-out infinite alternate; }
@keyframes drift { to { transform: translateX(-60px); } }

/* 본문: 목록(넓게) + 지도(작게) */
#app { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr); gap: 16px; }
#panel { position: relative; display: flex; flex-direction: column; min-height: 0; background: var(--card); border: 1px solid var(--line);
  border-radius: 24px; box-shadow: var(--shadow-s); overflow: hidden; }
.filters { display: flex; flex-wrap: wrap; gap: 10px 12px; align-items: center; padding: 14px 16px 12px; border-bottom: 1px solid var(--line); }
.sel select { appearance: none; border: 1px solid var(--line); background: var(--ivory) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%23655F55' stroke-width='1.5'/%3E%3C/svg%3E") no-repeat right 12px center;
  border-radius: 999px; padding: 7px 32px 7px 14px; font: inherit; font-weight: 600; color: var(--char); }
.seg { display: inline-flex; background: var(--soft); border-radius: 999px; padding: 3px; }
.seg button { position: relative; overflow: hidden; border: 0; background: transparent; border-radius: 999px; padding: 5px 12px; font-size: 13px; transition: background .2s, color .2s; }
.seg button[aria-pressed="true"] { background: var(--forest); color: #fff; font-weight: 600; }
.sw { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; cursor: pointer; }
.sw input { position: absolute; opacity: 0; }
.sw i { width: 34px; height: 20px; border-radius: 999px; background: var(--stone); position: relative; transition: background .2s; }
.sw i::after { content: ""; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: #fff; transition: transform .2s; box-shadow: var(--shadow-s); }
.sw input:checked + i { background: var(--forest); } .sw input:checked + i::after { transform: translateX(14px); }
.sw input:focus-visible + i { outline: 2px solid var(--forest); outline-offset: 2px; }
.note { margin: 10px 16px 0; font-size: 13px; background: #F6EBDD; border-radius: 12px; padding: 10px 12px; }
.listhead { display: flex; justify-content: space-between; align-items: center; padding: 10px 18px 6px; font-size: 13px; color: var(--muted); }
.listhead b { color: var(--char); }
.listhead select { border: 0; background: transparent; font: inherit; color: var(--forest-d); font-weight: 600; cursor: pointer; }
#list { list-style: none; margin: 0; padding: 4px 12px 16px; overflow-y: auto; flex: 1; display: grid; gap: 8px; align-content: start; }
.item { position: relative; border-radius: 18px; border: 1px solid transparent; background: transparent; transition: background .2s, box-shadow .25s, transform .25s, border-color .2s; }
.item:hover, .item.hot { background: var(--ivory); box-shadow: var(--shadow-s); transform: translateY(-1px); }
.item.on { background: #FBF1E7; border-color: var(--terra); }
.item .open { position: relative; overflow: hidden; display: block; width: 100%; text-align: left; background: none; border: 0; padding: 12px 52px 12px 14px; border-radius: inherit; }
.item .nm { font-weight: 700; font-size: 15px; line-height: 1.3; }
.item .ad { color: var(--muted); font-size: 12.5px; margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.item .meta { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
.pill { display: inline-flex; align-items: center; gap: 5px; font-size: 11.5px; padding: 2px 9px; border-radius: 999px; background: var(--soft); white-space: nowrap; }
.pill.kind::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: var(--water); }
.pill.kind.k1::before { background: var(--terra); } .pill.kind.k2::before { background: var(--sand); box-shadow: inset 0 0 0 1px rgba(0,0,0,.15); }
.pill.price { background: #F6E8DF; color: var(--terra-d); font-weight: 600; }
.pill.price.unknown { background: var(--soft); color: var(--muted); font-weight: 400; }
.pill.dist { background: #E7EFEC; color: var(--water-d); }
.heart { position: absolute; top: 8px; right: 8px; width: 36px; height: 36px; border-radius: 50%; border: 0; background: transparent; display: grid; place-items: center; color: var(--muted); transition: transform .2s, background .2s, color .2s; }
.heart:hover { background: var(--soft); }
.heart[aria-pressed="true"] { color: var(--terra); } .heart[aria-pressed="true"] svg { fill: currentColor; animation: pop .35s; }
@keyframes pop { 40% { transform: scale(1.35); } }
.steamy { position: absolute; right: 16px; top: 44px; width: 22px; height: 26px; pointer-events: none; }
.steamy b { position: absolute; bottom: 0; width: 3px; height: 14px; border-radius: 3px; background: linear-gradient(#D9C8AB, transparent); opacity: 0; }
.steamy b:nth-child(1) { left: 3px; } .steamy b:nth-child(2) { left: 10px; } .steamy b:nth-child(3) { left: 17px; }
.item:hover .steamy b, .item.hot .steamy b { animation: wisp 2.2s ease-out infinite; }
.item:hover .steamy b:nth-child(2), .item.hot .steamy b:nth-child(2) { animation-delay: .5s; }
.item:hover .steamy b:nth-child(3), .item.hot .steamy b:nth-child(3) { animation-delay: 1s; }
@keyframes wisp { 0% { opacity: 0; transform: translateY(6px) scaleY(.6); } 40% { opacity: .9; } 100% { opacity: 0; transform: translateY(-10px) scaleY(1.1); } }
#list.anim .item { animation: in .4s cubic-bezier(.2,.8,.2,1) both; animation-delay: calc(min(var(--i), 10) * 28ms); }
@keyframes in { from { opacity: 0; transform: translateY(10px); } }
.more { margin: 6px auto 0; }
.empty { text-align: center; padding: 36px 16px; color: var(--muted); }
.empty b { display: block; color: var(--char); margin-bottom: 6px; }
.sk { height: 84px; border-radius: 18px; background: linear-gradient(90deg, #F0E8D8 25%, #F8F3E8 50%, #F0E8D8 75%); background-size: 200% 100%; animation: shimmer 1.4s linear infinite; }
@keyframes shimmer { to { background-position: -200% 0; } }
.btn { position: relative; overflow: hidden; border: 1px solid var(--forest); background: var(--forest); color: #fff; border-radius: 12px; padding: 8px 14px; font-weight: 600;
  transition: background .2s, transform .15s; text-decoration: none; display: inline-block; text-align: center; }
.btn:hover { background: var(--forest-d); } .btn:active { transform: scale(.97); }
.btn.ghost { background: transparent; color: var(--forest-d); } .btn.ghost:hover { background: var(--soft); }
.btn.sm { padding: 6px 12px; font-size: 13px; }
.rip { position: absolute; border-radius: 50%; background: rgba(107,143,134,.28); transform: scale(0); animation: ripple .65s ease-out forwards; pointer-events: none; }
.btn .rip { background: rgba(255,255,255,.35); }
@keyframes ripple { to { transform: scale(1); opacity: 0; } }

/* 상세 */
#detail { position: absolute; inset: 0; background: var(--card); overflow-y: auto; transform: translateX(102%); opacity: 0; visibility: hidden; z-index: 5; padding: 16px 18px 24px;
  transition: transform .3s cubic-bezier(.2,.8,.2,1), opacity .2s; }
#detail.open { transform: none; opacity: 1; visibility: visible; }
#detail h2 { margin: 8px 0 2px; font-size: 22px; line-height: 1.25; letter-spacing: -.02em; }
.back { display: inline-flex; align-items: center; gap: 4px; background: none; border: 0; padding: 4px 0; color: var(--forest-d); font-weight: 600; }
.sec { margin-top: 14px; background: var(--ivory); border: 1px solid var(--line); border-radius: 18px; padding: 14px 16px; }
.sec h3 { margin: 0 0 8px; font-size: 13px; color: var(--muted); font-weight: 600; }
.sec a { color: var(--forest-d); font-weight: 600; }
.pr { display: flex; justify-content: space-between; gap: 12px; padding: 4px 0; }
.pr b { font-weight: 700; white-space: nowrap; }
.total { margin-top: 8px; padding-top: 10px; border-top: 1px dashed var(--stone); font-weight: 700; color: var(--forest-d); }
.unknown-box b { font-size: 16px; }
.small { font-size: 12.5px; color: var(--muted); margin: 6px 0 0; }
.actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }

/* 오른쪽: 작은 지도 + 미리보기 */
#side { min-height: 0; display: flex; flex-direction: column; gap: 12px; }
.mapcard { position: relative; flex: 1 1 58%; min-height: 240px; border-radius: 24px; overflow: hidden; box-shadow: var(--shadow); border: 1px solid var(--line); background: #E9E2D3; }
#map { position: absolute; inset: 0; }
.mapcard::after { content: ""; position: absolute; inset: 0; z-index: 2; pointer-events: none; background: rgba(217,190,150,.12); backdrop-filter: saturate(.7) sepia(.18); }
.mapsk { position: absolute; inset: 0; z-index: 3; display: grid; place-items: center; color: var(--muted); background: linear-gradient(90deg, #E9E2D3 25%, #F3EDE0 50%, #E9E2D3 75%); background-size: 200% 100%; animation: shimmer 1.6s linear infinite; }
.mapsk.err { animation: none; padding: 24px; text-align: center; }
.maptools { position: absolute; z-index: 4; top: 12px; left: 12px; right: 12px; display: flex; justify-content: space-between; pointer-events: none; }
.maptools > * { pointer-events: auto; }
.tg { border: 0; background: rgba(255,253,249,.94); border-radius: 999px; padding: 7px 14px; font-size: 12.5px; font-weight: 600; box-shadow: var(--shadow-s); }
.tg[aria-pressed="true"] { background: var(--forest); color: #fff; }
.fab { width: 38px; height: 38px; border-radius: 50%; border: 0; background: rgba(255,253,249,.94); box-shadow: var(--shadow-s); display: grid; place-items: center; color: var(--water-d); transition: transform .2s; }
.fab:hover { transform: scale(1.08); }
.graytip { flex: none; font-size: 11.5px; color: var(--muted); padding: 0 6px; margin-top: -4px; }
.preview { flex: 1 1 42%; min-height: 150px; background: var(--card); border: 1px solid var(--line); border-radius: 24px; padding: 16px 18px; box-shadow: var(--shadow-s); overflow: auto; }
.preview.swap { animation: in .35s cubic-bezier(.2,.8,.2,1); }
.preview .nm { font-weight: 800; font-size: 17px; letter-spacing: -.02em; line-height: 1.3; padding-right: 8px; }
.preview .ad { color: var(--muted); font-size: 12.5px; margin-top: 2px; }
.preview .row { display: flex; gap: 6px; flex-wrap: wrap; margin: 10px 0 12px; }
.preview .hint { display: flex; align-items: center; gap: 14px; color: var(--muted); height: 100%; }
.preview .hint svg { flex: none; }
.preview .hint b { display: block; color: var(--char); font-size: 15px; }
.preview .top { display: flex; align-items: flex-start; justify-content: space-between; }

.pin { position: relative; background: none; border: 0; padding: 0; width: 30px; height: 30px; transform-origin: 50% 100%; transition: transform .2s cubic-bezier(.3,1.6,.5,1);
  filter: drop-shadow(0 2px 3px rgba(79,60,40,.4)); animation: drop .45s cubic-bezier(.3,1.6,.5,1) both; }
@keyframes drop { from { opacity: 0; transform: translateY(-14px) scale(.7); } }
.pin:hover, .pin.hot { transform: scale(1.25); z-index: 2; }
.pin.sel { transform: scale(1.4); }
.pin svg { display: block; }
.pin .spl { position: absolute; left: 50%; top: -18px; width: 20px; margin-left: -10px; height: 20px; pointer-events: none; }
.pin .spl b { position: absolute; bottom: 0; width: 3px; height: 12px; border-radius: 3px; background: linear-gradient(#fff, rgba(255,255,255,0)); box-shadow: 0 0 0 .5px rgba(143,88,64,.25); opacity: 0; animation: wisp 2s ease-out infinite; }
.pin .spl b:nth-child(1) { left: 3px; } .pin .spl b:nth-child(2) { left: 9px; animation-delay: .6s; } .pin .spl b:nth-child(3) { left: 15px; animation-delay: 1.2s; }
.bubble { min-width: 48px; padding: 8px 12px; border-radius: 58% 42% 55% 45% / 52% 56% 44% 48%; color: #fff; border: 2px solid rgba(255,253,249,.9); text-align: center; line-height: 1.15; font-weight: 700;
  background: radial-gradient(circle at 30% 25%, #7C9A8D, #4B6358 70%); box-shadow: 0 6px 14px rgba(60,50,35,.28); transition: transform .25s cubic-bezier(.3,1.6,.5,1); animation: drop .5s both; }
.bubble:hover { transform: scale(1.12) rotate(-3deg); }
.bubble small { display: block; font-weight: 500; opacity: .92; font-size: 11px; }
.me { width: 16px; height: 16px; border-radius: 50%; background: var(--terra); border: 3px solid #fff; box-shadow: 0 0 0 6px rgba(189,128,103,.25); animation: ping 2.4s ease-out infinite; }
@keyframes ping { 70% { box-shadow: 0 0 0 14px rgba(189,128,103,0); } 100% { box-shadow: 0 0 0 0 rgba(189,128,103,0); } }
#toast { position: absolute; z-index: 6; left: 50%; bottom: 14px; transform: translateX(-50%); background: var(--char); color: #fff; border-radius: 12px; padding: 8px 14px; font-size: 13px; }

/* 모바일: 위에서 아래로 쌓기 */
@media (max-width: 820px) {
  #shell { overflow-y: auto; padding: 8px; gap: 10px; }
  .hero { flex-direction: column; border-radius: 22px; }
  .hero-copy { padding: 16px 16px 14px; } .hero h1 { font-size: 21px; } .scene { display: none; }
  #app { display: flex; flex-direction: column; flex: none; gap: 12px; }
  #side { order: 1; flex: none; } .mapcard { flex: none; height: 250px; min-height: 0; } .preview { flex: none; min-height: 0; }
  #panel { order: 2; flex: none; overflow: visible; } #list { overflow: visible; }
  #detail { position: fixed; z-index: 50; border-radius: 0; }
  .filters { padding: 12px; }
}
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; } }
</style>
</head>
<body>
<div id="shell">
  <header class="hero">
    <div class="hero-copy">
      <p class="eyebrow">KOREA ONSEN</p>
      <h1>오늘, 어디서 몸을 담글까요?</h1>
      <p class="sub">요금은 확인된 것만, 거리는 직선으로, 길은 카카오맵으로.</p>
      <label class="search">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        <span class="sr">온천 검색</span>
        <input id="q" type="search" placeholder="온천 이름이나 지역으로 찾기" autocomplete="off">
      </label>
      <div class="quick" id="quick"></div>
    </div>
    <svg class="scene" viewBox="0 0 380 176" aria-hidden="true">
      <defs><linearGradient id="wg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7FA196"/><stop offset="1" stop-color="#4B6F66"/></linearGradient></defs>
      <circle cx="262" cy="74" r="72" fill="#F4DCC6" opacity=".6"/>
      <g class="steam"><g class="a"><path d="M150 100c-14-14 14-26 0-44s14-26 0-40"/></g><g class="b"><path d="M196 100c-14-14 14-26 0-44s14-26 0-40"/></g><g class="c"><path d="M242 100c-14-14 14-26 0-44s14-26 0-40"/></g></g>
      <g class="drift"><path d="M-60 116c30-14 60-14 90 0s60 14 90 0 60-14 90 0 60 14 90 0 60-14 90 0 60 14 90 0 60-14 90 0V176H-60z" fill="#8FB0A5" opacity=".55"/></g>
      <path d="M0 126c30-12 60-12 90 0s60 12 90 0 60-12 90 0 60 12 90 0 20-4 20-4V176H0z" fill="url(#wg)"/>
      <ellipse cx="58" cy="140" rx="36" ry="21" fill="#CFC3AE"/><ellipse cx="50" cy="133" rx="14" ry="6" fill="#E3D9C6"/>
      <ellipse cx="112" cy="153" rx="26" ry="15" fill="#B9AB92"/><ellipse cx="324" cy="146" rx="32" ry="18" fill="#8C8577"/><ellipse cx="316" cy="139" rx="12" ry="5" fill="#A8A092"/>
    </svg>
  </header>
  <div id="app">
    <section id="panel" aria-label="온천 목록">
      <div class="filters">
        <label class="sel"><span class="sr">지역</span><select id="region"></select></label>
        <div class="seg" id="kindSeg" role="group" aria-label="시설 유형"></div>
        <label class="sw"><input type="checkbox" id="priceOnly"><i></i><span>가격 확인된 곳만</span></label>
      </div>
      <div class="note" id="locNote" hidden></div>
      <div class="listhead"><span><b id="count" aria-live="polite"></b></span>
        <select id="sort" aria-label="정렬"><option value="auto">추천순</option><option value="dist">가까운 순</option><option value="name">이름순</option></select>
      </div>
      <ol id="list"><li class="sk"></li><li class="sk"></li><li class="sk"></li><li class="sk"></li></ol>
      <article id="detail" aria-hidden="true" aria-label="온천 상세"></article>
    </section>
    <aside id="side">
      <div class="mapcard">
        <div id="map" role="application" aria-label="온천 지도"></div>
        <div class="mapsk" id="mapsk">지도를 불러오는 중이에요</div>
        <div class="maptools">
          <button class="tg" id="inView" aria-pressed="false">지도 범위로 보기</button>
          <button class="fab" id="locFab" aria-label="내 위치로 이동"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg></button>
        </div>
        <div id="toast" role="status" hidden></div>
      </div>
      <div class="graytip">지도가 회색이면 확인할 것 3가지: ① 카카오맵 사용 설정 ② 지금 주소(포트까지) 등록 ③ 서버 주소로 열기</div>
      <div class="preview" id="preview"></div>
    </aside>
  </div>
</div>
<script>
(function () {
  const DATA = __DATA__;
  const KEY = __KEY__;
  const SDK = "__SDK__";
  const MARK = '__MARK_SVG__';
  const MARK_SEL = '__MARK_SVG_SEL__';
  const KINDS = [["", "전체"], ["온천", "온천"], ["온천 목욕탕·사우나", "목욕탕·사우나"], ["온천 숙박", "숙박"]];
  const KIND_CLASS = { "온천": "k0", "온천 숙박": "k1", "온천 목욕탕·사우나": "k2" };
  const MAX_PINS = 120;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  // API로 받은 주소·전화는 형식을 확인한 것만 링크로 쓴다 (javascript: 같은 주소 차단)
  const safeUrl = (u) => (/^https?:\/\/(place\.)?map\.kakao\.com\//.test(u || "") ? u : "");
  const safeTel = (t) => (/^[0-9+\-() ]{5,20}$/.test(t || "") ? t : "");
  const won = (n) => Number(n).toLocaleString("ko-KR") + "원";
  const ICON = {
    pin: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
    drop: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/></svg>',
    leaf: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M5 19c0-9 5-14 15-14 0 10-5 15-14 15"/><path d="M5 19c3-4 6-6 9-8"/></svg>',
    heart: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" aria-hidden="true"><path d="M12 20s-7-4.6-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.4-7 10-7 10z"/></svg>',
    heartBig: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M12 20s-7-4.6-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.4-7 10-7 10z"/></svg>',
  };
  const mq = matchMedia("(max-width: 820px)");
  const st = { q: "", sido: "전체", kind: "", priceOnly: false, favOnly: false, inView: false, sort: "auto", me: null, sel: null, shown: 60, anim: false };
  let map = null, overlays = [], pinEls = {}, meOverlay = null, toastTimer = null;

  /* ---------- 담아두기 (브라우저에만 저장, 막히면 이번 방문 동안만) ---------- */
  let favs = new Set();
  try { favs = new Set(JSON.parse(localStorage.getItem("onsen_fav") || "[]")); } catch (e) { /* 저장소가 막힌 환경 */ }
  function saveFavs() { try { localStorage.setItem("onsen_fav", JSON.stringify([...favs])); } catch (e) { /* 무시 */ } }
  function toggleFav(id) { favs.has(id) ? favs.delete(id) : favs.add(id); saveFavs(); renderQuick(); renderList(); if (st.sel) showPreview(st.sel, false); }

  /* ---------- 계산 ---------- */
  function km(a, b, c, d) {
    const r = (x) => (x * Math.PI) / 180, dl = r(c - a), dn = r(d - b);
    const h = Math.sin(dl / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(dn / 2) ** 2;
    return 12742 * Math.asin(Math.sqrt(h));
  }
  const fmtDist = (d) => (d < 1 ? Math.round(d * 1000) + "m" : d.toFixed(d < 10 ? 1 : 0) + "km");
  function setDist() { DATA.forEach((d) => { d.dist = st.me ? km(st.me.lat, st.me.lng, d.lat, d.lng) : null; }); }
  function filtered() {
    const q = st.q.trim().toLowerCase();
    return DATA.filter((d) =>
      (st.sido === "전체" || d.sido === st.sido) && (!st.kind || d.kind === st.kind) && (!st.priceOnly || d.price) &&
      (!st.favOnly || favs.has(d.id)) && (!q || (d.name + " " + d.addr).toLowerCase().includes(q)));
  }
  function inBounds(list) {
    if (!st.inView || !map) return list;
    const b = map.getBounds();
    return list.filter((d) => b.contain(new kakao.maps.LatLng(d.lat, d.lng)));
  }
  function sorted(list) {
    const a = list.slice(), by = st.sort === "auto" ? (st.me ? "dist" : "name") : st.sort;
    if (by === "dist" && st.me) a.sort((x, y) => x.dist - y.dist);
    else a.sort((x, y) => x.sido.localeCompare(y.sido, "ko") || x.name.localeCompare(y.name, "ko"));
    return a;
  }
  const priceLabel = (d) => (d.price && d.price.adult != null ? "성인 " + won(d.price.adult) : (d.price ? "가격 일부 확인" : "가격 확인 필요"));
  const mapLinks = (d) => {
    const to = encodeURIComponent(d.name) + "," + d.lat + "," + d.lng;
    if (!st.me) return { car: "https://map.kakao.com/link/to/" + to, pt: "https://map.kakao.com/link/to/" + to };
    const from = encodeURIComponent("내 위치") + "," + st.me.lat + "," + st.me.lng;
    return { car: "https://map.kakao.com/link/by/car/" + from + "/" + to, pt: "https://map.kakao.com/link/by/publictransit/" + from + "/" + to };
  };
  const counts = () => { const c = {}; DATA.forEach((d) => { c[d.sido] = (c[d.sido] || 0) + 1; }); return c; };

  /* ---------- 필터·빠른 선택 ---------- */
  function renderFilters() {
    const c = counts(), regions = Object.keys(c).sort((a, b) => c[b] - c[a]);
    $("#region").innerHTML = `<option value="전체">전국 ${DATA.length}곳</option>` + regions.map((r) => `<option value="${esc(r)}">${esc(r)} ${c[r]}곳</option>`).join("");
    $("#region").value = st.sido;
    $("#kindSeg").innerHTML = KINDS.map(([v, l]) => `<button data-kind="${esc(v)}" aria-pressed="${st.kind === v}">${esc(l)}</button>`).join("");
  }
  function renderQuick() {
    const priced = DATA.filter((d) => d.price).length;
    $("#quick").innerHTML =
      `<button class="qp" data-go="near">${ICON.pin}내 주변 온천</button>` +
      `<button class="qp" data-go="priced" ${priced ? "" : "disabled"} title="${priced ? "" : "확인되는 대로 채워요"}">${ICON.drop}요금 확인된 곳${priced ? " <b>" + priced + "</b>" : ""}</button>` +
      `<button class="qp" data-go="rare">${ICON.leaf}아직 몰랐던 지역</button>` +
      `<button class="qp" data-go="fav" ${favs.size ? "" : "disabled"}>${ICON.heart}담아둔 곳${favs.size ? " <b>" + favs.size + "</b>" : ""}</button>`;
  }

  /* ---------- 목록 ---------- */
  function renderList() {
    const all = filtered(), list = sorted(inBounds(all)), el = $("#list");
    $("#count").textContent = (st.inView && map ? "지도 안 " + list.length + "곳" : list.length + "곳");
    el.classList.toggle("anim", st.anim); st.anim = false;
    if (!list.length) {
      el.innerHTML = `<li class="empty"><b>조건에 맞는 온천이 없어요</b>${all.length ? "지도를 움직이거나 '지도 범위로 보기'를 꺼 보세요." : "필터를 바꿔 보세요."}<br><button class="btn ghost sm" id="reset" style="margin-top:12px">필터 초기화</button></li>`;
      return;
    }
    el.innerHTML = list.slice(0, st.shown).map((d, i) =>
      `<li class="item${st.sel && st.sel.id === d.id ? " on" : ""}" data-id="${esc(d.id)}" style="--i:${i}">
        <button class="open"><div class="nm">${esc(d.name)}</div><div class="ad">${esc(d.addr)}</div>
          <div class="meta"><span class="pill kind ${KIND_CLASS[d.kind] || ""}">${esc(d.kind)}</span>
            <span class="pill price${d.price ? "" : " unknown"}">${esc(priceLabel(d))}</span>
            ${d.dist != null ? `<span class="pill dist">직선 ${fmtDist(d.dist)}</span>` : ""}</div></button>
        <button class="heart" data-fav="${esc(d.id)}" aria-pressed="${favs.has(d.id)}" aria-label="${esc(d.name)} 담아두기">${ICON.heartBig}</button>
        <i class="steamy" aria-hidden="true"><b></b><b></b><b></b></i></li>`).join("") +
      (list.length > st.shown ? `<li><button class="btn ghost more" id="more">더 보기 (${list.length - st.shown}곳)</button></li>` : "");
    const on = el.querySelector(".item.on");
    if (on && st.scrollTo) { on.scrollIntoView({ block: "nearest", behavior: "smooth" }); st.scrollTo = false; }
  }

  /* ---------- 지도 ---------- */
  function clearOverlays() { overlays.forEach((o) => o.setMap(null)); overlays = []; pinEls = {}; }
  function renderMap() {
    if (!map) return;
    clearOverlays();
    const list = inBounds(filtered());
    if (list.length > MAX_PINS) {
      const g = {};
      list.forEach((d) => { (g[d.sido] = g[d.sido] || []).push(d); });
      Object.keys(g).forEach((s) => {
        const items = g[s], lat = items.reduce((a, d) => a + d.lat, 0) / items.length, lng = items.reduce((a, d) => a + d.lng, 0) / items.length;
        const el = document.createElement("button");
        el.className = "bubble"; el.setAttribute("aria-label", s + " 온천 " + items.length + "곳, 눌러서 확대");
        el.innerHTML = `${items.length}<small>${esc(s)}</small>`;
        el.addEventListener("click", () => { st.sido = s; $("#region").value = s; refresh(true); });
        overlays.push(new kakao.maps.CustomOverlay({ map, position: new kakao.maps.LatLng(lat, lng), content: el, yAnchor: 0.5, zIndex: 2 }));
      });
      return;
    }
    list.forEach((d) => {
      const sel = st.sel && st.sel.id === d.id;
      const el = document.createElement("button");
      el.className = "pin" + (sel ? " sel" : ""); el.setAttribute("aria-label", d.name);
      el.innerHTML = (sel ? MARK_SEL + '<i class="spl"><b></b><b></b><b></b></i>' : MARK);
      el.addEventListener("click", () => select(d.id, "map"));
      el.addEventListener("mouseenter", () => hotItem(d.id, true));
      el.addEventListener("mouseleave", () => hotItem(d.id, false));
      pinEls[d.id] = el;
      overlays.push(new kakao.maps.CustomOverlay({ map, position: new kakao.maps.LatLng(d.lat, d.lng), content: el, yAnchor: 1, zIndex: sel ? 10 : 3 }));
    });
  }
  function hotItem(id, on) { const li = $("#list").querySelector(`.item[data-id="${CSS.escape(id)}"]`); if (li) li.classList.toggle("hot", on); }
  function hotPin(id, on) { const p = pinEls[id]; if (p) p.classList.toggle("hot", on); }
  function fit(list) {
    if (!map || !list.length) return;
    if (list.length === 1) { map.setLevel(4); map.setCenter(new kakao.maps.LatLng(list[0].lat, list[0].lng)); return; }
    const b = new kakao.maps.LatLngBounds();
    list.forEach((d) => b.extend(new kakao.maps.LatLng(d.lat, d.lng)));
    map.setBounds(b, 40, 40, 40, 40);
  }
  function refresh(fitMap) {
    renderFilters(); st.shown = 60; st.anim = true;
    if (fitMap && map) fit(filtered());
    renderMap(); renderList();
  }

  /* ---------- 선택·미리보기·상세 ---------- */
  function select(id, from) {
    const d = DATA.find((x) => x.id === id); if (!d) return;
    st.sel = d; st.scrollTo = from === "map";
    if (map.getLevel() > 6) map.setLevel(5);
    map.panTo(new kakao.maps.LatLng(d.lat, d.lng));
    showPreview(d, true); renderMap(); renderList();
  }
  function showPreview(d, swap) {
    const p = $("#preview"), near = d.parking && d.parking.length ? d.parking[0] : null;
    p.innerHTML = `<div class="top"><div><div class="nm">${esc(d.name)}</div><div class="ad">${esc(d.addr)}</div></div>
        <button class="heart" style="position:static" data-fav="${esc(d.id)}" aria-pressed="${favs.has(d.id)}" aria-label="담아두기">${ICON.heartBig}</button></div>
      <div class="row"><span class="pill kind ${KIND_CLASS[d.kind] || ""}">${esc(d.kind)}</span><span class="pill price${d.price ? "" : " unknown"}">${esc(priceLabel(d))}</span>
        ${d.dist != null ? `<span class="pill dist">직선 ${fmtDist(d.dist)}</span>` : ""}${near ? `<span class="pill">주차장 ${near.dist}m</span>` : ""}</div>
      <div class="actions" style="margin:0"><button class="btn sm" id="sd">자세히 보기</button><a class="btn ghost sm" target="_blank" rel="noopener" href="${mapLinks(d).car}">길찾기</a></div>`;
    if (swap) { p.classList.remove("swap"); void p.offsetWidth; p.classList.add("swap"); }
  }
  function hintPreview() {
    const priced = DATA.filter((d) => d.price).length;
    $("#preview").innerHTML = `<div class="hint"><svg width="54" height="54" viewBox="0 0 32 32" aria-hidden="true"><path d="M16 1.8C9.6 1.8 4.8 6.5 4.8 12.6c0 7.6 11.2 18.4 11.2 18.4s11.2-10.8 11.2-18.4C27.2 6.5 22.4 1.8 16 1.8z" fill="#E4ECE7"/><g fill="none" stroke="#6B8F86" stroke-width="1.5" stroke-linecap="round"><path d="M12.6 13.4c-1.6-1.5 1.5-2.8 0-4.7M17.4 13.4c-1.6-1.5 1.5-2.8 0-4.7"/><path d="M9.6 17c1.5-1.3 3-1.3 4.5 0s3 1.3 4.5 0 3-1.3 3.8 0M10.6 20.4c1.3-1.1 2.6-1.1 3.9 0s2.6 1.1 3.9 0"/></g></svg>
      <div><b>핀이나 목록의 온천을 눌러 보세요</b>전국 ${DATA.length}곳 · 요금이 확인된 곳 ${priced}곳<br>가격과 이동 시간은 확인된 것만 보여 드려요.</div></div>`;
  }
  function priceBlock(d) {
    const p = d.price;
    if (!p) return `<section class="sec unknown-box"><h3>이용 요금</h3><b>가격 확인 필요</b>
      <p class="small">이 온천의 입장료는 아직 확인된 자료가 없어요. 방문 전에 카카오맵 장소 페이지나 공식 채널에서 꼭 확인해 주세요.</p></section>`;
    const row = (k, v) => `<div class="pr"><span>${k}</span><b>${v}</b></div>`;
    let h = "";
    if (p.adult != null) h += row("성인 1인 (평일)", won(p.adult));
    if (p.weekend != null) h += row("성인 1인 (주말)", won(p.weekend));
    if (p.towel != null) h += row("수건", p.towel === 0 ? "무료" : "별도 " + won(p.towel));
    if (p.parking != null) h += row("주차", p.parking === 0 ? "무료" : won(p.parking));
    if (p.child != null) h += row("어린이", won(p.child));
    if (p.adult != null && p.towel != null) h += `<div class="total">예상 지출 (평일 성인 1인, 수건 포함) ${won(p.adult + p.towel)}</div>`;
    else if (p.adult != null) h += `<p class="small">수건·대여용품 등 별도 비용은 확인되지 않았어요.</p>`;
    if (p.none) h += `<p class="small">추가 요금 없음 (확인됨)</p>`;
    if (p.memo) h += `<p class="small">${esc(p.memo)}</p>`;
    h += `<p class="small">확인일 ${esc(p.checked || "미상")} · 출처 ${/^https?:\/\//.test(p.source || "") ? `<a href="${esc(p.source)}" target="_blank" rel="noopener">보기</a>` : "미상"}</p>`;
    return `<section class="sec"><h3>이용 요금</h3>${h}</section>`;
  }
  function parkingBlock(d) {
    const r = d.parking_radius;
    let body;
    if (d.parking == null) body = `<p class="small" style="margin:0">아직 조회하지 않았어요.</p>`;
    else if (!d.parking.length) body = `<p class="small" style="margin:0">반경 ${r}m 안에 카카오에 등록된 주차장이 없어요. 방문 전에 주차 가능 여부를 확인해 주세요.</p>`;
    else body = d.parking.map((p) => {
      const u = safeUrl(p.url);
      return `<div class="pr"><span>${u ? `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(p.name)}</a>` : esc(p.name)}<br><span class="small">${esc(p.kind)} · ${esc(p.addr)}</span></span><b>${p.dist}m</b></div>`;
    }).join("") + `<p class="small">주차 요금은 카카오 데이터에 없어서 확인되지 않았어요. 장소 페이지에서 확인해 주세요.</p>`;
    return `<section class="sec"><h3>근처 주차장${r ? " (반경 " + r + "m)" : ""}</h3>${body}
      <p class="small">온천 시설 자체의 주차 정책이 아니라, 근처에 등록된 주차장이에요.</p></section>`;
  }
  function openDetail(d) {
    const l = mapLinks(d), el = $("#detail");
    el.innerHTML = `<button class="back" id="dback">← 목록으로</button>
      <div class="pill kind ${KIND_CLASS[d.kind] || ""}">${esc(d.sido)} · ${esc(d.kind)}</div><h2>${esc(d.name)}</h2><div class="small" style="margin:0">${esc(d.addr)}</div>
      ${priceBlock(d)}
      ${parkingBlock(d)}
      <section class="sec"><h3>내 위치에서</h3>
        ${d.dist != null ? `<div class="pr"><span>직선거리</span><b>${fmtDist(d.dist)}</b></div><p class="small">지도 위의 직선거리예요. 실제 도로 거리와 이동 시간은 아래 길찾기에서 확인해 주세요.</p>`
          : `<p class="small" style="margin:0 0 8px">현재 위치를 허용하면 직선거리를 보여 드려요.</p><button class="btn ghost sm" id="dloc">내 위치로 거리 보기</button>`}
        <div class="actions"><a class="btn sm" target="_blank" rel="noopener" href="${l.car}">자동차 길찾기</a><a class="btn ghost sm" target="_blank" rel="noopener" href="${l.pt}">대중교통 길찾기</a></div></section>
      <section class="sec"><h3>아직 확인되지 않은 정보</h3>
        <p class="small" style="margin:0">운영시간·휴무일, 노천탕, 가족탕·개인탕, 주차·편의시설은 확인된 자료가 없어서 비워 두었어요. 카카오맵 장소 페이지에서 확인할 수 있어요.</p>
        <div class="actions">${safeUrl(d.url) ? `<a class="btn ghost sm" target="_blank" rel="noopener" href="${esc(safeUrl(d.url))}">카카오맵 장소 페이지</a>` : ""}${safeTel(d.tel) ? `<a class="btn ghost sm" href="tel:${esc(safeTel(d.tel))}">${esc(safeTel(d.tel))}</a>` : ""}</div></section>
      <p class="small">출처: 카카오 로컬 API (장소 검색) · 조회 기준일 ${esc(d.checked_at)}</p>`;
    el.classList.add("open"); el.setAttribute("aria-hidden", "false"); el.scrollTop = 0;
    $("#dback").focus({ preventScroll: true });  // 화면 밖에서 슬라이드해 들어오는 중이라 스크롤이 튀지 않게
  }
  function closeDetail() { const el = $("#detail"); el.classList.remove("open"); el.setAttribute("aria-hidden", "true"); }

  /* ---------- 위치 ---------- */
  function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3500); }
  function note(msg) { const n = $("#locNote"); n.textContent = msg; n.hidden = !msg; }
  function locate(after) {
    if (!navigator.geolocation) { note("이 브라우저에서는 위치를 쓸 수 없어요. 지역을 고르거나 검색으로 온천을 찾아 보세요."); return; }
    note("가까운 온천까지 직선거리를 보여 드리려고 지금 위치를 한 번만 사용해요. 저장하거나 서버로 보내지 않아요.");
    navigator.geolocation.getCurrentPosition((pos) => {
      st.me = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      if (st.me.lat < 33 || st.me.lat > 39 || st.me.lng < 124 || st.me.lng > 132) { note("한국 밖에 계신 것 같아요. 지역을 고르거나 검색으로 온천을 찾아 보세요."); st.me = null; setDist(); return; }
      setDist(); note("");
      if (meOverlay) meOverlay.setMap(null);
      const dot = document.createElement("div"); dot.className = "me";
      meOverlay = new kakao.maps.CustomOverlay({ map, position: new kakao.maps.LatLng(st.me.lat, st.me.lng), content: dot, zIndex: 1 });
      if (after) after();
      renderList();
    }, (err) => {
      note(err.code === 1 ? "위치 권한이 꺼져 있어요. 괜찮아요, 지역을 고르거나 검색으로 온천을 찾을 수 있어요." : "지금은 위치를 가져오지 못했어요. 지역을 고르거나 검색으로 찾아 보세요.");
    }, { timeout: 10000, maximumAge: 60000 });
  }
  function goNear() {
    locate(() => {
      st.sort = "dist"; $("#sort").value = "dist"; st.inView = false; $("#inView").setAttribute("aria-pressed", "false"); st.sido = "전체"; st.favOnly = false;
      const near = sorted(filtered()).slice(0, 8);
      near.push({ lat: st.me.lat, lng: st.me.lng });
      refresh(false); fit(near);
    });
  }

  /* ---------- 물결 효과 (눌렀을 때 퍼지는 파동) ---------- */
  document.addEventListener("pointerdown", (e) => {
    const t = e.target.closest(".open, .qp, .seg button, .btn");
    if (!t || t.disabled) return;
    const r = t.getBoundingClientRect(), s = Math.max(r.width, r.height) * 2, span = document.createElement("span");
    span.className = "rip";
    span.style.cssText = `width:${s}px;height:${s}px;left:${e.clientX - r.left - s / 2}px;top:${e.clientY - r.top - s / 2}px`;
    t.appendChild(span); setTimeout(() => span.remove(), 700);
  });

  /* ---------- 이벤트 ---------- */
  let qTimer = null;
  $("#q").addEventListener("input", (e) => { clearTimeout(qTimer); qTimer = setTimeout(() => { st.q = e.target.value; refresh(true); }, 250); });
  $("#region").addEventListener("change", (e) => { st.sido = e.target.value; refresh(true); });
  $("#kindSeg").addEventListener("click", (e) => { const b = e.target.closest("[data-kind]"); if (!b) return; st.kind = b.dataset.kind; refresh(true); });
  $("#priceOnly").addEventListener("change", (e) => { st.priceOnly = e.target.checked; refresh(true); });
  $("#inView").addEventListener("click", (e) => { st.inView = !st.inView; e.currentTarget.setAttribute("aria-pressed", String(st.inView)); renderList(); });
  $("#locFab").addEventListener("click", () => locate(() => { if (st.me) { map.setLevel(7); map.panTo(new kakao.maps.LatLng(st.me.lat, st.me.lng)); } }));
  $("#sort").addEventListener("change", (e) => { st.sort = e.target.value; if (st.sort === "dist" && !st.me) locate(renderList); renderList(); });
  $("#quick").addEventListener("click", (e) => {
    const b = e.target.closest("[data-go]"); if (!b || b.disabled) return;
    const go = b.dataset.go;
    if (go === "near") goNear();
    if (go === "priced") { st.priceOnly = true; $("#priceOnly").checked = true; refresh(true); }
    if (go === "fav") { st.favOnly = !st.favOnly; b.style.background = st.favOnly ? "#F6E8DF" : ""; refresh(true); }
    if (go === "rare") { const c = counts(); st.sido = Object.keys(c).sort((a, z) => c[a] - c[z])[0]; refresh(true); }
  });
  $("#list").addEventListener("click", (e) => {
    const h = e.target.closest("[data-fav]"); if (h) { toggleFav(h.dataset.fav); return; }
    const it = e.target.closest(".item"); if (it && e.target.closest(".open")) { select(it.dataset.id, "list"); return; }
    if (e.target.id === "more") { st.shown += 60; renderList(); }
    if (e.target.id === "reset") { st.q = ""; $("#q").value = ""; st.sido = "전체"; st.kind = ""; st.priceOnly = false; st.favOnly = false; $("#priceOnly").checked = false; refresh(true); }
  });
  $("#list").addEventListener("mouseover", (e) => { const it = e.target.closest(".item"); if (it) hotPin(it.dataset.id, true); });
  $("#list").addEventListener("mouseout", (e) => { const it = e.target.closest(".item"); if (it) hotPin(it.dataset.id, false); });
  $("#preview").addEventListener("click", (e) => {
    const h = e.target.closest("[data-fav]"); if (h) { toggleFav(h.dataset.fav); return; }
    if (e.target.id === "sd" && st.sel) openDetail(st.sel);
  });
  $("#detail").addEventListener("click", (e) => {
    if (e.target.id === "dback") closeDetail();
    if (e.target.id === "dloc") locate(() => { if (st.sel) openDetail(st.sel); });
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDetail(); });
  addEventListener("resize", () => { if (map) map.relayout(); });

  /* ---------- 시작 ---------- */
  renderFilters(); renderQuick(); hintPreview();
  function boot() {
    map = new kakao.maps.Map($("#map"), { center: new kakao.maps.LatLng(36.3, 127.8), level: 13 });
    kakao.maps.event.addListener(map, "idle", () => { renderMap(); renderList(); });
    kakao.maps.event.addListener(map, "tilesloaded", () => { $("#mapsk").hidden = true; });
    setDist(); st.anim = true; map.relayout();
    fit(DATA);
    renderMap(); renderList();
  }
  function fail() {
    const s = $("#mapsk"); s.className = "mapsk err"; s.hidden = false;
    s.innerHTML = "지도를 불러오지 못했어요.<br>아래 안내의 3가지를 확인해 주세요.";
    $("#list").innerHTML = sorted(filtered()).slice(0, 60).map((d) =>
      `<li class="item"><div class="open"><div class="nm">${esc(d.name)}</div><div class="ad">${esc(d.addr)}</div></div></li>`).join("");
  }
  const sc = document.createElement("script");
  sc.src = SDK + "?appkey=" + encodeURIComponent(KEY) + "&autoload=false";
  sc.onload = () => { try { kakao.maps.load(boot); } catch (e) { fail(); } };
  sc.onerror = fail;
  document.head.appendChild(sc);
  setTimeout(() => { if (!map) fail(); }, 12000);
})();
</script>
</body>
</html>
"""


def _safe_json(data):
    """<script> 안에 넣어도 태그가 깨지지 않게 '</'를 막는다."""
    return json.dumps(data, ensure_ascii=False).replace("</", "<\\/")


def onsen_html(js_key, places):
    """온천 목록 → 지도·목록·상세가 한 덩어리인 HTML 글자. JS 키만 쓴다."""
    html = HTML
    for key in ("ivory", "charcoal", "forest", "sand", "terracotta"):
        html = html.replace(f"__{key}__", BRAND[key])
    mark = mark_svg(BRAND["forest"], BRAND["ivory"], 30).replace("'", "&#39;")
    mark_sel = mark_svg(BRAND["terracotta"], BRAND["ivory"], 30).replace("'", "&#39;")
    return (
        html.replace("__NAME__", BRAND["name"])
        .replace("__DATA__", _safe_json(places))
        .replace("__KEY__", _safe_json(js_key))
        .replace("__SDK__", API["sdk"])
        .replace("__MARK_SVG_SEL__", mark_sel)
        .replace("__MARK_SVG__", mark)
    )
