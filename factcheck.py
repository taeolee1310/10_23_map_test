import re
import sys
import time

from place import search_place

FILE = "taste10.txt"
SIZE = 15  # 카카오 키워드 검색 한 번에 가져올 수 있는 최대 개수


def clean(text):
    """괄호 설명 (강남역 3번 출구 인근) 은 비교에 방해라서 뗀다."""
    return re.sub(r"\s*\([^)]*\)", "", text).strip()


def parse_line(line):
    """'1. 가**름 | 서울 강남구 ...' 또는 표 줄에서 (이름, 주소)를 꺼낸다. 못 읽으면 None."""
    line = re.sub(r"^\s*\d+\s*[.)]\s*", "", line.strip())  # 줄 앞 번호 1. 2) 떼기
    if not line or re.fullmatch(r"[\s|:\-]+", line):  # 빈 줄, | --- | 구분선
        return None
    cells = [c.strip() for c in line.split("|")]
    cells = [c for c in cells if c and not c.isdigit()]  # 표 기호 칸, 번호 칸 떼기
    if len(cells) < 2 or cells[0] in ("이름", "가게", "가게명", "식당"):  # 머리글 줄은 건너뜀
        return None
    return cells[0], cells[1]


def parse_text(lines):
    """두 모양을 다 읽는다.
    ① 한 줄: '가**름 | 주소'
    ② 목록: '• 가게이름' 다음 줄들 중 '• 위치: 주소'
    """
    rows, name = [], None
    for raw in lines:
        if raw[:1] in ("•", "-", "*") and not raw[:1].isspace():  # 맨 앞 글머리 = 가게 이름 줄
            name = clean(raw[1:].strip())
            continue
        m = re.match(r"^\s*[•\-*]?\s*(위치|주소)\s*[:：]\s*(.+)$", raw)
        if m and name:
            rows.append((name, clean(m.group(2))))
            name = None
            continue
        row = parse_line(raw)
        if row:
            rows.append((clean(row[0]), clean(row[1])))
    return rows


def norm(text):
    """띄어쓰기·&·점·괄호 같은 기호를 없애고 소문자로 맞춘다. (*는 남긴다)"""
    return re.sub(r"[^0-9a-zA-Z가-힣*]", "", text).lower()


def same_name(want, found):
    """기호·띄어쓰기를 무시하고 이름 비교. 가운데 *는 아무 글자 하나로 본다."""
    want, found = norm(want), norm(found)
    pattern = re.escape(want).replace(r"\*", ".")
    return re.fullmatch(pattern, found) is not None or re.match(pattern, found) is not None


def address_tokens(addr):
    """주소 첫 단어(서울특별시/서울)는 표기가 달라서 뺀다."""
    return addr.split()[1:]


def same_address(want, found):
    """구가 같고, 동(길) 이름이 찾은 주소 안에 있으면 True."""
    want_t, found_t = address_tokens(want), address_tokens(found)
    gu = next((t for t in want_t if t.endswith("구")), None)
    if gu and gu not in found_t:
        return False
    road = next((t for t in want_t if t != gu and re.search(r"(동|가|로|길)\d*길?$", t)), None)
    if road:
        stem = re.match(r"[가-힣]+", road).group()  # '강남대로96길' -> '강남대로'
        return stem in " ".join(found_t)
    return gu is not None


def same_road_address(want, found):
    """도로명(예: 강남대로102길)이 통째로 같으면 True. 도로명이 없는 주소는 False."""
    want_t, found_t = address_tokens(want), address_tokens(found)
    road = next((t for t in want_t if re.search(r"(로|길)\d*길?$", t)), None)
    return road is not None and road in found_t


def similar_name(want, found):
    """이름 첫 단어(상호)가 찾은 이름 안에 있으면 True. 예: 무월식탁 강남점 ~ 무월식탁 강남본점."""
    core = norm(want.split()[0]).replace("*", "")
    return len(core) >= 2 and core in norm(found)


def judge(area, name, addr):
    """(판정, 찾은 곳 이름, 찾은 곳 주소)를 돌려준다."""
    places = search_place(f"{area} {name}", size=SIZE)
    same = [p for p in places if same_name(name, p["이름"])]
    if not same:
        # 이름이 조금 달라도(지점명 등) 상호가 비슷하고 도로명 주소가 같으면 🟡
        for p in places:
            if similar_name(name, p["이름"]) and same_road_address(addr, p["주소"]):
                return "🟡", p["이름"], p["주소"]
        return "❌", "", ""
    for p in same:
        if same_address(addr, p["주소"]):
            return "✅", p["이름"], p["주소"]
    return "🟡", same[0]["이름"], same[0]["주소"]


if __name__ == "__main__":
    area = sys.argv[1] if len(sys.argv) > 1 else input("동네(예: 서울특별시 강남구, 그냥 Enter면 주소에서 읽음): ").strip()
    path = sys.argv[2] if len(sys.argv) > 2 else FILE

    try:
        with open(path, encoding="utf-8-sig") as f:
            lines = f.read().splitlines()
    except FileNotFoundError:
        print(f"⛔ {path} 파일을 찾지 못했어요")
        raise SystemExit(1)

    rows = parse_text(lines)
    if not rows:
        print(f"⛔ {path}에서 읽을 줄이 없어요. '가**름 | 주소' 또는 '• 이름 / • 위치: 주소' 모양으로 채워 주세요")
        raise SystemExit(1)

    counts = {"✅": 0, "🟡": 0, "❌": 0}
    print(f"동네: {area or '주소에서 읽음'} / 검사할 가게: {len(rows)}개\n")
    for i, (name, addr) in enumerate(rows, 1):
        try:
            mark, found_name, found_addr = judge(area or " ".join(addr.split()[:2]), name, addr)
        except RuntimeError as e:
            print(e)
            raise SystemExit(1)
        counts[mark] += 1
        print(f"{i}. {mark} {name} | AI 주소: {addr}")
        if mark == "🟡":
            print(f"      카카오에 있는 곳: {found_name} | {found_addr}")
        time.sleep(0.1)

    total = len(rows)
    wrong = counts["🟡"] + counts["❌"]
    print(f"\n✅ {counts['✅']}개 / 🟡 {counts['🟡']}개 / ❌ {counts['❌']}개 (전체 {total}개)")
    print(f"AI 실수율(🟡+❌): {wrong}/{total} = {wrong / total * 100:.0f}%")
    print("판정 기준: 이름이 같고 구·동(길)이 맞으면 ✅, 이름은 같은데 주소가 다르거나 상호·도로명만 같으면 🟡, 못 찾으면 ❌")
    print("출처: 카카오 로컬 API (키워드로 장소 검색)")
