import html
import os
from datetime import datetime
from zoneinfo import ZoneInfo

import folium
import pandas as pd
import requests
import streamlit as st
from dotenv import load_dotenv

from place import search_place

# 🔌 API 주소는 여기 한 곳에만 (장소 이름 → 좌표는 place.py의 search_place)
API = {
    "category": "https://dapi.kakao.com/v2/local/search/category.json",
    "tiles": "https://tile.openstreetmap.org/{z}/{x}/{y}.png",  # 지도 바탕 타일 (OSM, CSS로 네이비 톤)
}

# 디자인 값은 여기 한 곳에만 (딥 네이비 + 애시드 라임 한 점)
STYLE = {
    "title": "동네 장소 지도",
    "navy9": "#050A1C",  # 가장 깊은 바탕
    "navy8": "#0A1128",  # 화면 바탕
    "navy7": "#101C3F",  # 카드
    "navy6": "#1B2B5E",  # 호버·진한 선
    "line": "#26376E",
    "text": "#E6ECFF",
    "muted": "#8D9BC7",
    "accent": "#C8FF3D",  # 유일한 강조색
    "ink": "#050A1C",  # 강조색 위의 글자
    "map_height": 620,
}

CATEGORIES = {
    "카페": "CE7",
    "음식점": "FD6",
    "편의점": "CS2",
    "약국": "PM9",
    "병원": "HP8",
    "지하철역": "SW8",
    "주차장": "PK6",
    "대형마트": "MT1",
    "은행": "BK9",
    "관광명소": "AT4",
    "문화시설": "CT1",
}
COUNT = 15  # 카테고리 검색 한 번에 가져올 수 있는 최대 개수

PAGE_CSS = """
@import url('https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.css');
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&display=swap');

html, body, .stApp, [class*="css"] { font-family: 'Pretendard', sans-serif; }
.stApp {
  background-color: __navy8__;
  background-image:
    linear-gradient(to right, rgba(38,55,110,.28) 1px, transparent 1px),
    linear-gradient(to bottom, rgba(38,55,110,.28) 1px, transparent 1px);
  background-size: 64px 64px;
  color: __text__;
}
#MainMenu, footer { visibility: hidden; }
[data-testid="stHeader"] { background: transparent; }
.block-container { padding-top: 2.2rem; max-width: 1480px; }

[data-testid="stSidebar"] { background: __navy9__; border-right: 1px solid __line__; }
[data-testid="stSidebar"] h2 {
  font-family: 'JetBrains Mono', monospace; font-size: .8rem; letter-spacing: .18em;
  text-transform: uppercase; color: __accent__;
}

.kicker {
  font-family: 'JetBrains Mono', monospace; font-size: .78rem; letter-spacing: .22em;
  text-transform: uppercase; color: __accent__; display: flex; gap: .8rem; align-items: center;
}
.kicker::before { content: ""; width: 38px; height: 1px; background: __accent__; }
.hero { display: flex; align-items: flex-end; justify-content: space-between; gap: 2rem; flex-wrap: wrap; }
.hero h1 {
  margin: .35rem 0 0; padding: 0; font-weight: 800; letter-spacing: -.05em; line-height: .92;
  font-size: clamp(3rem, 8.5vw, 7.5rem); color: __text__;
}
.hero h1 em { font-style: normal; color: transparent; -webkit-text-stroke: 1.5px __text__; }
.hero .count {
  font-family: 'JetBrains Mono', monospace; font-weight: 700; line-height: .8;
  font-size: clamp(4rem, 11vw, 9rem); color: transparent; -webkit-text-stroke: 1.5px __accent__;
}
.hero .count small { font-size: .9rem; -webkit-text-stroke: 0; color: __muted__; letter-spacing: .18em; margin-left: .6rem; }
.where { margin: 1rem 0 0; color: __muted__; font-size: .95rem; }
.where b { color: __text__; font-weight: 600; }

.ticker {
  margin: 1.6rem 0 1.4rem; border-top: 1px solid __line__; border-bottom: 1px solid __line__;
  overflow: hidden; white-space: nowrap; padding: .55rem 0; background: rgba(5,10,28,.6);
}
.ticker div { display: inline-block; animation: slide 38s linear infinite; }
.ticker span {
  font-family: 'JetBrains Mono', monospace; font-size: .8rem; letter-spacing: .2em;
  text-transform: uppercase; color: __muted__; padding-right: 2.4rem;
}
.ticker span i { color: __accent__; font-style: normal; padding-left: 2.4rem; }
@keyframes slide { to { transform: translateX(-50%); } }
@media (prefers-reduced-motion: reduce) { .ticker div { animation: none; } }

[data-testid="stMetric"] {
  background: rgba(16,28,63,.72); border: 1px solid __line__; padding: 1rem 1.2rem;
  border-radius: 0; position: relative;
}
[data-testid="stMetric"]::after {
  content: ""; position: absolute; left: -1px; top: -1px; width: 14px; height: 14px;
  border-top: 2px solid __accent__; border-left: 2px solid __accent__;
}
[data-testid="stMetricLabel"] p {
  font-family: 'JetBrains Mono', monospace; font-size: .72rem; letter-spacing: .16em;
  text-transform: uppercase; color: __muted__;
}
[data-testid="stMetricValue"] {
  font-family: 'JetBrains Mono', monospace; font-weight: 700; color: __accent__; font-size: 2.3rem;
}

.label {
  font-family: 'JetBrains Mono', monospace; font-size: .74rem; letter-spacing: .2em;
  text-transform: uppercase; color: __muted__; margin: 1.4rem 0 .6rem;
  display: flex; justify-content: space-between;
}
.list { max-height: __map_height__px; overflow-y: auto; border-top: 1px solid __line__; }
.list::-webkit-scrollbar { width: 4px; }
.list::-webkit-scrollbar-thumb { background: __line__; }
.row {
  display: grid; grid-template-columns: 2.6rem 1fr auto; gap: .6rem; align-items: start;
  padding: .85rem .5rem; border-bottom: 1px solid __line__; transition: background .2s;
}
.row:hover { background: __navy7__; }
.row .idx { font-family: 'JetBrains Mono', monospace; color: __accent__; font-weight: 700; }
.row .nm { font-weight: 700; color: __text__; line-height: 1.25; }
.row .ad { color: __muted__; font-size: .82rem; margin-top: .15rem; }
.row .bar { height: 2px; background: __navy6__; margin-top: .6rem; }
.row .bar i { display: block; height: 100%; background: __accent__; }
.row .ds { font-family: 'JetBrains Mono', monospace; font-weight: 700; color: __text__; white-space: nowrap; }
.row .ds small { color: __muted__; font-weight: 400; margin-left: 1px; }

[data-testid="stExpander"] { border: 1px solid __line__; border-radius: 0; background: rgba(16,28,63,.5); }
[data-testid="stCaptionContainer"] { color: __muted__; }
iframe { border: 1px solid __line__; border-radius: 0; }
"""

