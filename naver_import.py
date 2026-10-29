"""naver-crawl이 모은 업체별 JSON을 탕방용 CSV 한 장으로 정리한다. (수집이 아니라 정리 단계)

  입력: C:/Users/user/naver-crawl/out/<업체ID>.json  (원자료, 이 스크립트는 읽기만 한다)
  출력: data/collected/naver_places.csv  (네이버ID 하나당 1줄, 같은 장소는 1줄로)

중복이 생기지 않게 하는 규칙
  1) 네이버ID가 열쇠. 같은 ID는 가장 늦게 수집한 1건만 쓴다.
  2) 서로 다른 ID라도 이름+주소가 같으면 같은 장소로 보고 1줄만 남긴다(광고·분점 중복 방지).
  3) 서울 주소가 아닌 곳은 뺀다.
  4) 탕방 목록(onsen_merged.csv)의 카카오ID에 붙일 때 일대일만 허용한다.
     한 카카오ID에 여러 네이버 줄이 걸리면 붙이지 않고 '충돌'로 센다(데이터가 두 번 읽히지 않게).
"""
import glob
import json
import os
import re

import pandas as pd

from export_web_data import _addr_key, _name_key

SRC = "C:/Users/user/naver-crawl/out"
MERGED = "data/merged/onsen_merged.csv"
OUT = "data/collected/naver_places.csv"
SKIP = {"index.json", "queue.json"}
PHONE = re.compile(r"0\d{1,2}-?\d{3,4}-?\d{4}")  # 글 속 번호는 지운다
ROAD = re.compile(r"(\S+구)\s+(\S+(?:로|길)(?:\d+길)?)\s+(\d+(?:-\d+)?)")


def addr_id(addr):
    """주소를 '구|도로명|번지'까지만 줄여 비교한다. 네이버 주소 뒤의 층·건물명·'지도내비게이션' 같은 군더더기를 버린다."""
    m = ROAD.search(addr)
    return "|".join(m.groups()) if m else _addr_key(addr)




def load():
    rows = []
    for f in glob.glob(SRC + "/*.json"):
        b = os.path.basename(f)
        if b in SKIP or b.startswith("probe") or not re.fullmatch(r"\d+\.json", b):
            continue
        rows.append(json.load(open(f, encoding="utf-8")))
    return rows


def flat(r):
    hints = []
    for tab in ("home", "information", "review/visitor"):
        hints += (r.get("hints") or {}).get(tab, [])
    hints = list(dict.fromkeys(PHONE.sub("", h).strip() for h in hints))  # 순서 유지하며 중복 제거
    return {
        "네이버ID": str(r["id"]),
        "이름": r.get("name") or "",
        "주소": r.get("address") or "",
        "결제수단": r.get("payment") or "",
        "편의시설": " | ".join(r.get("amenities") or []),
        "가격표항목수": len(r.get("prices") or []),
        "가격표이미지만": bool(r.get("price_image_only")),
        "세신·수건·결제 관련 글": " / ".join(hints),
        "수집일": (r.get("collectedAt") or "")[:10],
    }


def main():
    raw = load()
    print(f"읽은 업체 JSON {len(raw)}개 (조건: {SRC}/숫자.json)")
    df = pd.DataFrame([flat(r) for r in raw])
    print("shape", df.shape, "/ 빈칸", df.isna().sum().sum())

    n0 = len(df)
    df = df.sort_values("수집일").drop_duplicates("네이버ID", keep="last")
    print(f"같은 네이버ID 중복 제거: {n0 - len(df)}줄")

    n1 = len(df)
    df = df[df["주소"].str.startswith("서울")]
    print(f"서울 아닌 주소 제외: {n1 - len(df)}줄")

    df["_k"] = df["이름"].map(_name_key) + "|" + df["주소"].map(addr_id)
    n2 = len(df)
    df = df.sort_values("수집일").drop_duplicates("_k", keep="last")
    print(f"이름+주소 같은 다른 ID 제거: {n2 - len(df)}줄")

    # 탕방 목록에 일대일로 붙이기
    m = pd.read_csv(MERGED, encoding="utf-8-sig", keep_default_na=False, dtype=str)
    m["_k"] = m["이름"].map(_name_key) + "|" + m["주소"].map(addr_id)
    key2id = {}
    for k, kid in zip(m["_k"], m["카카오ID"]):
        key2id.setdefault(k, set()).add(kid)
    df["카카오ID"] = df["_k"].map(lambda k: next(iter(key2id[k])) if k in key2id and len(key2id[k]) == 1 else "")
    clash = df[df["카카오ID"] != ""].groupby("카카오ID").size()
    clash_ids = set(clash[clash > 1].index)
    df.loc[df["카카오ID"].isin(clash_ids), "카카오ID"] = ""
    print(f"탕방 목록과 일대일로 붙음 {int((df['카카오ID'] != '').sum())}줄 / 못 붙음 {int((df['카카오ID'] == '').sum())}줄 / 충돌로 보류 {len(clash_ids)}곳")

    assert df["네이버ID"].is_unique and df[df["카카오ID"] != ""]["카카오ID"].is_unique
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    df.drop(columns="_k").to_csv(OUT, index=False, encoding="utf-8-sig")
    has = (df["세신·수건·결제 관련 글"] != "").sum()
    print(f"저장: {OUT} {len(df)}줄 (관련 글이 있는 곳 {has}곳, 결제수단이 있는 곳 {(df['결제수단'] != '').sum()}곳)")


if __name__ == "__main__":
    main()
