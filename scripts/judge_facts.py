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
OUT_PRICES = "data/collected/price_auto.csv"
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


REVIEWS = "data/collected/naver_reviews.jsonl"  # scripts/collect_reviews.mjs가 후기 탭에서 모은 키워드 문장(방문일 포함)
REVIEW_COLS = {"수건근거": ("수건", "타월", "타올"), "드라이기근거": ("드라이",), "샴푸근거": ("샴푸", "바디워시", "어메니티")}


def load_reviews():
    out = {}
    if os.path.exists(REVIEWS):
        for line in open(REVIEWS, encoding="utf-8"):
            r = json.loads(line)
            out[r["kakaoId"]] = r["reviews"]
    return out


def add_review_evidence(row, reviews):
    """후기 탭 근거를 방문일과 함께 근거 칸에 합친다. 홈 페이지의 날짜 없는 후기 문장은 같은 후기일 수 있어 중복으로 세지 않게 뺀다."""
    row = dict(row)
    for col, words in REVIEW_COLS.items():
        keep = [p for p in filter(None, row[col].split(" ‖ ")) if not p.startswith("[방문자리뷰(날짜없음)]")]
        new = []
        for rv in sorted(reviews, key=lambda x: x["date"], reverse=True):
            y, m, d = rv["date"].split("-")
            label = f"방문자리뷰 {y}년 {int(m)}월 {int(d)}일"
            new += [f"[{label}] {ln}" for ln in rv["lines"] if any(w in ln for w in words)]
        row[col] = " ‖ ".join(keep + new)
    return row


def closed_hints(reviews):
    """올해 후기에 폐업·휴업이 언급된 문장(검토용. 자동으로 제외하지 않는다)."""
    # 깃에 올라가는 파일이라 후기 문장은 적지 않고 날짜만 남긴다(문장은 로컬 naver_reviews.jsonl에서 찾는다)
    dates = sorted({rv["date"] for rv in reviews if rv["date"] >= "2026-01-01" for ln in rv["lines"] if re.search("폐업|휴업", ln)}, reverse=True)
    return "폐업·휴업 언급 후기 " + ", ".join(dates) if dates else ""


def decide(votes, allow_single=False):
    """votes: [(값, 신뢰도, 출처)]. 높음·중간 근거가 있으면 그것만, 없으면 낮은 근거가 2건 이상 일치할 때만(allow_single이면 1건도 '낮음'으로 씀). 서로 다르면 None(모순)."""
    good = [v for v in votes if v[1] in ("high", "mid")]
    use = good if good else votes
    if not use:
        return None, ""
    vals = {json.dumps(v[0], sort_keys=True) for v in use}
    if len(vals) > 1:
        return None, "모순"
    if not good and len(use) < 2:
        return (use[0][0], f"낮음·근거 1건·{use[0][2][:18]}") if allow_single else (None, "근거 1건(낮음)")
    best = "높음" if any(v[1] == "high" for v in use) else ("중간" if good else "낮음")
    return use[0][0], f"{best}·{use[0][2][:18]}"


def judge_seshin(row):
    men, women, neutral = set(), set(), set()
    for name, price in price_items(row["가격표"]):
        if not SESHIN.search(name) or SESHIN_SKIP.search(name):
            continue
        (men if "남" in name else women if "여" in name else neutral).add(price)
    if men and women:
        if len(men) == 1 and len(women) == 1:
            m, w = next(iter(men)), next(iter(women))
            return ({"price_full": m} if m == w else {"price_men": m, "price_women": w}), "높음·가격표"
        return None, "남녀 세신 항목이 여럿"
    if men or women:
        one = men or women
        return ({"price_men" if men else "price_women": next(iter(one))}, "높음·가격표(한쪽 성별)") if len(one) == 1 else (None, "세신 항목이 여럿")
    if len(neutral) == 1:
        return {"price_full": next(iter(neutral))}, "높음·가격표"
    return None, "가격표에 세신 없음" if not neutral else "세신 항목이 여럿"


