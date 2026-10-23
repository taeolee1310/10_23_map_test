"""합친 온천 목록(onsen_merged.csv)에 가격·주차장을 붙여 React 화면용 web/public/data/onsen.json으로 저장한다.

지도·목록 화면은 이 JSON만 읽는다. 키는 들어가지 않는다. (REST 키는 이 파이프라인 어디에도 안 쓴다)
좌표가 없는 곳(행안부에만 있는 곳)은 위도·경도가 null이고, 화면에서 목록에만 나온다.
"""
import json
import os

import pandas as pd

MERGED = "data/onsen_merged.csv"
PARKING_FILE = "data/onsen_parking.csv"  # onsen_parking.py가 카카오 API로 만든다
PRICE_FILE = "data/onsen_prices.csv"  # 확인된 가격만 사람이 적는다
OUT = "web/public/data/onsen.json"
PRICE_COLS = ("성인_평일", "성인_주말", "수건", "주차", "어린이")

# 시·도 이름은 짧게 보여 준다 (파일 표기 → 화면 표기)
SIDO_SHORT = {
    "서울특별시": "서울", "부산광역시": "부산", "대구광역시": "대구", "인천광역시": "인천",
    "광주광역시": "광주", "대전광역시": "대전", "울산광역시": "울산", "세종특별자치시": "세종",
    "경기도": "경기", "강원특별자치도": "강원", "충청북도": "충북", "충청남도": "충남",
    "전북특별자치도": "전북", "전라남도": "전남", "경상북도": "경북", "경상남도": "경남",
    "제주특별자치도": "제주", "전남광주통합특별시": "광주·전남",
}


def none_if_nan(v):
    return None if pd.isna(v) else float(v)


def load_prices():
    prices = {}
    if not os.path.exists(PRICE_FILE):
        return prices
    pdf = pd.read_csv(PRICE_FILE, encoding="utf-8-sig", dtype={"카카오ID": str})
    for col in PRICE_COLS:
        pdf[col] = pd.to_numeric(pdf[col].replace("무료", 0), errors="coerce")  # '무료'는 0원
    for r in pdf.to_dict("records"):
        if all(pd.isna(r[c]) for c in PRICE_COLS):
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
    return prices


def load_parking():
    """파일에 온천 ID가 있으면 조회한 것. 주차장이름이 빈 줄은 '반경 안에 없음', ID가 아예 없으면 '조회 안 됨'(null)."""
    parking, radius = {}, None
    if not os.path.exists(PARKING_FILE):
        return parking, radius
    kdf = pd.read_csv(PARKING_FILE, encoding="utf-8-sig", dtype={"카카오ID": str}).fillna("")
    if len(kdf):
        radius = int(kdf["조회반경(m)"].iloc[0])
    for r in kdf.to_dict("records"):
        lst = parking.setdefault(r["카카오ID"], [])
        if r["주차장이름"]:
            lst.append({"name": r["주차장이름"], "dist": int(r["거리(m)"]), "addr": r["주소"],
                        "kind": r["구분"], "url": r["카카오장소주소"]})
    return parking, radius


def build():
    df = pd.read_csv(MERGED, encoding="utf-8-sig", keep_default_na=False, dtype=str)
    prices = load_prices()
    parking, radius = load_parking()

    places = []
    for i, r in enumerate(df.to_dict("records")):
        kid = r["카카오ID"]
        has_xy = r["위도"] != "" and r["경도"] != ""
        places.append({
            "id": kid or f"m{i}",  # 카카오ID가 없는 곳(행안부만)은 줄 번호로
            "name": r["이름"],
            "addr": r["주소"],
            "sido": SIDO_SHORT.get(r["시도"], r["시도"]),
            "lat": float(r["위도"]) if has_xy else None,
            "lng": float(r["경도"]) if has_xy else None,
            "tel": r["전화"],
            "kind": r["구분"],
            "url": r["카카오장소주소"],
            "checked_at": r["데이터기준일자"],
            "source": r["출처"],
            "price": prices.get(kid) if kid else None,
            "parking": parking.get(kid) if kid else None,  # None=조회 안 됨, []=반경 안에 없음
            "parking_radius": radius,
        })
    return places


if __name__ == "__main__":
    places = build()
    no_xy = sum(1 for p in places if p["lat"] is None)
    print(f"온천 {len(places)}곳 (조건: onsen_merged.csv 전체) / 좌표 없는 곳 {no_xy}곳 / 요금 확인 {sum(1 for p in places if p['price'])}곳")
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"baseDate": max(p["checked_at"] for p in places), "places": places}, f, ensure_ascii=False)
    print(f"저장: {OUT}")
    print("출처: 행정안전부 전국 온천이용업소 현황, 카카오 로컬 API")
