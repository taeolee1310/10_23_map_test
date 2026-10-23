"""전국 온천 목록을 카카오 키워드 검색으로 모아 data/onsen_clean.csv로 저장한다.

가격·운영시간·시설은 카카오가 주지 않으므로 여기서 만들지 않는다. (data/onsen_prices.csv에 확인된 것만 적는다)
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

REGIONS = [
    "서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종", "경기",
    "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주",
]
PAGES = 3  # 카카오 키워드 검색은 한 검색어에 최대 3쪽(45개)
OUT = "data/onsen_clean.csv"


def fetch(query, page):
    """키워드 검색 1쪽. 키·연결 문제는 ⛔ 한 줄 RuntimeError."""
    key = os.getenv("KAKAO_REST_API_KEY")
    if not key:
        raise RuntimeError("⛔ .env에 KAKAO_REST_API_KEY 값을 넣어 주세요")
    try:
        # 🔌 API 호출
        res = requests.get(
            API["keyword"],
            headers={"Authorization": f"KakaoAK {key}"},
            params={"query": query, "size": 15, "page": page},
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


def kind_of(d):
    """카카오 분류로 구분을 정한다. 온천 시설이 아닌 곳(주차장·식당 등)은 None."""
    cat = d["category_name"]
    if cat.startswith("여행 > 관광,명소 > 온천"):
        return "온천"
    if "온천" not in d["place_name"] and "온천" not in cat:
        return None
    if cat.startswith("가정,생활 > 목욕탕,사우나"):
        return "온천 목욕탕·사우나"
    if cat.startswith("여행 > 숙박"):
        return "온천 숙박"
    return None


def collect():
    found = {}
    raw_count = 0
    for region in REGIONS:
        for page in range(1, PAGES + 1):
            docs, is_end = fetch(f"{region} 온천", page)
            raw_count += len(docs)
            for d in docs:
                if kind_of(d):
                    found[d["id"]] = d
            time.sleep(0.1)
            if is_end:
                break
    return found, raw_count


def to_frame(found, today):
    rows = []
    for d in found.values():
        lat, lng = float(d["y"]), float(d["x"])  # y=위도, x=경도 (글자 → 숫자)
        if not (33 <= lat <= 39 and 124 <= lng <= 132):  # 한국 밖 좌표는 버린다
            continue
        addr = d["road_address_name"] or d["address_name"]  # 도로명이 비면 지번
        phone = d["phone"]
        if phone.startswith("010"):  # 개인 휴대폰 번호는 뺀다
            phone = ""
        rows.append(
            {
                "카카오ID": d["id"],
                "이름": d["place_name"],
                "주소": addr,
                "시도": d["address_name"].split()[0],
                "위도": lat,
                "경도": lng,
                "전화": phone,
                "구분": kind_of(d),
                "분류": d["category_name"],
                "카카오장소주소": d["place_url"],
                "데이터기준일자": today,
            }
        )
    df = pd.DataFrame(rows).drop_duplicates(subset=["이름", "주소"])
    return df.sort_values(["시도", "이름"]).reset_index(drop=True)


if __name__ == "__main__":
    today = datetime.now(ZoneInfo("Asia/Seoul")).strftime("%Y-%m-%d")
    try:
        found, raw_count = collect()
    except RuntimeError as e:
        print(e)
        raise SystemExit(1)

    df = to_frame(found, today)
    print(f"조회한 장소 {raw_count}개 중 온천 시설로 분류된 곳 {len(found)}개 → 중복 뺀 {len(df)}곳")
    print(df.shape, "빈칸:", df.isna().sum().to_dict())
    print(df["시도"].value_counts().to_string())
    print("구분:", df["구분"].value_counts().to_dict())

    os.makedirs("data", exist_ok=True)
    df.to_csv(OUT, index=False, encoding="utf-8-sig")
    print(f"저장: {OUT} (기준일 {today})")
    print("출처: 카카오 로컬 API (키워드로 장소 검색)")