def judge_hairdryer(row):
    votes = []
    for rel, label, s in sentences_of(row["드라이기근거"]):
        if "드라이" not in s or re.search(r"드라이\S*\s?(는|도)?\s?없", s):
            continue
        # '동전 없이 사용'·'돈 안 받아요'는 무료다. 문장에 '동전'이 있다는 이유로 유료로 읽지 않는다.
        no_charge = re.search(r"(동전|돈|요금|비용).{0,5}(없이|안\s?(받|내|들|넣)|필요\s?없)|그냥\s?(사용|쓸)", s)
        free = re.search(r"드라이\S*.{0,12}(무료|공짜)|(무료|공짜).{0,12}드라이", s) or no_charge
        paid = None if no_charge else re.search(r"드라이\S*.{0,12}(유료|\d+원|동전|코인|돈\s?받)|(유료|\d+원|동전|코인).{0,12}드라이", s)
        if bool(free) != bool(paid):
            votes.append(({"paid": bool(paid)}, rel, label))
    val, why = decide(votes, allow_single=True)
    if val and why.startswith("낮음"):
        val = {**val, "low": True}  # 화면에 '후기 1건 기준'이라고 밝힌다
    return val, why


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


CLOTHES = re.compile(r"찜질복|가운|까운|수면복|찜질옷")
CLOTHES_SKIP = re.compile(r"보증|세탁|분실|반납")
NIGHT = re.compile(r"야간|심야")
DAY = re.compile(r"주간")
ADULT = re.compile(r"대인|성인|일반|입욕|입장|사우나|목욕")
NOT_ADULT = re.compile(r"소인|어린이|유아|초등|학생|경로|청소년|미취학|찜질복|가운|까운|세신|회원|\d+매|\d+장|수면|룸|\d+세|개월|미만|이하|~|아동|소아|취학")  # 나이 범위가 든 항목은 성인 요금으로 보지 않는다
OVERTIME = re.compile(r"초과|연장")


def judge_fees(row):
    """가격표의 찜질복·야간 입장·시간 초과. 값이 하나로 정해지지 않으면 넣지 않는다. 야간 추가금은 (야간 − 주간)을 코드로 계산한다."""
    items = price_items(row["가격표"])
    fees = {}
    clothes = {p for n, p in items if CLOTHES.search(n) and not CLOTHES_SKIP.search(n)}
    if len(clothes) == 1:
        fees["clothes"] = next(iter(clothes))
    adult = [(n, p) for n, p in items if ADULT.search(n) and not NOT_ADULT.search(n)]
    day = {p for n, p in adult if DAY.search(n)}
    night = {p for n, p in adult if NIGHT.search(n)}
    if len(night) == 1:
        n = next(iter(night))
        if len(day) == 1 and n > next(iter(day)):
            fees["night"] = {"price": n, "extra": n - next(iter(day))}
        elif not day and n >= 5000:  # 주간 요금이 없고 5천 원 미만이면 추가금인지 총액인지 알 수 없어 뺀다
            fees["night"] = {"price": n}
    over = {(n, p) for n, p in items if OVERTIME.search(n)}
    if len(over) == 1:
        n, p = next(iter(over))
        fees["overtime"] = {"price": p, "label": n}
    return fees


WEEKEND = re.compile(r"주말|공휴일")
CHILD = re.compile(r"소인|어린이|초등|유아|미취학|아동|소아|취학")
PRICE_COLS_OUT = ["카카오ID", "성인_평일", "성인_주말", "수건", "주차", "어린이", "추가요금_없음확인", "메모", "출처", "확인일"]


