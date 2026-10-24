"""서울 동네 목욕탕·사우나를 구별 카카오 키워드 검색으로 모아 data/seoul_bath_clean.csv로 저장한다.

온천만 모은 기존 목록(onsen_clean.csv)에 없는 일반 목욕탕을 채우려는 파일이다. 요금은 여기서 만들지 않는다. (data/onsen_prices.csv에 확인된 것만 적는다)
"""
import os
import time
from datetime import datetime
from zoneinfo import ZoneInfo

import pandas as pd
import requests
from dotenv import load_dotenv

# 🔌 API 주소는 여기 한 곳에만
API = {
    "keyword": "https://dapi.kakao.com/v2/local/search/keyword.json",
}

load_dotenv(override=True)

GU = [
    "강남구", "강동구", "강북구", "강서구", "관악구", "광진구", "구로구", "금천구", "노원구",
    "도봉구", "동대문구", "동작구", "마포구", "서대문구", "서초구", "성동구", "성북구",
    "송파구", "양천구", "영등포구", "용산구", "은평구", "종로구", "중구", "중랑구",
]
WORDS = ["목욕탕", "사우나", "대중목욕탕", "찜질방"]  # 검색어마다 최대 45개라 말을 바꿔 여러 번 찾는다
PAGES = 3
# 구 검색은 검색어마다 45곳에서 끊겨 빠지는 곳이 있다. 서울 전체를 격자로 나눠 지점마다 반경 안을 다시 찾는다.
GRID_WORDS = ["목욕탕", "사우나", "찜질방"]
GRID_RADIUS = 1500  # m
LAT_RANGE, LNG_RANGE = (37.43, 37.70), (126.76, 127.19)
LAT_STEP, LNG_STEP = 0.0162, 0.0204  # 약 1.8km
OUT = "data/seoul_bath_clean.csv"


def fetch(query, page, **where):
    """키워드 검색 1쪽. 키·연결 문제는 ⛔ 한 줄 RuntimeError."""
    key = os.getenv("KAKAO_REST_API_KEY")
    if not key:
        raise RuntimeError("⛔ .env에 KAKAO_REST_API_KEY 값을 넣어 주세요")
    try:
        # 🔌 API 호출
        res = requests.get(
            API["keyword"],
            headers={"Authorization": f"KakaoAK {key}"},
            params={"query": query, "size": 15, "page": page, **where},
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
    body = res.json()
    return body["documents"], body["meta"]["is_end"]


def is_bath(d, gu):
    """목욕탕·사우나·찜질방 분류이고 서울 해당 구 주소인 곳만. 온천은 기존 목록에 있으므로 넘긴다."""
    cat, addr = d["category_name"], d["address_name"]
    if not (cat.startswith("가정,생활 > 목욕탕,사우나") or "찜질방" in cat):
        return False
    t = addr.split()
    return len(t) > 1 and t[0] == "서울" and t[1] == gu


def is_bath_seoul(d):
    cat, t = d["category_name"], d["address_name"].split()
    return (cat.startswith("가정,생활 > 목욕탕,사우나") or "찜질방" in cat) and len(t) > 1 and t[0] == "서울"


def collect_grid(found):
    raw_count, lat = 0, LAT_RANGE[0]
    while lat <= LAT_RANGE[1]:
        lng = LNG_RANGE[0]
        while lng <= LNG_RANGE[1]:
            for word in GRID_WORDS:
                for page in range(1, PAGES + 1):
                    docs, is_end = fetch(word, page, x=round(lng, 5), y=round(lat, 5), radius=GRID_RADIUS)
                    raw_count += len(docs)
                    for d in docs:
                        if is_bath_seoul(d):
                            found[d["id"]] = d
                    time.sleep(0.1)
                    if is_end:
                        break
            lng += LNG_STEP
        lat += LAT_STEP
    return raw_count


def collect():
    found, raw_count = {}, 0
    for gu in GU:
        for word in WORDS:
            for page in range(1, PAGES + 1):
                docs, is_end = fetch(f"서울 {gu} {word}", page)
                raw_count += len(docs)
                for d in docs:
                    if is_bath(d, gu):
                        found[d["id"]] = d
                time.sleep(0.1)
                if is_end:
                    break
    n_gu = len(found)
    raw_count += collect_grid(found)
    print(f"구별 검색 {n_gu}곳 → 격자 검색까지 {len(found)}곳")
    return found, raw_count


def to_frame(found, today):
    rows = []
    for d in found.values():
        lat, lng = float(d["y"]), float(d["x"])  # y=위도, x=경도 (글자 → 숫자)
        if not (33 <= lat <= 39 and 124 <= lng <= 132):  # 한국 밖 좌표는 버린다
            continue
        phone = d["phone"]
        if phone.startswith("010"):  # 개인 휴대폰 번호는 뺀다
            phone = ""
        rows.append(
            {
                "카카오ID": d["id"],
                "이름": d["place_name"],
                "주소": d["road_address_name"] or d["address_name"],  # 도로명이 비면 지번
                "시도": "서울특별시",
                "시군구": d["address_name"].split()[1],
                "위도": lat,
                "경도": lng,
                "전화": phone,
                "구분": "목욕탕·사우나",
                "분류": d["category_name"],
                "카카오장소주소": d["place_url"],
                "데이터기준일자": today,
            }
        )
    df = pd.DataFrame(rows).drop_duplicates(subset=["이름", "주소"])
    return df.sort_values(["시군구", "이름"]).reset_index(drop=True)


if __name__ == "__main__":
    today = datetime.now(ZoneInfo("Asia/Seoul")).strftime("%Y-%m-%d")
    try:
        found, raw_count = collect()
    except RuntimeError as e:
        print(e)
        raise SystemExit(1)

    df = to_frame(found, today)
    print(f"조회한 장소 {raw_count}개 중 서울 목욕탕·사우나·찜질방 {len(found)}개 → 중복 뺀 {len(df)}곳")
    print(df.shape, "빈칸:", df.isna().sum().to_dict())
    print(df["시군구"].value_counts().to_string())

    os.makedirs("data", exist_ok=True)
    df.to_csv(OUT, index=False, encoding="utf-8-sig")
    print(f"저장: {OUT} (기준일 {today})")
    print("출처: 카카오 로컬 API (구별 키워드로 장소 검색)")
