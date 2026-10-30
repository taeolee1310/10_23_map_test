"""수집한 근거 문장(naver_home_facts.csv)으로 세신·수건·드라이기 등을 판정하고, 제외할 곳을 고른다.

원칙: 근거가 부족하거나 후기끼리 엇갈리면 '불명'으로 두고 추측하지 않는다. 오래된 근거만 있으면 신뢰도를 낮추고, 낮은 근거는 2건 이상 일치할 때만 쓴다.
출력(모두 다시 만들 수 있는 파일):
  data/collected/place_facts_auto.json   서비스용 자동 판정 (사람이 확인한 data/curated/place_facts.json이 항목별로 우선)
  data/collected/facts_judged.csv        곳마다 판정 결과·신뢰도 (불명 포함, 눈으로 검산용)
추가만 하는 파일 (기존 줄은 고치지 않는다):
  data/curated/excluded.csv              서비스에서 뺄 곳 (이름·주소·사유·근거)
사용: python scripts/judge_facts.py
"""
import json
import os
import re
import sys
from datetime import datetime
from zoneinfo import ZoneInfo

import pandas as pd

FACTS_CSV = "data/collected/naver_home_facts.csv"
MERGED = "data/merged/onsen_merged.csv"
CANDIDATES = "data/collected/excluded_candidates.csv"  # 이름으로 거른 피트니스 후보(확실/애매)
EXCLUDED = "data/curated/excluded.csv"
FOUND = "data/collected/naver_id_found.csv"  # scripts/find_naver_ids.py가 이름 검색으로 찾은 ID
OUT_FACTS = "data/collected/place_facts_auto.json"
OUT_JUDGED = "data/collected/facts_judged.csv"
TODAY = datetime.now(ZoneInfo("Asia/Seoul")).strftime("%Y-%m-%d")
EX_COLS = ["카카오ID", "이름", "주소", "사유", "근거", "확인일"]

FIT_STRONG = re.compile(r"휘트니스|피트니스|스포츠클럽|스포츠센터|짐$|짐 |GYM|gym|요가|필라테스|크로스핏|체육관")
FIT_PRICE = re.compile(r"트레이너|레슨|\bPT\b")  # '회원권'·'헬스'는 동네 목욕탕 가격표에도 흔해서 쓰지 않는다
MASSAGE = re.compile(r"마사지|테라피|아로마|스웨디시|왁싱|경락")
BATH_ITEM = re.compile(r"대인|성인|입욕|목욕|일반|주간|야간|사우나|찜질|한증")
SESHIN = re.compile(r"세신|때밀이|때\s*밀")
SESHIN_SKIP = re.compile(r"코스|\d+분|오일|마사지|테라피|임산부|소인|어린이|초등|아이")
WOMEN = re.compile(r"여탕|여자|여성|여\)|\(여|여사우나")
MEN = re.compile(r"남탕|남자|남성|남\)|\(남")
WORDNUM = {"한": 1, "하나": 1, "두": 2, "세": 3, "네": 4}


def read(path):
    return pd.read_csv(path, encoding="utf-8-sig", dtype=str).fillna("")


def price_items(text):
    """'세신(남) | 20,000 | 원 | ...' 한 줄을 (이름, 금액) 목록으로 푼다. '변동' 같은 글자 값은 버린다."""
    tok = [t.strip() for t in text.split("|")]
    out, i = [], 0
    while i < len(tok) - 2:
        if tok[i + 2] == "원" and re.fullmatch(r"[\d,]+", tok[i + 1]):
            out.append((tok[i], int(tok[i + 1].replace(",", ""))))
            i += 3
        else:
            i += 1
    return out


def sentences_of(cell):
    """'[출처] 문장 ‖ [출처] 문장' → (신뢰도, 출처, 문장). 신뢰도: high=업체등록, mid=최근 1년 블로그, low=오래된 블로그·방문자 후기(날짜 없음)."""
    out = []
    for part in filter(None, cell.split(" ‖ ")):
        m = re.match(r"\[(.+?)\] (.*)", part)
        if not m:
            continue
        label, s = m.groups()
        if label.startswith("업체등록"):
            rel = "high"
        else:
            d = re.search(r"(20\d\d)년 (\d{1,2})월", label)
            rel = "mid" if d and (int(d.group(1)), int(d.group(2))) >= (2025, 11) else "low"
        out.append((rel, label, s))
    return out


def decide(votes):
    """votes: [(값, 신뢰도, 출처)]. 높음·중간 근거가 있으면 그것만, 없으면 낮은 근거가 2건 이상 일치할 때만. 서로 다르면 None(모순)."""
    good = [v for v in votes if v[1] in ("high", "mid")]
    use = good if good else votes
    if not use:
        return None, ""
    vals = {json.dumps(v[0], sort_keys=True) for v in use}
    if len(vals) > 1:
        return None, "모순"
    if not good and len(use) < 2:
        return None, "근거 1건(낮음)"
    best = "높음" if any(v[1] == "high" for v in use) else ("중간" if good else "낮음")
    return use[0][0], f"{best}·{use[0][2][:18]}"


