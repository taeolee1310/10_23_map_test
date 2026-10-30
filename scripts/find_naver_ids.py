"""네이버 ID가 없는 곳을 이름으로 검색해 ID를 찾고, 주소·업종이 맞으면 홈 페이지를 같이 수집한다.

- 대상: data/merged/onsen_merged.csv 중 naver_places.csv·naver_match_manual.csv·이 스크립트가 이미 찾은 곳에 없는 곳
- 후보 채택 조건: 후보 페이지의 주소에 우리 목록의 도로명 주소(구 이후)가 들어 있고, (이름이 비슷하거나 업종이 목욕·사우나·찜질·스파·온천)일 때만.
  같은 건물의 다른 가게를 잘못 잇지 않으려는 것이다. 못 맞추면 '못 찾음'으로 남기고 추측하지 않는다.
- 저장: data/collected/naver_id_found.csv(찾은 결과·못 찾음), 맞은 곳의 홈 수집 결과는 naver_home_facts.csv에 추가(collect_home.py와 같은 칸).
- 요청 제한: 한 세션, 요청마다 --sleep(기본 10초), 한 번에 --max개 요청, 연속 3회 실패하면 멈춤. 다시 돌리면 처리한 곳은 건너뜀.
사용(프로젝트 폴더에서): python scripts/find_naver_ids.py [--max 120] [--sleep 10]
"""
import argparse
import difflib
import os
import re
import sys
import time
from datetime import datetime
from urllib.parse import quote
from zoneinfo import ZoneInfo

import pandas as pd
from scrapling.fetchers import StealthySession

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import collect_home as ch  # noqa: E402  (parse·COLS·BLOCK·OUT를 그대로 쓴다)

FOUND = "data/collected/naver_id_found.csv"
FCOLS = ["카카오ID", "이름", "주소", "네이버ID", "네이버이름", "네이버주소", "결과", "확인일"]
BATH = re.compile(r"목욕|사우나|찜질|온천|한증")  # 네이버 업종 기준. '스파'·'피부' 업종은 마사지·미용이라 뺀다


def read(path):
    return pd.read_csv(path, encoding="utf-8-sig", dtype=str).fillna("")


def addr_tail(addr):
    a = re.sub(r"\(.*?\)", "", addr)
    a = re.sub(r"^서울(특별시)?\s*\S+구\s*", "", a)
    return re.sub(r"\s+", "", a)


def norm_name(n):
    return re.sub(r"\(주\)|주식회사|\s+", "", n)


def naver_name_addr(text):
    m = re.search(r"마이플레이스\n(.+?)\n", text)
    a = re.search(r"\n주소\n(.+?)\n", text)
    return (m.group(1) if m else ""), (a.group(1) if a else "")


def valid(page, text):
    return page.status == 200 and "마이플레이스" in text and "주소" in text


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--max", type=int, default=120)
    ap.add_argument("--sleep", type=float, default=10.0)
    a = ap.parse_args()
    today = datetime.now(ZoneInfo("Asia/Seoul")).strftime("%Y-%m-%d")

    m = read("data/merged/onsen_merged.csv")
    have = set(read("data/collected/naver_places.csv")["카카오ID"]) | set(read("data/curated/naver_match_manual.csv")["카카오ID"])
    found = read(FOUND) if os.path.exists(FOUND) else pd.DataFrame(columns=FCOLS)
    done_ids = set(found["카카오ID"])
    todo = m[~m["카카오ID"].isin(have | done_ids) & (m["카카오ID"] != "")].reset_index(drop=True)
    facts = read(ch.OUT)
    facts_ids = set(facts["네이버ID"])
    print(f"합친 목록 {len(m)}곳 중 ID 없음·미처리 {len(todo)}곳 / 이번 실행 요청 상한 {a.max}개, 간격 {a.sleep}초")

    reqs = fails = 0

    def get(s, url):
        nonlocal reqs, fails
        reqs += 1
        try:
            page = s.fetch(url)
            text = page.get_all_text(separator="\n")
        except Exception as e:
            print(f"  요청 오류 {type(e).__name__}")
            fails += 1
            return None, ""
        time.sleep(a.sleep)
        if any(b in text for b in ch.BLOCK):
            print("⛔ 캡차·차단 낌새. 우회하지 않고 멈춥니다.")
            raise SystemExit
        return page, text

    with StealthySession(headless=True, network_idle=True, locale="ko-KR", timezone_id="Asia/Seoul") as s:
        for r in todo.to_dict("records"):
            if reqs >= a.max or fails >= 3:
                break
            q = f'{r["시군구"]} {norm_name(r["이름"])}'
            page, html = get(s, "https://m.search.naver.com/search.naver?query=" + quote(q))
            if page is None or page.status != 200:
                fails += 1
                print(f"실패 {r['이름']}: 검색 응답 이상")
                continue
            raw = page.html_content if hasattr(page, "html_content") else str(page)
            cands = list(dict.fromkeys(re.findall(r"/place/(\d{5,})", raw)))[:3]
            res = dict(카카오ID=r["카카오ID"], 이름=r["이름"], 주소=r["주소"], 네이버ID="", 네이버이름="", 네이버주소="", 결과="못 찾음", 확인일=today)
            for cid in cands:
                if reqs >= a.max:
                    break
                p2, t2 = get(s, f"https://m.place.naver.com/place/{cid}/home")
                if p2 is None or not valid(p2, t2):
                    fails += 1
                    continue
                fails = 0
                nn, na = naver_name_addr(t2)
                row = ch.parse(t2)
                same_addr = addr_tail(r["주소"]) and addr_tail(r["주소"]) in re.sub(r"\s+", "", na)
                similar = difflib.SequenceMatcher(None, norm_name(r["이름"]), norm_name(nn)).ratio() >= 0.5
                if same_addr and similar and BATH.search(row["네이버분류"]):  # 업종이 헬스장·모텔·예식장이면 같은 건물의 다른 가게다
                    res.update(네이버ID=cid, 네이버이름=nn, 네이버주소=na, 결과="일치")
                    if cid not in facts_ids:
                        full = dict.fromkeys(ch.COLS, "")
                        full.update(row, 카카오ID=r["카카오ID"], 네이버ID=cid, 이름=r["이름"], 수집일=today, 상태="ok")
                        facts = pd.concat([facts, pd.DataFrame([full])], ignore_index=True)
                        facts.to_csv(ch.OUT, index=False, encoding="utf-8-sig")
                        facts_ids.add(cid)
                    break
            found = pd.concat([found, pd.DataFrame([res])], ignore_index=True)
            found.to_csv(FOUND, index=False, encoding="utf-8-sig")
            print(f"{r['이름']} → {res['결과']} {res['네이버이름']}")
    if fails >= 3:
        print("⛔ 연속 3회 실패(요청 제한 가능성). 멈춥니다.")
    left = len(todo) - len(set(found["카카오ID"]) & set(todo["카카오ID"]))
    print(f"이번 실행 요청 {reqs}개, 남은 곳 {left}곳")


if __name__ == "__main__":
    main()