MAP_CSS = """
<style>
@import url('https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.css');
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@700&display=swap');
html, body { margin: 0; background: __navy8__; }
.leaflet-container { background: __navy8__; font-family: 'Pretendard', sans-serif; }
.leaflet-tile-pane { filter: invert(1) grayscale(1) brightness(1.25) contrast(1.15) sepia(1) hue-rotate(190deg) saturate(2.4); }
.leaflet-bar a, .leaflet-bar a:hover {
  background: __navy9__ !important; color: __accent__ !important; border-bottom: 1px solid __line__ !important;
  border-radius: 0 !important;
}
.leaflet-bar { border: 1px solid __line__ !important; box-shadow: none !important; border-radius: 0 !important; }
.leaflet-control-attribution { background: rgba(5,10,28,.8) !important; color: __muted__ !important; }
.leaflet-control-attribution a { color: __muted__ !important; }
.leaflet-control-scale-line { background: transparent !important; color: __text__ !important; border-color: __text__ !important; }
.leaflet-tooltip {
  background: __navy9__; color: __text__; border: 1px solid __accent__; border-radius: 0;
  box-shadow: none; font-weight: 600; padding: 4px 8px;
}
.leaflet-tooltip-top:before { border-top-color: __accent__; }
.leaflet-popup-content-wrapper, .leaflet-popup-tip {
  background: __navy9__; color: __text__; border: 1px solid __accent__; border-radius: 0; box-shadow: none;
}
.leaflet-popup-content { margin: 12px 14px; line-height: 1.45; font-size: 13px; }
.leaflet-popup-content b { font-size: 14px; }
.leaflet-popup-content .d { font-family: 'JetBrains Mono', monospace; color: __accent__; font-weight: 700; }
.leaflet-popup-close-button { color: __accent__ !important; }
.pin {
  width: 28px; height: 28px; border-radius: 50%; background: __navy9__; border: 1.5px solid __accent__;
  color: __accent__; font: 700 11px 'JetBrains Mono', monospace; display: flex;
  align-items: center; justify-content: center; transition: transform .15s;
}
.pin:hover { transform: scale(1.25); background: __accent__; color: __ink__; }
.pin.first { background: __accent__; color: __ink__; }
.core { position: relative; width: 22px; height: 22px; }
.core b { position: absolute; inset: 6px; border-radius: 50%; background: __text__; }
.core i {
  position: absolute; inset: 0; border-radius: 50%; border: 1.5px solid __text__;
  animation: ping 2.2s ease-out infinite;
}
@keyframes ping { from { transform: scale(.5); opacity: 1; } to { transform: scale(2.6); opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .core i { animation: none; } }
</style>
"""