def judge_seshin(row):
    men, women, neutral = set(), set(), set()
    for name, price in price_items(row["가격표"]):
        if not SESHIN.search(name) or SESHIN_SKIP.search(name):
            continue
        (men if "남" in name else women if "여" in name else neutral).add(price)
    if men and women:
        full = men | women
        return (next(iter(full)), "높음·가격표") if len(full) == 1 else (None, "남녀 금액이 달라 뺌")
    if men or women:
        return None, "한쪽 성별만"
    if len(neutral) == 1:
        return next(iter(neutral)), "높음·가격표"
    return None, "가격표에 세신 없음" if not neutral else "세신 항목이 여럿"


def judge_hairdryer(row):
    votes = []
    for rel, label, s in sentences_of(row["드라이기근거"]):
        if "드라이" not in s or re.search(r"드라이\S*\s?(는|도)?\s?없", s):
            continue
        free = re.search(r"드라이\S*.{0,12}(무료|공짜)|(무료|공짜).{0,12}드라이", s)
        paid = re.search(r"드라이\S*.{0,12}(유료|\d+원|동전|코인)|(유료|\d+원|동전|코인).{0,12}드라이", s)
        if bool(free) != bool(paid):
            votes.append(({"paid": bool(paid)}, rel, label))
    return decide(votes)


def judge_towel(row):
    votes = {"women": [], "men": []}
    for rel, label, s in sentences_of(row["수건근거"]):
        if "수건" not in s or re.search(r"충분|필요|여쭤|몇 ?장|원하|추가|더 ", s):
            continue  # 개인 취향·선택·추가 요금 문장은 안내가 아니라서 쓰지 않는다
        w, m = bool(WOMEN.search(s)), bool(MEN.search(s))
        if w == m:
            continue  # 성별을 알 수 없거나 둘 다 말한 문장은 쓰지 않는다
        cnt = re.search(r"수건\D{0,8}?(\d+|한|두|세|네)\s?(장|개)|(\d+|한|두|세|네)\s?(장|개)\D{0,4}수건", s)
        if cnt:
            n = next(g for g in (cnt.group(1), cnt.group(3)) if g)
            val = {"mode": "limited", "count": int(n) if n.isdigit() else WORDNUM[n]}
        elif re.search(r"수건.{0,10}(무제한|마음껏|자유롭게|셀프)", s):
            val = {"mode": "unlimited"}
        else:
            continue
        votes["women" if w else "men"].append((val, rel, label))
    out, note = {}, []
    for g, v in votes.items():
        val, why = decide(v)
        if val:
            out[g] = val
            note.append(f"{g}:{why}")
    return out, " / ".join(note) or "근거 없음"


def judge_supplies(row):
    s_ok = b_ok = False
    for rel, label, s in sentences_of(row["샴푸근거"]):
        if rel == "low" or re.search(r"없|지참|챙겨|개인|유료|별도", s):
            continue
        if re.search(r"제공|구비|비치|준비|무료", s):
            s_ok |= "샴푸" in s
            b_ok |= "바디워시" in s
    return {k: True for k, v in (("shampoo", s_ok), ("bodywash", b_ok)) if v}


