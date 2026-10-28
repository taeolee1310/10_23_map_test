"""행안부 온천 목록(onsen_official_clean.csv)과 카카오 온천 목록(onsen_clean.csv)을 합쳐 data/onsen_merged.csv로 저장한다.

같은 곳 판단: ① 주소(괄호·공백 뺀 글자)가 같거나 ② 시군구가 같고 이름(괄호·(주) 뺀 글자)이 같을 때.
같은 곳이면 이름·주소·시도는 행안부 것, 좌표·구분·카카오 정보는 카카오 것을 쓴다.
행안부에만 있는 곳은 좌표가 비어 있다. (카카오로 채우는 건 30줄 한도 규칙이 있어 따로 한다)
"""
import os
import re

import pandas as pd

from onsen_official import SIDO, sigungu_of

OFFICIAL = "data/onsen_official_clean.csv"
KAKAO = "data/onsen_clean.csv"
SEOUL_BATH = "data/seoul_bath_clean.csv"  # 선택. 없으면 온천만 합친다
SEOUL_LICENSE = "data/seoul_bath_license_clean.csv"  # 선택. 서울시 인허가에만 있는 목욕탕 (seoul_bath_license.py)
OUT = "data/onsen_merged.csv"
EXCLUDE = "data/naver_notfound_exclude.csv"  # 네이버 플레이스에서 못 찾아 뺀 곳 (이름+주소로 맞춤)

COLUMNS = ["이름", "시도", "시군구", "주소", "위도", "경도", "전화", "구분", "분류",
           "카카오ID", "카카오장소주소", "출처", "데이터기준일자"]


def key_addr(s):
    return re.sub(r"\(.*?\)|\s", "", s)


def key_name(s):
    return re.sub(r"\(.*?\)|㈜|주식회사|\s", "", s)


def read(path):
    return pd.read_csv(path, encoding="utf-8-sig", keep_default_na=False, dtype={"카카오ID": str})


def prepare_kakao(k):
    tokens = k["주소"].str.split()
    first = tokens.str[0]
    k["시도"] = first.map(SIDO).fillna(first)
    k["시군구"] = tokens.map(sigungu_of)
    k["주소"] = k["시도"] + " " + tokens.map(lambda t: " ".join(t[1:]))
    return k


def merge(o, k):
    o = o.copy()
    k = prepare_kakao(k.copy())
    k["_a"], k["_n"] = k["주소"].map(key_addr), k["이름"].map(key_name)
    by_addr = dict(zip(k["_a"], k.index))
    by_name = {}
    for idx, row in k.iterrows():
        by_name.setdefault((row["시군구"], row["_n"]), idx)

    used, rows = set(), []
    for _, r in o.iterrows():
        idx = by_addr.get(key_addr(r["주소"]))
        if idx is None:
            idx = by_name.get((r["시군구"], key_name(r["이름"])))
        if idx is not None and idx in used:
            idx = None  # 카카오 한 곳이 행안부 두 곳에 붙지 않게 한다
        row = {c: r.get(c, "") for c in ["이름", "시도", "시군구", "주소", "전화", "데이터기준일자"]}
        row.update({"위도": None, "경도": None, "구분": "", "분류": "", "카카오ID": "", "카카오장소주소": ""})
        row["출처"] = "행안부"
        if idx is not None:
            used.add(idx)
            kr = k.loc[idx]
            row.update({c: kr[c] for c in ["위도", "경도", "구분", "분류", "카카오ID", "카카오장소주소"]})
            row["전화"] = r["전화"] or kr["전화"]
            row["출처"] = "행안부+카카오"
        rows.append(row)

    for idx, kr in k.iterrows():
        if idx not in used:
            row = {c: kr[c] for c in COLUMNS if c != "출처"}
            row["출처"] = "카카오"
            rows.append(row)

    df = pd.DataFrame(rows)[COLUMNS]
    return df.sort_values(["시도", "시군구", "이름"]).reset_index(drop=True)


if __name__ == "__main__":
    o, k = read(OFFICIAL), read(KAKAO)
    print(f"행안부 {len(o)}곳, 카카오 {len(k)}곳")
    df = merge(o, k)
    for path, source in ((SEOUL_BATH, "카카오"), (SEOUL_LICENSE, "서울시 인허가")):  # 카카오ID가 이미 있는 곳은 넘긴다
        if os.path.exists(path):
            sb = read(path)
            sb = sb[~sb["카카오ID"].isin(df["카카오ID"])].assign(출처=source)
            df = pd.concat([df, sb[COLUMNS]], ignore_index=True).sort_values(["시도", "시군구", "이름"]).reset_index(drop=True)
            print(f"{path}에서 {len(sb)}곳 추가")
    if os.path.exists(EXCLUDE):
        ex = read(EXCLUDE)
        key = df["이름"] + "|" + df["주소"]
        gone = key.isin(ex["이름"] + "|" + ex["주소"])
        print(f"{EXCLUDE}에 있어서 뺀 곳 {int(gone.sum())}곳 (조건: 이름+주소 일치)")
        df = df[~gone].reset_index(drop=True)
    df = df[df["주소"].str.startswith("서울")].reset_index(drop=True)  # 서비스는 서울만 (멘토 피드백)
    print(df.shape)
    print("출처별 (조건: 합친 전체):", df["출처"].value_counts().to_dict())
    print("좌표 있는 곳:", int(df["위도"].notna().sum()), "/ 좌표 없는 곳:", int(df["위도"].isna().sum()))
    print("시도별:", df["시도"].value_counts().to_dict())
    df.to_csv(OUT, index=False, encoding="utf-8-sig")
    print(f"저장: {OUT}")
    print("출처: 행정안전부 전국 온천이용업소 현황(기준일 2026-08-27), 카카오 로컬 API")
