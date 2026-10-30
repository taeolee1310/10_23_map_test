"""네이버 플레이스 홈 페이지에서 TOP3(수건·세신·드라이기)와 보조 정보 근거를 모은다.

- 대상: data/merged/onsen_merged.csv 중 네이버ID가 있는 곳 (naver_places.csv + curated/naver_match_manual.csv)
- 저장: data/collected/naver_home_facts.csv (utf-8-sig). 이미 받은 네이버ID는 건너뛴다(이어받기).
- 방문자 리뷰는 작성자 이름·원문을 저장하지 않고, 키워드가 든 문장만 '방문자리뷰(날짜없음)'으로 남긴다.
- 캡차·차단 낌새가 있거나 연속 실패하면 우회하지 않고 멈춘다.
사용(프로젝트 폴더에서): python scripts/collect_home.py [--gu 강남구] [--limit 3] [--sleep 10] [--max 150]
다음 단계: python scripts/judge_facts.py → python onsen_merge.py → python export_web_data.py
"""
import argparse
import re
import sys
import time
from datetime import datetime
from zoneinfo import ZoneInfo

import pandas as pd
from scrapling.fetchers import StealthySession

OUT = "data/collected/naver_home_facts.csv"
KEYS = {
    "수건": ["수건", "타월", "타올"],
    "세신": ["세신", "때밀이", "때 밀"],
    "드라이기": ["드라이", "헤어드라이", "바디드라이"],
    "샴푸": ["샴푸", "바디워시", "어메니티"],
    "탕": ["냉탕", "온탕", "열탕", "바데풀", "이벤트탕", "건식", "습식", "불한증막", "찜질"],
    "주차": ["주차"],
    "혼잡": ["붐비", "한적", "사람이 없", "혼잡", "대기"],
    "청결": ["깨끗", "깔끔", "청결", "위생", "지저분", "더러"],
}
CLOSED = ["폐업", "휴업", "영업 종료", "영업종료", "문 닫", "문닫", "이전했", "이전 했"]
DATE = re.compile(r"20\d\d년 \d{1,2}월 \d{1,2}일")
BLOCK = ["보안 확인", "자동입력 방지", "captcha", "비정상적인 접근", "접근이 제한"]
COLS = ["카카오ID", "네이버ID", "이름", "수집일", "상태", "네이버분류", "영업표시", "휴무", "가격표", "편의",
        "수건근거", "세신근거", "드라이기근거", "샴푸근거", "탕근거", "주차근거", "혼잡근거", "청결근거",
        "폐업언급", "사진URL", "블로그날짜"]


def sentences(text):
    return [s.strip() for s in re.split(r"(?<=[.!?。])\s+|\n+", text) if s.strip()]


def evidence(chunk, source, words):
    out = []
    for s in sentences(chunk):
        if any(w in s for w in words) and len(s) < 260:
            out.append(f"[{source}] {s}")
    return out[:4]


def parse(text):
    tail = text.split("로딩중")[0]
    head, _, rest = tail.partition("방문자 리뷰")
    if rest:
        review, _, blog = rest.partition("블로그 리뷰")
    else:
        head, _, blog = tail.partition("블로그 리뷰")
        review = ""
    row = {}
    m = re.search(r"마이플레이스\n.+?\n(.+?)\n", head)
    row["네이버분류"] = m.group(1) if m else ""
    m = re.search(r"영업시간\n(.+?)\n(?:펼쳐보기|전화번호)", head, re.S)
    row["영업표시"] = " / ".join(m.group(1).split("\n")) if m else ""
    m = re.search(r"(매[^\n]*휴무|연중무휴|[월화수목금토일]요일 휴무|정기 ?휴무[^\n]*)", head)
    row["휴무"] = m.group(1) if m else ""
    m = re.search(r"가격표\n(.+?)\n(?:가격표 이미지로 보기|블로그|인스타그램|편의)", head, re.S)
    row["가격표"] = " | ".join(m.group(1).split("\n")).replace("\n", " ") if m else ""
    m = re.search(r"편의\n(.+?)\n", head)
    row["편의"] = m.group(1) if m else ""
    # 블로그 글은 날짜가 보이는 항목만 날짜와 함께 근거로 쓴다
    posts = re.split(r"(20\d\d년 \d{1,2}월 \d{1,2}일 [월화수목금토일]요일)", blog)
    dated = []
    for i in range(0, len(posts) - 1, 2):
        dm = DATE.search(posts[i + 1])
        dated.append((dm.group(0) if dm else "", posts[i]))
    row["블로그날짜"] = ",".join(sorted({d for d, _ in dated if d}, reverse=True)[:5])
    for k, words in KEYS.items():
        ev = []
        for d, body in sorted(dated, key=lambda x: x[0], reverse=True):
            ev += evidence(body, f"블로그 {d}", words)
        ev += evidence(review, "방문자리뷰(날짜없음)", words)
        ev += evidence(head, "업체등록", words)
        row[f"{k}근거"] = " ‖ ".join(ev[:6])
    row["폐업언급"] = " ‖ ".join(evidence(review + "\n" + blog, "리뷰·블로그", CLOSED)[:3])
    top = re.sub(r"\d{1,2}(?::\d{2}|시 ?\d{0,2}분?)에 영업 종료", "", head[:200])
    if "영업 종료" in top or "폐업" in top or "휴업" in top:
        row["폐업언급"] = ("[업체 헤더] " + head[:80].replace("\n", " ") + " ‖ " + row["폐업언급"]).strip(" ‖")
    return row