def exclusion_reasons(rows, merged):
    """제외할 곳: (카카오ID → (사유, 근거)). 폐업은 업체 영업 표시에 폐업·휴업이 직접 적힌 곳만 잡는다(정보가 비어 있다고 폐업으로 보지 않는다)."""
    ex = {}
    cand = read(CANDIDATES) if os.path.exists(CANDIDATES) else pd.DataFrame(columns=["카카오ID", "이름", "확신"])
    for r in cand.itertuples():
        if r.확신 == "확실" or FIT_STRONG.search(r.이름):
            ex[r.카카오ID] = ("피트니스·스포츠 시설", f"이름 기준({r.이름})")
    brands = merged["이름"].str.replace(r"\s*\S*점$", "", regex=True)
    chain = set(brands[brands.duplicated(keep=False)])
    for r in merged.itertuples():
        b = re.sub(r"\s*\S*점$", "", r.이름)
        if b in chain and FIT_STRONG.search(r.이름):
            ex.setdefault(r.카카오ID, ("피트니스 체인", f"같은 이름 {int((brands == b).sum())}곳({r.이름})"))
    if os.path.exists(FOUND):  # 이름 검색으로 이은 곳은 네이버에 올라 있는 이름도 본다
        for r in read(FOUND).itertuples():
            if r.결과 == "일치" and FIT_STRONG.search(r.네이버이름):
                ex.setdefault(r.카카오ID, ("피트니스·스포츠 시설", f"네이버 이름 기준({r.네이버이름})"))
    for r in rows.itertuples():
        items = price_items(r.가격표)
        mas = [n for n, _ in items if MASSAGE.search(n)]
        bath = [n for n, _ in items if BATH_ITEM.search(n)]
        ses = [n for n, _ in items if SESHIN.search(n) or re.search(r"때\(|미니때|VIP\s*때|기본때|^등$|^머리$", n)]
        # 세신은 마사지가 아니다: 세신 항목이 있으면 마사지가 여러 개여도 세신 중심으로 보고 남긴다
        if (len(mas) >= 3 and not ses) or (mas and not bath and len(items) <= 2):
            ex.setdefault(r.카카오ID, ("마사지 중심", f"가격표 {len(items)}개 중 마사지·테라피 {len(mas)}종, 세신 {len(ses)}종"))
        if FIT_PRICE.search(r.가격표):
            ex.setdefault(r.카카오ID, ("피트니스 시설", "가격표에 트레이너·레슨"))
        if re.search(r"폐업|휴업|영업 종료(?!.*에)", r.영업표시) and "에 영업 종료" not in r.영업표시:
            ex.setdefault(r.카카오ID, ("폐업·휴업", f"영업 표시: {r.영업표시}"))
    return ex


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    rows = read(FACTS_CSV)
    rows = rows[rows["상태"] == "ok"].drop_duplicates("카카오ID").reset_index(drop=True)
    merged = read(MERGED)
    print(f"판정 대상(상태 ok): {len(rows)}곳 / 합친 목록 {len(merged)}곳")

    ex = exclusion_reasons(rows, merged)
    try:
        old = read(EXCLUDED)
    except FileNotFoundError:
        old = pd.DataFrame(columns=EX_COLS)
    add = [dict(카카오ID=k, 이름=m.이름, 주소=m.주소, 사유=v[0], 근거=v[1], 확인일=TODAY)
           for m in merged.itertuples() for k, v in [(m.카카오ID, ex.get(m.카카오ID, (None, None)))]
           if v[0] and k not in set(old["카카오ID"])]
    pd.concat([old, pd.DataFrame(add, columns=EX_COLS)], ignore_index=True).to_csv(EXCLUDED, index=False, encoding="utf-8-sig")
    allx = pd.concat([old, pd.DataFrame(add, columns=EX_COLS)])
    print(f"제외 목록 {len(allx)}곳(이번에 추가 {len(add)}곳). 사유별:", allx["사유"].value_counts().to_dict())

    gone = set(allx["카카오ID"])
    facts, judged = {}, []
    for r in rows[~rows["카카오ID"].isin(gone)].to_dict("records"):
        f, note = {}, {}
        v, why = judge_seshin(r)
        if v:
            f["seshin"] = {"price_full": v}
        note["세신"] = f"{v:,}원 ({why})" if v else f"불명({why})"
        v, why = judge_hairdryer(r)
        if v:
            f["hairdryer"] = v
        note["드라이기"] = ("유료" if v["paid"] else "무료") + f" ({why})" if v else f"불명({why})"
        v, why = judge_towel(r)
        if v:
            f["towel"] = v
        note["수건"] = f"{json.dumps(v, ensure_ascii=False)} ({why})" if v else f"불명({why})"
        sup = judge_supplies(r)
        if sup:
            f["supplies"] = sup
        if r["영업표시"].startswith("24시간"):
            f["convenience"] = {"open_24h": True}
        if f:
            f["checked"] = r["수집일"]
            f["source"] = "네이버 플레이스 수집 자동 판정(근거 신뢰도는 facts_judged.csv)"
            facts[r["카카오ID"]] = f
        judged.append({"카카오ID": r["카카오ID"], "이름": r["이름"], **note,
                       "샴푸": "있음" if sup.get("shampoo") else "불명", "24시간": "예" if r["영업표시"].startswith("24시간") else ""})
    json.dump({"_설명": "scripts/judge_facts.py가 만든다. 사람이 확인한 data/curated/place_facts.json이 항목별로 우선한다.",
               "places": facts}, open(OUT_FACTS, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    pd.DataFrame(judged).to_csv(OUT_JUDGED, index=False, encoding="utf-8-sig")
    j = pd.DataFrame(judged)
    print(f"판정한 곳 {len(j)}곳 → 값이 하나라도 나온 곳 {len(facts)}곳")
    for k in ("세신", "드라이기", "수건"):
        print(f"  {k}: 값 있음 {int((~j[k].str.startswith('불명')).sum())}곳 / 불명 {int(j[k].str.startswith('불명').sum())}곳")


if __name__ == "__main__":
    main()