def paint(css):
    """STYLE 값을 CSS의 __이름__ 자리에 넣는다. (긴 이름부터 바꿔서 겹침 방지)"""
    for key in sorted(STYLE, key=len, reverse=True):
        css = css.replace(f"__{key}__", str(STYLE[key]))
    return css


load_dotenv(override=True)

st.set_page_config(page_title=STYLE["title"], layout="wide")
st.markdown(f"<style>{paint(PAGE_CSS)}</style>", unsafe_allow_html=True)

# 키가 없으면 없다고 알리고 멈춘다
if not os.getenv("KAKAO_REST_API_KEY"):
    st.error("⛔ .env에 KAKAO_REST_API_KEY 값이 없어요. 값을 넣고 Ctrl+C 후 다시 streamlit run 해 주세요")
    st.stop()


@st.cache_data(ttl=600)
def find_center(query):
    """장소 이름 → 첫 번째 결과(이름, 주소, 위도, 경도). 없으면 None. 에러는 밖에서 받는다(캐시 안 됨)."""
    places = search_place(query, size=1)
    return places[0] if places else None


@st.cache_data(ttl=600)
def find_nearby(code, lat, lng, radius):
    """좌표 반경 안의 카테고리 장소를 가까운 순으로 COUNT개. 에러는 밖에서 받는다(캐시 안 됨)."""
    key = os.getenv("KAKAO_REST_API_KEY")
    try:
        # 🔌 API 호출
        res = requests.get(
            API["category"],
            headers={"Authorization": f"KakaoAK {key}"},
            params={
                "category_group_code": code,
                "x": lng,  # 요청은 x=경도
                "y": lat,  # 요청은 y=위도
                "radius": radius,
                "sort": "distance",
                "size": COUNT,
            },
            timeout=10,
        )
    except requests.RequestException:
        raise RuntimeError("⛔ 카카오에 연결하지 못했어요. 인터넷을 확인해 주세요") from None

    if res.status_code == 401:
        raise RuntimeError("⛔ 카카오 REST API 키가 틀렸어요")
    if res.status_code == 403:
        raise RuntimeError("⛔ 카카오맵 사용 설정을 켜 주세요")
    if res.status_code != 200:
        raise RuntimeError(f"⛔ 카카오 응답 오류예요 (코드 {res.status_code})")

    rows = []
    for d in res.json()["documents"]:
        y, x = float(d["y"]), float(d["x"])  # y=위도, x=경도 (글자 → 숫자)
        if not (33 <= y <= 39 and 124 <= x <= 132):  # 한국 밖 좌표는 버린다
            continue
        rows.append(
            {
                "이름": d["place_name"],
                "주소": d["road_address_name"] or d["address_name"],  # 도로명이 비면 지번
                "거리(m)": int(d["distance"]) if d.get("distance") else 0,
                "위도": y,
                "경도": x,
            }
        )
    return rows


def make_map(center, view, radius):
    """folium 지도 HTML 글자를 만든다. 네이비 지도 + 반경 원 + 중심에서 뻗는 선 + 번호 핀."""
    c = [center["위도"], center["경도"]]
    m = folium.Map(
        location=c,
        zoom_start=15,
        tiles=API["tiles"],
        attr="&copy; OpenStreetMap contributors",
        control_scale=True,
    )
    m.get_root().header.add_child(folium.Element(paint(MAP_CSS)))

    folium.Circle(
        c,
        radius=radius,
        color=STYLE["accent"],
        weight=1,
        dash_array="4 8",
        fill=True,
        fill_color=STYLE["navy7"],
        fill_opacity=0.22,
    ).add_to(m)

    points = [c]
    for i, (_, r) in enumerate(view.iterrows(), 1):
        p = [r["위도"], r["경도"]]
        folium.PolyLine([c, p], color=STYLE["accent"], weight=1, opacity=0.3, dash_array="2 6").add_to(m)
        popup = (
            f"<b>{html.escape(r['이름'])}</b><br>{html.escape(r['주소'])}<br>"
            f"<span class='d'>{r['거리(m)']}m</span>"
        )
        folium.Marker(
            p,
            tooltip=r["이름"],
            popup=folium.Popup(popup, max_width=260),
            icon=folium.DivIcon(
                html=f"<div class='pin{' first' if i == 1 else ''}'>{i}</div>",
                icon_size=(28, 28),
                icon_anchor=(14, 14),
            ),
        ).add_to(m)
        points.append(p)

    folium.Marker(
        c,
        tooltip=center["이름"],
        popup=folium.Popup(f"<b>{html.escape(center['이름'])}</b><br>{html.escape(center['주소'])}", max_width=260),
        icon=folium.DivIcon(html="<div class='core'><i></i><b></b></div>", icon_size=(22, 22), icon_anchor=(11, 11)),
    ).add_to(m)

    m.fit_bounds(points, padding=(40, 40))  # 마커가 다 화면에 들어오게
    return m.get_root().render()


