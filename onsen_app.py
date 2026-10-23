import html
import os

import pandas as pd
import streamlit as st
from dotenv import load_dotenv

from onsen_map import BRAND, mark_svg, onsen_html

DATA_FILE = "data/onsen_clean.csv"
PARKING_FILE = "data/onsen_parking.csv"  # onsen_parking.py가 카카오 API로 만든다
PRICE_FILE = "data/onsen_prices.csv"  # 확인된 가격만 사람이 적는다. 비어 있으면 '가격 확인 필요'로 보인다
LOGO = "assets/onsen_mark.svg"
MAP_HEIGHT = 840

# 시·도 이름은 짧게 보여 준다 (카카오 주소 표기 → 화면 표기)
SIDO_SHORT = {
    "강원특별자치도": "강원",
    "전북특별자치도": "전북",
    "제주특별자치도": "제주",
    "세종특별자치시": "세종",
    "전남광주통합특별시": "광주·전남",
}

PAGE_CSS = """
@import url('https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.css');
html, body, .stApp, [class*="css"] { font-family: 'Pretendard', sans-serif; }
.stApp { background: __ivory__; color: __charcoal__; }
#MainMenu, footer { visibility: hidden; }
[data-testid="stHeader"] { background: transparent; }
.block-container { padding-top: 1.2rem; padding-bottom: 1.5rem; max-width: 1360px; }
.brand { display: flex; align-items: center; gap: 10px; margin: 0 0 8px 4px; }
.wordmark { font-size: 1.15rem; font-weight: 800; letter-spacing: -.03em; color: __charcoal__; }
.wordmark em { font-style: normal; color: __forest__; }
[data-testid="stCaptionContainer"] { color: #655F55; }
[data-testid="stExpander"] { border: 1px solid #E6DDCB; border-radius: 16px; background: transparent; }
iframe { border: 0; border-radius: 28px; background: __ivory__; }
"""


def paint(css):
    for key in ("ivory", "charcoal", "forest", "sand", "terracotta"):
        css = css.replace(f"__{key}__", BRAND[key])
    return css


load_dotenv(override=True)

st.set_page_config(page_title=BRAND["name"], page_icon=LOGO, layout="wide", initial_sidebar_state="collapsed")
st.markdown(f"<style>{paint(PAGE_CSS)}</style>", unsafe_allow_html=True)

st.markdown(
    f"<div class='brand'>{mark_svg(BRAND['forest'], BRAND['ivory'], 34)}"
    f"<span class='wordmark'>한국의 <em>온천</em>을 찾아서</span></div>",
    unsafe_allow_html=True,
)

js_key = os.getenv("KAKAO_JS_KEY")
if not js_key:
    st.error("⛔ .env에 KAKAO_JS_KEY 값이 없어요. 값을 넣고 Ctrl+C 후 다시 streamlit run 해 주세요")
    st.stop()
if js_key == os.getenv("KAKAO_REST_API_KEY"):
    st.error("⛔ KAKAO_JS_KEY에 REST 키가 들어가 있어요. JavaScript 키로 바꿔 주세요")
    st.stop()


def none_if_nan(v):
    return None if pd.isna(v) else v


