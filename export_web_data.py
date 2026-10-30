"""합친 온천 목록(onsen_merged.csv)에 가격·주차장을 붙여 React 화면용 web/public/data/onsen.json으로 저장한다.

지도·목록 화면은 이 JSON만 읽는다. 키는 들어가지 않는다. (REST 키는 이 파이프라인 어디에도 안 쓴다)
좌표가 없는 곳(행안부에만 있는 곳)은 위도·경도가 null이고, 화면에서 목록에만 나온다.
"""
import json
import os
import re

import pandas as pd

MERGED = "data/merged/onsen_merged.csv"
PARKING_FILE = "data/collected/onsen_parking.csv"  # 주차장 목록 (ego-lite로 수집)
PRICE_FILE = "data/curated/onsen_prices.csv"  # 확인된 가격만 사람이 적는다
TANGBANG_PRICES = "data/curated/tangbang_places_price_data.json"  # 요금 조사 자료(실측 확인 + 인근 평균 추정)
# 한국소비자원 참가격 '목욕(성인 일반대중탕 1회)' 서울 값. 기준월 미표기·잠정치라 추정으로만 쓴다.
SEOUL_REGION_PRICE = {"adult": 11000.0, "basis": "서울 일반 대중탕 지역 요금·참가격 잠정", "checked": "2026-10-24"}
PRICE_AUTO_FILE = "data/collected/price_auto.csv"  # scripts/judge_facts.py가 네이버 가격표에서 뽑은 입장료(다시 만들 수 있음)
AUTO_FACTS_FILE = "data/collected/place_facts_auto.json"  # scripts/judge_facts.py가 근거 문장으로 판정한 값(다시 만들 수 있음)
FACTS_FILE = "data/curated/place_facts.json"  # 사람이 직접 확인한 세부 정보(세신·수건·드라이기 등). 카카오ID가 열쇠
OUT = "web/public/data/onsen.json"
PRICE_COLS = ("성인_평일", "성인_주말", "수건", "주차", "어린이")

def none_if_nan(v):
    return None if pd.isna(v) else float(v)


def load_prices():
    """사람이 확인한 요금(PRICE_FILE)이 먼저, 그 곳에 없는 곳만 가격표 자동 판정(PRICE_AUTO_FILE)으로 채운다."""
    prices = {}
    for path in (PRICE_FILE, PRICE_AUTO_FILE):
        _read_prices(path, prices)
    return prices


def _read_prices(path, prices):
    if not os.path.exists(path):
        return
    pdf = pd.read_csv(path, encoding="utf-8-sig", dtype={"카카오ID": str})
    for col in PRICE_COLS:
        pdf[col] = pd.to_numeric(pdf[col].replace("무료", 0), errors="coerce")  # '무료'는 0원
    for r in pdf.to_dict("records"):
        if all(pd.isna(r[c]) for c in PRICE_COLS):
            continue  # 가격이 하나도 없는 줄은 '확인됨'으로 치지 않는다
        if r["카카오ID"] in prices:
            continue  # 이미 사람이 확인한 값이 있는 곳은 자동 값으로 덮지 않는다
        prices[r["카카오ID"]] = {
            "adult": none_if_nan(r["성인_평일"]),
            "weekend": none_if_nan(r["성인_주말"]),
            "towel": none_if_nan(r["수건"]),
            "parking": none_if_nan(r["주차"]),
            "child": none_if_nan(r["어린이"]),
            "jjimjil": None,
            "none": str(r.get("추가요금_없음확인", "")).strip().upper() in ("Y", "예", "O"),
            "memo": "" if pd.isna(r["메모"]) else str(r["메모"]),
            "source": "" if pd.isna(r["출처"]) else str(r["출처"]),
            "checked": "" if pd.isna(r["확인일"]) else str(r["확인일"]),
        }
    return prices


def _places(path):
    if not os.path.exists(path):
        return {}
    return json.load(open(path, encoding="utf-8-sig")).get("places", {})


def _overlay(auto, manual):
    """자동 판정 위에 사람이 확인한 값을 항목별로 덮는다(사람 값이 없는 항목은 자동 값이 남는다)."""
    out = dict(auto)
    for k, v in manual.items():
        out[k] = _overlay(out[k], v) if isinstance(v, dict) and isinstance(out.get(k), dict) else v
    if auto.get("source") and manual.get("source"):
        out["source"] = f'{manual["source"]} / {auto["source"]}'
    return out


def load_facts():
    """세부 정보. 사람이 확인한 값(FACTS_FILE)이 자동 판정(AUTO_FACTS_FILE)보다 우선한다. 파일에 없는 곳은 facts 키를 아예 넣지 않는다(추측으로 채우지 않는다)."""
    auto, manual = _places(AUTO_FACTS_FILE), _places(FACTS_FILE)
    return {kid: _overlay(auto.get(kid, {}), manual.get(kid, {})) for kid in {**auto, **manual}}


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


def _name_key(s):
    return re.sub(r"\(.*?\)|㈜|주식회사|\s", "", s)


def _addr_key(addr):
    """시·도 표기가 달라도(경기/경기도) 같게 비교하려고 첫 토큰을 빼고, 괄호·공백도 뺀다."""
    return re.sub(r"\(.*?\)|\s", "", " ".join(addr.split()[1:]))


def _sigungu(addr):
    t = addr.split()
    if len(t) > 2 and t[1].endswith("시") and t[2].endswith("구"):
        return f"{t[1]} {t[2]}"
    return t[1] if len(t) > 1 else ""