def targets(gu, limit):
    m = pd.read_csv("data/merged/onsen_merged.csv", encoding="utf-8-sig", dtype=str)
    n = pd.read_csv("data/collected/naver_places.csv", encoding="utf-8-sig", dtype=str)
    mm = pd.read_csv("data/curated/naver_match_manual.csv", encoding="utf-8-sig", dtype=str)
    ids = pd.concat([n[["카카오ID", "네이버ID"]], mm[["카카오ID", "네이버ID"]]]).dropna().drop_duplicates("카카오ID")
    t = m.merge(ids, on="카카오ID", how="inner")
    try:
        ex = pd.read_csv("data/collected/excluded_candidates.csv", encoding="utf-8-sig", dtype=str)
        sure = set(ex.loc[ex["확신"] == "확실", "카카오ID"])
        print(f"제외 후보(확실) {len(sure)}곳은 수집에서 뺌")
        t = t[~t["카카오ID"].isin(sure)]
    except FileNotFoundError:
        pass
    print(f"목록 {len(m)}곳 중 네이버ID 있음 {len(t)}곳 (없는 {len(m) - len(t)}곳은 건너뜀)")
    if gu:
        t = t[t["주소"].str.contains(gu, na=False)]
        print(f"조건: 주소에 '{gu}' 포함 → {len(t)}곳")
    return t.head(limit) if limit else t


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--gu")
    ap.add_argument("--limit", type=int)
    ap.add_argument("--sleep", type=float, default=10.0)
    ap.add_argument("--max", type=int, default=150)
    a = ap.parse_args()
    t = targets(a.gu, a.limit)
    try:
        done = pd.read_csv(OUT, encoding="utf-8-sig", dtype=str)
    except FileNotFoundError:
        done = pd.DataFrame(columns=COLS)
    seen = set(done["네이버ID"])
    t = t[~t["네이버ID"].isin(seen)]
    print(f"이어받기: 이미 받은 {len(seen)}곳 제외 → 이번에 {len(t)}곳")
    today = datetime.now(ZoneInfo("Asia/Seoul")).strftime("%Y-%m-%d")
    # 요청 제한을 피해 가지 않는다: 세션은 하나, 곳당 간격은 --sleep(기본 10초), 한 번에 --max곳까지.
    # 페이지가 비어 읽히면 그 곳은 기록하지 않고, 연속 3번이면 바로 멈춘다(다음 실행에서 이어받기).
    queue = list(t.itertuples(index=False))[: a.max]
    print(f"이번 실행 상한 {a.max}곳, 곳당 간격 {a.sleep}초 → {len(queue)}곳")
    fails = 0
    with StealthySession(headless=True, network_idle=True, locale="ko-KR", timezone_id="Asia/Seoul") as s:
        for i, r in enumerate(queue, 1):
            url = f"https://m.place.naver.com/place/{r.네이버ID}/home"
            row = dict.fromkeys(COLS, "")
            row.update(카카오ID=r.카카오ID, 네이버ID=r.네이버ID, 이름=r.이름, 수집일=today)
            try:
                page = s.fetch(url)
                text = page.get_all_text(separator="\n")
            except Exception as e:
                print(f"실패 {r.이름} 오류 {type(e).__name__}")
                fails += 1
            else:
                if any(b in text for b in BLOCK):
                    print(f"⛔ 캡차·차단 낌새 ({r.이름}). 우회하지 않고 멈춥니다.")
                    return
                if page.status != 200 or "마이플레이스" not in text or "주소" not in text:
                    print(f"실패 {r.이름} status={page.status}")
                    fails += 1
                else:
                    row.update(parse(text))
                    row["상태"] = "ok"
                    done = pd.concat([done, pd.DataFrame([row])], ignore_index=True)
                    done.to_csv(OUT, index=False, encoding="utf-8-sig")
                    fails = 0
                    print(f"{i}/{len(queue)} {r.이름} ok")
            if fails >= 3:
                print("⛔ 연속 3회 실패(요청 제한 가능성). 멈춥니다.")
                return
            time.sleep(a.sleep)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