def list_html(view, radius):
    """가까운 순 목록. 막대 길이 = 반경 대비 거리."""
    rows = []
    for i, r in enumerate(view.itertuples(index=False), 1):
        pct = min(100, round(r[2] / radius * 100))
        rows.append(
            f"<div class='row'><div class='idx'>{i:02d}</div>"
            f"<div><div class='nm'>{html.escape(r[0])}</div><div class='ad'>{html.escape(r[1])}</div>"
            f"<div class='bar'><i style='width:{pct}%'></i></div></div>"
            f"<div class='ds'>{r[2]}<small>m</small></div></div>"
        )
    return f"<div class='list'>{''.join(rows)}</div>"


# 화면 ------------------------------------------------------------
with st.sidebar:
    st.header("검색 조건")
    query = st.text_input("동네·장소 이름", value="강남역")
    category = st.selectbox("카테고리", list(CATEGORIES))
    radius = st.slider("반경(m)", 100, 2000, 500, step=100)

if not query.strip():
    st.info("동네나 장소 이름을 입력해 주세요")
    st.stop()

try:
    center = find_center(query.strip())
    if center is None:
        st.warning(f"'{query}'을(를) 찾지 못했어요")
        st.stop()
    rows = find_nearby(CATEGORIES[category], center["위도"], center["경도"], radius)
except RuntimeError as e:
    st.error(str(e))
    st.stop()

view = pd.DataFrame(rows, columns=["이름", "주소", "거리(m)", "위도", "경도"])

st.markdown(
    f"<div class='hero'><div><div class='kicker'>Neighborhood / Place Map</div>"
    f"<h1>동네<br><em>장소</em> 지도</h1></div>"
    f"<div class='count'>{len(view):02d}<small>PLACES</small></div></div>"
    f"<p class='where'><b>{html.escape(center['이름'])}</b> 반경 {radius}m 안의 {html.escape(category)} · "
    f"기준 위치 {html.escape(center['주소'])} "
    f"(위도 {center['위도']:.5f}, 경도 {center['경도']:.5f})</p>",
    unsafe_allow_html=True,
)

tick = (
    f"<span><i>●</i>{html.escape(center['이름'])}</span>"
    f"<span><i>●</i>{html.escape(category)}</span>"
    f"<span><i>●</i>{radius}M</span>"
    f"<span><i>●</i>{len(view)} PLACES</span>"
) * 4
st.markdown(f"<div class='ticker'><div>{tick}{tick}</div></div>", unsafe_allow_html=True)

if view.empty:
    st.info("조건에 맞는 곳이 없어요")
else:
    c1, c2, c3 = st.columns(3)
    c1.metric("찾은 곳", f"{len(view)}곳")
    c2.metric("가장 가까운 곳", f"{int(view['거리(m)'].min())}m")
    c3.metric("평균 거리", f"{int(view['거리(m)'].mean())}m")

    left, right = st.columns([1.9, 1], gap="large")
    with left:
        st.markdown("<div class='label'><span>Map</span><span>가까운 순 번호</span></div>", unsafe_allow_html=True)
        st.iframe(make_map(center, view, radius), height=STYLE["map_height"])
    with right:
        st.markdown("<div class='label'><span>Nearby</span><span>가까운 순</span></div>", unsafe_allow_html=True)
        st.markdown(list_html(view, radius), unsafe_allow_html=True)

    with st.expander("표로 보기 (위도·경도 포함)"):
        st.dataframe(view, hide_index=True)

now = datetime.now(ZoneInfo("Asia/Seoul")).strftime("%Y-%m-%d %H:%M")
st.caption(
    f"출처: 카카오 로컬 API (장소 검색·카테고리 검색), 지도: OpenStreetMap / folium. "
    f"조회 시각 {now} KST (최대 {COUNT}곳)"
)