def load_tangbang_prices():
    """요금 조사 자료를 (이름, 주소) 열쇠로 모은다.
    price_status가 '실측확인완료'·'확인완료'면 확인된 요금, '근처 욕탕 요금 바탕 평균 추정가'면 추정(확인된 요금 아님)."""
    if not os.path.exists(TANGBANG_PRICES):
        return {}, {}
    rows = json.load(open(TANGBANG_PRICES, encoding="utf-8-sig"))
    by_addr, by_sigungu = {}, {}
    for r in rows:
        status = r["price_status"]
        confirmed = not status.startswith("근처")
        adult, child = none_if_nan(pd.to_numeric(r["adult_price"], errors="coerce")), none_if_nan(pd.to_numeric(r["child_price"], errors="coerce"))
        extra = none_if_nan(pd.to_numeric(r["jjimjil_extra"], errors="coerce"))
        basis = re.search(r"\(인근 (.+?) 기준\)", status)
        info = {"confirmed": confirmed, "adult": adult, "child": child, "jjimjil": extra,
                "basis": basis.group(1) if basis else "", "checked": str(r["last_updated"])}
        nk = _name_key(r["place_name"])
        for store, key in ((by_addr, (nk, _addr_key(r["address"]))), (by_sigungu, (nk, _sigungu(r["address"])))):
            old = store.get(key)
            if old is None or (info["confirmed"] and not old["confirmed"]):  # 같은 곳이 둘이면 확인된 쪽을 쓴다
                store[key] = info
    return by_addr, by_sigungu


def build():
    df = pd.read_csv(MERGED, encoding="utf-8-sig", keep_default_na=False, dtype=str)
    prices = load_prices()
    parking, radius = load_parking()
    facts = load_facts()
    tb_addr, tb_sigungu = load_tangbang_prices()
    sigungu_count = {}
    for r in df.to_dict("records"):
        k = (_name_key(r["이름"]), r["시군구"])
        sigungu_count[k] = sigungu_count.get(k, 0) + 1

    places = []
    for i, r in enumerate(df.to_dict("records")):
        if r["구분"] == "온천 숙박":  # 숙박 시설은 목욕탕 지도에서 뺀다(줄 번호 i는 그대로 두어 다른 곳의 id가 안 바뀐다)
            continue
        kid = r["카카오ID"]
        # 요금: ① 사람이 적은 확인값(onsen_prices.csv) ② 요금 조사 자료의 확인값. 추정값은 확인된 요금과 따로 둔다.
        price = prices.get(kid) if kid else None
        estimate = None
        hit = tb_addr.get((_name_key(r["이름"]), _addr_key(r["주소"])))
        if hit is None and sigungu_count.get((_name_key(r["이름"]), r["시군구"])) == 1:
            hit = tb_sigungu.get((_name_key(r["이름"]), r["시군구"]))  # 주소가 달라도 같은 시·군·구에 같은 이름이 하나뿐이면 같은 곳
        if hit and price is None:
            if hit["confirmed"]:
                price = {"adult": hit["adult"], "weekend": None, "towel": None, "parking": None, "child": hit["child"],
                         "jjimjil": hit["jjimjil"], "none": False, "memo": "", "source": "탕방 직접 확인", "checked": hit["checked"]}
            elif hit["adult"] is not None:
                estimate = {"adult": hit["adult"], "child": hit["child"], "basis": hit["basis"], "checked": hit["checked"]}
        if price is None and estimate is None and r["시도"] == "서울특별시" and r["구분"] == "목욕탕·사우나" and not any(w in r["분류"] for w in ("찜질", "한증막")):
            estimate = {"adult": SEOUL_REGION_PRICE["adult"], "child": None, "basis": SEOUL_REGION_PRICE["basis"], "checked": SEOUL_REGION_PRICE["checked"]}
        has_xy = r["위도"] != "" and r["경도"] != ""
        places.append({
            "id": kid or f"m{i}",  # 카카오ID가 없는 곳(행안부만)은 줄 번호로
            "name": r["이름"],
            "addr": r["주소"],
            "gu": r["시군구"],  # 서울 25개 구. 화면의 지역 필터가 쓴다
            "lat": float(r["위도"]) if has_xy else None,
            "lng": float(r["경도"]) if has_xy else None,
            "tel": r["전화"],
            "kind": r["구분"],
            "women_only": "여성" in r["이름"],  # 이름에 '여성'이 든 곳은 여성전용 배지
            "url": r["카카오장소주소"],
            "checked_at": r["데이터기준일자"],
            "source": r["출처"],
            "price": price,
            "price_estimate": estimate,
            "parking": parking.get(kid) if kid else None,  # None=조회 안 됨, []=반경 안에 없음
            "parking_radius": radius,
            **({"facts": facts[kid]} if kid in facts else {}),
        })
    return places


if __name__ == "__main__":
    places = build()
    no_xy = sum(1 for p in places if p["lat"] is None)
    print(f"온천 {len(places)}곳 (조건: onsen_merged.csv 전체) / 좌표 없는 곳 {no_xy}곳 / 확인된 요금 {sum(1 for p in places if p['price'])}곳 / 추정 요금 {sum(1 for p in places if p['price_estimate'])}곳")
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"baseDate": max(p["checked_at"] for p in places), "places": places}, f, ensure_ascii=False)
    print(f"저장: {OUT}")
    print("출처: 행정안전부 전국 온천이용업소 현황, 서울시 목욕장업 인허가 정보, 카카오 로컬 API")