def judge_prices(row):
    """네이버 가격표의 입장료: 성인 평일(주간)·주말·어린이. 항목마다 값이 하나로 정해질 때만 쓴다(여럿이면 뺌). 성인 평일이 없으면 줄을 만들지 않는다."""
    items = price_items(row["가격표"])

    def uniq(match):
        s = {p for n, p in items if match(n)}
        return next(iter(s)) if len(s) == 1 else None

    adult_like = lambda n: ADULT.search(n) and not NOT_ADULT.search(n) and not NIGHT.search(n)
    adult = uniq(lambda n: adult_like(n) and not WEEKEND.search(n))
    if adult is None:
        return None
    weekend = uniq(lambda n: adult_like(n) and WEEKEND.search(n))
    child = uniq(lambda n: CHILD.search(n) and not NIGHT.search(n) and not WEEKEND.search(n) and not re.search(r"세신|회원|찜질복|가운|까운|성인|대인", n))
    if child is not None and child >= adult:
        child = None  # 소인이 대인 이상이면 항목을 잘못 읽은 것이다
    if weekend is not None and weekend < adult:
        weekend = None  # 주말이 평일보다 싸면 잘못 읽었을 가능성이 커서 뺀다
    return {"성인_평일": adult, "성인_주말": weekend, "어린이": child}


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
    facts, judged, price_rows = {}, [], []
    reviews = load_reviews()
    print(f"후기 탭 수집이 있는 곳 {len(reviews)}곳(후기 문장 {sum(len(v) for v in reviews.values())}건)")
    for r in rows[~rows["카카오ID"].isin(gone)].to_dict("records"):
        f, note = {}, {}
        hint = ""
        if r["카카오ID"] in reviews:
            r = add_review_evidence(r, reviews[r["카카오ID"]])
            hint = closed_hints(reviews[r["카카오ID"]])
        note["폐업후기"] = hint
        v, why = judge_seshin(r)
        if v:
            f["seshin"] = v
        note["세신"] = f"{json.dumps(v, ensure_ascii=False)} ({why})" if v else f"불명({why})"
        v, why = judge_hairdryer(r)
        if v:
            f["hairdryer"] = v
        note["드라이기"] = ("유료" if v["paid"] else "무료") + f" ({why})" if v else f"불명({why})"
        if v and v.get("low"):
            note["드라이기"] = "[낮음] " + note["드라이기"]
        v, why = judge_towel(r)
        if v:
            f["towel"] = v
        note["수건"] = f"{json.dumps(v, ensure_ascii=False)} ({why})" if v else f"불명({why})"
        sup = judge_supplies(r)
        if sup:
            f["supplies"] = sup
        fees = judge_fees(r)
        if fees:
            f["fees"] = fees
        note["요금세부"] = json.dumps(fees, ensure_ascii=False) if fees else ""
        conv = {}
        if r["영업표시"].startswith("24시간"):
            conv["open_24h"] = True
        if r["휴무"]:  # '연중무휴'·'매달 2, 4번째 화요일 정기 휴무' 같은 업체 등록 문구 그대로
            conv["closed_days"] = r["휴무"]
        if conv:
            f["convenience"] = conv
        pr = judge_prices(r)
        if pr:
            price_rows.append({"카카오ID": r["카카오ID"], **pr, "메모": "네이버 플레이스 가격표에 가게가 올린 입장료(자동 판정)",
                               "출처": "네이버 플레이스 가격표(자동 판정)", "확인일": r["수집일"]})
        if f:
            f["checked"] = r["수집일"]
            f["source"] = "네이버 플레이스 수집 자동 판정(근거 신뢰도는 facts_judged.csv)"
            facts[r["카카오ID"]] = f
        judged.append({"카카오ID": r["카카오ID"], "이름": r["이름"], **note,
                       "샴푸": "있음" if sup.get("shampoo") else "불명", "24시간": "예" if r["영업표시"].startswith("24시간") else ""})
    json.dump({"_설명": "scripts/judge_facts.py가 만든다. 사람이 확인한 data/curated/place_facts.json이 항목별로 우선한다.",
               "places": facts}, open(OUT_FACTS, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    pd.DataFrame(judged).to_csv(OUT_JUDGED, index=False, encoding="utf-8-sig")
    pd.DataFrame(price_rows, columns=PRICE_COLS_OUT).to_csv(OUT_PRICES, index=False, encoding="utf-8-sig")
    print(f"가격표에서 입장료를 뽑은 곳 {len(price_rows)}곳 → {OUT_PRICES} (사람이 확인한 onsen_prices.csv에 없는 곳만 서비스에 쓴다)")
    j = pd.DataFrame(judged)
    print(f"판정한 곳 {len(j)}곳 → 값이 하나라도 나온 곳 {len(facts)}곳")
    for k in ("세신", "드라이기", "수건"):
        print(f"  {k}: 값 있음 {int((~j[k].str.startswith('불명')).sum())}곳 / 불명 {int(j[k].str.startswith('불명').sum())}곳")


if __name__ == "__main__":
    main()