@st.cache_data(ttl=600)
def load_places():
    """온천 목록(clean.csv)에 확인된 가격(onsen_prices.csv)을 붙인다. 파일이 없으면 예외(캐시 안 됨)."""
    if not os.path.exists(DATA_FILE):
        raise FileNotFoundError(DATA_FILE)
    df = pd.read_csv(DATA_FILE, encoding="utf-8-sig", dtype={"카카오ID": str, "전화": str}).fillna("")

    prices = {}
    if os.path.exists(PRICE_FILE):
        pdf = pd.read_csv(PRICE_FILE, encoding="utf-8-sig", dtype={"카카오ID": str})
        for col in ("성인_평일", "성인_주말", "수건", "주차", "어린이"):
            pdf[col] = pd.to_numeric(pdf[col].replace("무료", 0), errors="coerce")  # '무료'는 0원
        for r in pdf.to_dict("records"):
            if all(pd.isna(r[c]) for c in ("성인_평일", "성인_주말", "수건", "주차", "어린이")):
                continue  # 가격이 하나도 없는 줄은 '확인됨'으로 치지 않는다
            prices[r["카카오ID"]] = {
                "adult": none_if_nan(r["성인_평일"]),
                "weekend": none_if_nan(r["성인_주말"]),
                "towel": none_if_nan(r["수건"]),
                "parking": none_if_nan(r["주차"]),
                "child": none_if_nan(r["어린이"]),
                "none": str(r.get("추가요금_없음확인", "")).strip().upper() in ("Y", "예", "O"),
                "memo": "" if pd.isna(r["메모"]) else str(r["메모"]),
                "source": "" if pd.isna(r["출처"]) else str(r["출처"]),
                "checked": "" if pd.isna(r["확인일"]) else str(r["확인일"]),
            }

    # 주차장: 파일에 온천 ID가 있으면 조회한 것. 이름이 빈 줄은 '반경 안에 없음', ID가 아예 없으면 '조회 안 됨'
    parking, parking_radius = {}, None
    if os.path.exists(PARKING_FILE):
        kdf = pd.read_csv(PARKING_FILE, encoding="utf-8-sig", dtype={"카카오ID": str}).fillna("")
        if len(kdf):
            parking_radius = int(kdf["조회반경(m)"].iloc[0])
        for r in kdf.to_dict("records"):
            lst = parking.setdefault(r["카카오ID"], [])
            if r["주차장이름"]:
                lst.append({"name": r["주차장이름"], "dist": int(r["거리(m)"]), "addr": r["주소"], "kind": r["구분"], "url": r["카카오장소주소"]})

    places = []
    for r in df.to_dict("records"):
        places.append(
            {
                "id": r["카카오ID"],
                "name": r["이름"],
                "addr": r["주소"],
                "sido": SIDO_SHORT.get(r["시도"], r["시도"]),
                "lat": r["위도"],
                "lng": r["경도"],
                "tel": r["전화"],
                "kind": r["구분"],
                "url": r["카카오장소주소"],
                "checked_at": r["데이터기준일자"],
                "price": prices.get(r["카카오ID"]),
                "parking": parking.get(r["카카오ID"]),  # None=조회 안 됨, []=반경 안에 없음
                "parking_radius": parking_radius,
            }
        )
    return places


try:
    places = load_places()
except FileNotFoundError:
    st.error("⛔ data/onsen_clean.csv가 없어요. 터미널에서 python onsen_data.py를 먼저 실행해 주세요")
    st.stop()

if not places:
    st.info("온천 목록이 비어 있어요. python onsen_data.py를 다시 실행해 주세요")
    st.stop()

st.iframe(onsen_html(js_key, places), height=MAP_HEIGHT)

priced = sum(1 for p in places if p["price"])
base_date = max(p["checked_at"] for p in places)
st.caption(f"출처: 카카오 로컬 API (장소·주차장 검색), 지도: 카카오맵. 데이터 기준일 {base_date}.")
with st.expander("데이터와 안내"):
    st.markdown("\n".join([
        f"- 온천 {len(places)}곳 중 요금이 확인된 곳은 {priced}곳이에요. 요금·운영시간은 확인된 것만 보여 주고 추측해서 채우지 않아요.",
        "- 위치는 이 브라우저에서 거리 계산에만 쓰고 저장하거나 보내지 않아요.",
        "- 카카오 검색은 지역마다 최대 45곳까지만 가져와서 일부 온천이 빠졌을 수 있어요. 구분은 카카오 분류 기준이에요.",
        "- 지도가 회색이면 카카오 콘솔 JavaScript SDK 도메인에 `http://localhost:8501`을 등록하고 카카오맵 사용 설정을 켠 뒤, "
        "주소창에 `localhost:8501`로 열어 주세요. (`localhost:8502`, IP 주소, `127.0.0.1`로는 안 떠요)",
    ]))
