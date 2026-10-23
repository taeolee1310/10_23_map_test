"""온천마다 가까운 주차장을 카카오 카테고리 검색(PK6)으로 찾아 data/onsen_parking.csv로 저장한다.

REST 키는 이 파이썬 파일에서만 쓴다. (HTML·화면에는 결과 CSV만 간다)
카카오가 주지 않는 주차 요금은 만들지 않는다. 온천 시설 자체의 주차 정책도 아니다.
"""
import os
import sys
import time
from datetime import datetime
from zoneinfo import ZoneInfo

import pandas as pd
import requests
from dotenv import load_dotenv

# 🔌 API 주소는 여기 한 곳에만
API = {
    "category": "https://dapi.kakao.com/v2/local/search/category.json",
}

load_dotenv(override=True)

SRC = "data/onsen_clean.csv"
OUT = "data/onsen_parking.csv"
RADIUS = 500  # m. 카카오 최대 20000
PER_ONSEN = 3  # 온천마다 가까운 순 3곳까지
MAX_CALLS = 400  # 한 번 실행에서 부르는 최대 횟수 (실수로 계속 도는 것을 막는다)
KR = (33, 39, 124, 132)  # 위도 33~39, 경도 124~132 밖은 버린다


def nearby_parking(lat, lng):
    """좌표 반경 안의 주차장을 가까운 순으로. 키·연결 문제는 ⛔ 한 줄 RuntimeError."""
    key = os.getenv("KAKAO_REST_API_KEY")
    if not key:
        raise RuntimeError("⛔ .env에 KAKAO_REST_API_KEY 값을 넣어 주세요")
    try:
        # 🔌 API 호출
        res = requests.get(
            API["category"],
            headers={"Authorization": f"KakaoAK {key}"},
            params={
                "category_group_code": "PK6",
                "x": lng,  # 요청은 x=경도
                "y": lat,  # 요청은 y=위도
                "radius": RADIUS,
                "sort": "distance",
                "size": PER_ONSEN,
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

    found = []
    for d in res.json()["documents"]:
        try:
            y, x = float(d["y"]), float(d["x"])  # y=위도, x=경도 (글자 → 숫자)
            dist = int(d["distance"])
        except (KeyError, ValueError):
            continue  # 숫자로 못 바꾸면 그 줄은 쓰지 않는다
        if not (KR[0] <= y <= KR[1] and KR[2] <= x <= KR[3]):
            continue
        found.append(
            {
                "주차장이름": d["place_name"],
                "거리(m)": dist,
                "주소": d["road_address_name"] or d["address_name"],  # 도로명이 비면 지번
                "구분": d["category_name"].split(" > ")[-1],
                "카카오장소주소": d["place_url"],
            }
        )
    return found


if __name__ == "__main__":
    if not os.path.exists(SRC):
        print(f"⛔ {SRC}가 없어요. python onsen_data.py를 먼저 실행해 주세요")
        raise SystemExit(1)

    onsens = pd.read_csv(SRC, encoding="utf-8-sig", dtype={"카카오ID": str})
    print(onsens.shape, "빈칸:", onsens[["카카오ID", "위도", "경도"]].isna().sum().to_dict())
    onsens = onsens.dropna(subset=["카카오ID", "위도", "경도"])
    if len(onsens) > MAX_CALLS:
        print(f"⛔ 온천이 {len(onsens)}곳이라 한 번에 부를 수 있는 {MAX_CALLS}번을 넘어요. MAX_CALLS를 확인해 주세요")
        raise SystemExit(1)

    today = datetime.now(ZoneInfo("Asia/Seoul")).strftime("%Y-%m-%d")
    rows, none_count = [], 0
    for i, o in enumerate(onsens.itertuples(index=False), 1):
        try:
            found = nearby_parking(o.위도, o.경도)
        except RuntimeError as e:
            print(e)  # ⛔ 에러가 나면 바로 멈춘다
            raise SystemExit(1)
        if not found:
            none_count += 1
            # 조회했지만 없음 → 이름이 빈 줄로 남겨서 '조회 안 됨'과 구분한다
            rows.append({"카카오ID": o.카카오ID, "주차장이름": "", "거리(m)": "", "주소": "", "구분": "", "카카오장소주소": ""})
        for f in found:
            rows.append({"카카오ID": o.카카오ID, **f})
        time.sleep(0.1)
        if i % 50 == 0:
            print(f"  {i}/{len(onsens)}곳 조회")

    df = pd.DataFrame(rows)
    df["조회반경(m)"] = RADIUS
    df["데이터기준일자"] = today
    df.to_csv(OUT, index=False, encoding="utf-8-sig")

    has = df[df["주차장이름"] != ""]
    print(f"온천 {len(onsens)}곳 조회 / 반경 {RADIUS}m 안에 주차장이 있는 온천 {len(onsens) - none_count}곳, 없는 온천 {none_count}곳")
    print(f"저장: {OUT} (주차장 {len(has)}줄, 기준일 {today})")
    print(f"조건: 카카오 카테고리 PK6(주차장), 반경 {RADIUS}m, 가까운 순 {PER_ONSEN}곳까지")
    print("출처: 카카오 로컬 API (카테고리로 장소 검색)")
