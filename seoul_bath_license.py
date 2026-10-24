"""서울시 목욕장업 인허가(영업 중)에서 카카오 목록에 없는 목욕탕을 찾아 data/seoul_bath_license_clean.csv로 저장한다.

인허가 자료(data/seoul_bath_license_raw.csv)는 서울 열린데이터광장 LOCALDATA_114401 API로 받은 것이다. 좌표가 없어서 카카오 주소→좌표로 채운다.
좌표 채우기는 한 번에 최대 30줄(GEO_LIMIT). 한 번 찾은 주소는 data/seoul_bath_license_geo.csv에 남겨 두므로 여러 번 돌리면 이어서 채운다.
"""
import os
import re
import time
from datetime import datetime
from zoneinfo import ZoneInfo

import pandas as pd

from geo import address_to_coord  # 🔌 카카오 주소→좌표 (geo.py의 API 한 곳을 쓴다)

RAW = "data/seoul_bath_license_raw.csv"
MERGED = "data/onsen_merged.csv"
GEO_CACHE = "data/seoul_bath_license_geo.csv"
OUT = "data/seoul_bath_license_clean.csv"
GEO_LIMIT = 30
KINDS = ("공동탕업", "찜질시설서비스영업", "한증막업")  # '목욕장업 기타'(세신샵·피트니스 등)는 목욕탕이 아니어서 뺀다


def road_key(s):
    return re.sub(r"\(.*?\)|\s|,.*", "", re.sub(r"^서울(특별시)?", "", s))[:20]


def name_key(s):
    return re.sub(r"\(.*?\)|㈜|주식회사|\s|사우나|대중|목욕탕|탕|찜질방", "", s)


def candidates():
    lic = pd.read_csv(RAW, encoding="utf-8-sig", dtype=str).fillna("")
    lic = lic[(lic["TRDSTATENM"] == "영업/정상") & lic["UPTAENM"].str.contains("|".join(KINDS))]
    m = pd.read_csv(MERGED, encoding="utf-8-sig", dtype=str).fillna("")
    m = m[m["시도"] == "서울특별시"]
    roads, names = set(m["주소"].map(road_key)), set(zip(m["시군구"], m["이름"].map(name_key)))

    def known(r):
        t = r["RDNWHLADDR"].split()
        return road_key(r["RDNWHLADDR"]) in roads or (t[1] if len(t) > 1 else "", name_key(r["BPLCNM"])) in names

    return lic[~lic.apply(known, axis=1)].reset_index(drop=True), len(lic)


def fill_coords(addrs):
    cache = {}
    if os.path.exists(GEO_CACHE):
        g = pd.read_csv(GEO_CACHE, encoding="utf-8-sig", dtype=str).fillna("")
        cache = {r["주소"]: (r["위도"], r["경도"]) for r in g.to_dict("records")}
    todo = [a for a in dict.fromkeys(addrs) if a not in cache][:GEO_LIMIT]
    stopped = None
    for a in todo:
        try:
            c = address_to_coord(a)
        except RuntimeError as e:  # ⛔로 시작하는 에러가 나면 바로 멈춘다
            stopped = str(e)
            break
        cache[a] = ("", "") if c is None else (str(c[0]), str(c[1]))
        time.sleep(0.1)
    pd.DataFrame([{"주소": a, "위도": v[0], "경도": v[1]} for a, v in cache.items()]).to_csv(GEO_CACHE, index=False, encoding="utf-8-sig")
    return cache, len(todo), stopped


if __name__ == "__main__":
    today = datetime.now(ZoneInfo("Asia/Seoul")).strftime("%Y-%m-%d")
    cand, n_lic = candidates()
    print(f"영업 중 목욕탕류 {n_lic}곳(조건: 영업/정상, {'·'.join(KINDS)}) 중 카카오 목록에 없는 곳 {len(cand)}곳")
    cand["주소"] = cand["RDNWHLADDR"].str.replace(r",.*?(\(.*\))?$", "", regex=True).str.strip()
    cache, n_done, stopped = fill_coords(cand["주소"])
    if stopped:
        print(stopped)
    left = sum(1 for a in cand["주소"] if a not in cache)
    print(f"이번에 좌표 조회 {n_done}줄 (한도 {GEO_LIMIT}), 아직 안 한 곳 {left}곳 → 더 채우려면 다시 실행")

    rows = []
    for r in cand.to_dict("records"):
        lat, lng = cache.get(r["주소"], ("", ""))
        if not lat:
            continue
        phone = r["SITETEL"].strip()
        rows.append({
            "카카오ID": "lic" + r["MGTNO"], "이름": r["BPLCNM"], "주소": r["RDNWHLADDR"].split(",")[0] if r["RDNWHLADDR"] else r["SITEWHLADDR"],
            "시도": "서울특별시", "시군구": r["RDNWHLADDR"].split()[1], "위도": float(lat), "경도": float(lng),
            "전화": "" if phone.startswith("010") else phone, "구분": "목욕탕·사우나", "분류": "서울시 인허가 " + r["UPTAENM"],
            "카카오장소주소": "", "데이터기준일자": today,
        })
    df = pd.DataFrame(rows)
    df.to_csv(OUT, index=False, encoding="utf-8-sig")
    print(df.shape, f"저장: {OUT}")
    print("출처: 서울 열린데이터광장 서울시 목욕장업 인허가 정보(LOCALDATA_114401), 카카오 로컬 API(주소→좌표)")
