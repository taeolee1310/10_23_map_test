"""서울 25개 구의 목욕탕·사우나·찜질방을 카카오 키워드 검색으로 모아 data/onsen_extra_seoul.csv로 저장한다.

onsen_merge.py가 이 파일을 카카오 목록에 이어 붙여 합친다. (onsen_data.py를 다시 돌려도 사라지지 않게 따로 둔다)
카카오 분류가 '가정,생활 > 목욕탕,사우나'인 서울 장소만 쓰고, 목욕 시설이 아닌 세신샵·헬스장은 뺀다.
구분은 화면에 이미 있는 '온천 목욕탕·사우나'를 쓴다.
"""
import os
import re
import time
from datetime import datetime
from zoneinfo import ZoneInfo

import pandas as pd

from onsen_data import fetch

OUT = "data/onsen_extra_seoul.csv"
KIND = "온천 목욕탕·사우나"
GU = ["강남구", "강동구", "강북구", "강서구", "관악구", "광진구", "구로구", "금천구", "노원구",
      "도봉구", "동대문구", "동작구", "마포구", "서대문구", "서초구", "성동구", "성북구", "송파구",
      "양천구", "영등포구", "용산구", "은평구", "종로구", "중구", "중랑구"]
WORDS = ["목욕탕", "사우나", "찜질방"]
NOT_BATH = re.compile(r"세신|휘트니스|피트니스|헬스|필라테스|요가|골프|수영장|호텔$")


def collect():
    found, calls = {}, 0
    for gu in GU:
        for word in WORDS:
            for page in range(1, 4):  # 카카오는 한 검색어에 최대 3쪽(45개)
                docs, is_end = fetch(f"서울 {gu} {word}", page)
                calls += 1
                for d in docs:
                    if (d["category_name"].startswith("가정,생활 > 목욕탕,사우나")
                            and d["address_name"].startswith("서울")
                            and not NOT_BATH.search(d["place_name"])):
                        found[d["id"]] = d
                time.sleep(0.1)
                if is_end:
                    break
    return found, calls


def to_frame(found, today):
    rows = []
    for d in found.values():
        lat, lng = float(d["y"]), float(d["x"])  # y=위도, x=경도 (글자 → 숫자)
        if not (33 <= lat <= 39 and 124 <= lng <= 132):  # 한국 밖 좌표는 버린다
            continue
        phone = d["phone"]
        if phone.startswith("010"):  # 개인 휴대폰 번호는 뺀다
            phone = ""
        rows.append({
            "카카오ID": d["id"], "이름": d["place_name"],
            "주소": d["road_address_name"] or d["address_name"],  # 도로명이 비면 지번
            "시도": d["address_name"].split()[0], "위도": lat, "경도": lng, "전화": phone,
            "구분": KIND, "분류": d["category_name"], "카카오장소주소": d["place_url"],
            "데이터기준일자": today,
        })
    return pd.DataFrame(rows).drop_duplicates(subset=["이름", "주소"]).sort_values(["이름"]).reset_index(drop=True)


if __name__ == "__main__":
    today = datetime.now(ZoneInfo("Asia/Seoul")).strftime("%Y-%m-%d")
    try:
        found, calls = collect()
    except RuntimeError as e:
        print(e)
        raise SystemExit(1)
    df = to_frame(found, today)
    print(f"카카오 검색 {calls}번 → 서울 목욕탕·사우나 {len(found)}곳 → 중복 뺀 {len(df)}곳")
    print(df.shape, "빈칸:", df.isna().sum().to_dict())
    print("분류별:", df["분류"].value_counts().to_dict())
    os.makedirs("data", exist_ok=True)
    df.to_csv(OUT, index=False, encoding="utf-8-sig")
    print(f"저장: {OUT} (기준일 {today})")
    print("출처: 카카오 로컬 API (키워드로 장소 검색)")
