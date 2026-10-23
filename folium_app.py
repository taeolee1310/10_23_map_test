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
}

# 디자인 값은 여기 한 곳에만
STYLE = {
    "title": "동네 장소 지도",
    "center_color": "red",
    "place_color": "blue",
    "circle_color": "#3388ff",
    "map_height": 520,
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

load_dotenv(override=True)

st.set_page_config(page_title=STYLE["title"], layout="wide")
st.title(STYLE["title"])

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
    """folium 지도 HTML 글자를 만든다. 가운데 점 + 반경 원 + 장소 마커."""
    m = folium.Map(location=[center["위도"], center["경도"]], zoom_start=15, control_scale=True)
    folium.Circle(
        [center["위도"], center["경도"]],
        radius=radius,
        color=STYLE["circle_color"],
        fill=True,
        fill_opacity=0.08,
    ).add_to(m)
    folium.Marker(
        [center["위도"], center["경도"]],
        tooltip=center["이름"],
        popup=folium.Popup(html.escape(center["이름"]), max_width=250),
        icon=folium.Icon(color=STYLE["center_color"], icon="star"),
    ).add_to(m)
    points = [[center["위도"], center["경도"]]]
    for _, r in view.iterrows():
        text = f"<b>{html.escape(r['이름'])}</b><br>{html.escape(r['주소'])}<br>{r['거리(m)']}m"
        folium.Marker(
            [r["위도"], r["경도"]],
            tooltip=r["이름"],
            popup=folium.Popup(text, max_width=250),
            icon=folium.Icon(color=STYLE["place_color"]),
        ).add_to(m)
        points.append([r["위도"], r["경도"]])
    m.fit_bounds(points)  # 마커가 다 화면에 들어오게
    return m.get_root().render()


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

st.subheader(f"{center['이름']} 반경 {radius}m 안의 {category}")
st.caption(f"기준 위치: {center['주소']} (위도 {center['위도']:.5f}, 경도 {center['경도']:.5f})")

if view.empty:
    st.info("조건에 맞는 곳이 없어요")
else:
    c1, c2, c3 = st.columns(3)
    c1.metric("찾은 곳", f"{len(view)}곳")
    c2.metric("가장 가까운 곳", f"{int(view['거리(m)'].min())}m")
    c3.metric("평균 거리", f"{int(view['거리(m)'].mean())}m")

    st.iframe(make_map(center, view, radius), height=STYLE["map_height"])
    st.dataframe(view, hide_index=True)

now = datetime.now(ZoneInfo("Asia/Seoul")).strftime("%Y-%m-%d %H:%M")
st.caption(f"출처: 카카오 로컬 API (장소 검색·카테고리 검색), 지도: OpenStreetMap / folium. 조회 시각 {now} KST (최대 {COUNT}곳)")
