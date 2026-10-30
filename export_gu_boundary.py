"""서울 25개 구 경계를 화면용으로 줄인다. (왜: 내 위치가 어느 구인지 알려 주려고. 원본은 18MB라 화면에서 못 씀)
읽기: data/raw/skorea-municipalities-2018-geo.json (통계청 SGIS 2018 시군구 경계, 공공누리 제1유형, southkorea/southkorea-maps 저장소에서 받음)
쓰기: web/public/data/seoul-gu.json  ->  {"이름": [[[경도, 위도], ...], ...]} (구마다 바깥 고리 목록, 구멍은 무시)
"""
import json

SRC = "data/raw/skorea-municipalities-2018-geo.json"
DST = "web/public/data/seoul-gu.json"
TOL = 0.00008  # 약 9m. 이보다 작은 꺾임은 펴서 파일을 줄인다


def simplify(pts, tol):
    """Douglas-Peucker. 닫힌 고리는 가장 먼 두 점에서 나눠 처리한다."""
    if len(pts) < 5:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        (ax, ay), (bx, by) = pts[a], pts[b]
        dx, dy = bx - ax, by - ay
        norm = dx * dx + dy * dy
        far, idx = 0.0, -1
        for i in range(a + 1, b):
            px, py = pts[i]
            if norm == 0:
                d = ((px - ax) ** 2 + (py - ay) ** 2) ** 0.5
            else:
                t = max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / norm))
                d = ((px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2) ** 0.5
            if d > far:
                far, idx = d, i
        if far > tol and idx > 0:
            keep[idx] = True
            stack += [(a, idx), (idx, b)]
    return [p for p, k in zip(pts, keep) if k]


def rings_of(geom):
    polys = [geom["coordinates"]] if geom["type"] == "Polygon" else geom["coordinates"]
    return [poly[0] for poly in polys]  # 바깥 고리만


def main():
    data = json.load(open(SRC, encoding="utf-8"))
    out = {}
    for f in data["features"]:
        if not str(f["properties"]["code"]).startswith("11"):  # 11 = 서울특별시
            continue
        rings = []
        for ring in rings_of(f["geometry"]):
            s = simplify([(x, y) for x, y in ring], TOL)
            if len(s) >= 4:
                rings.append([[round(x, 5), round(y, 5)] for x, y in s])
        out[f["properties"]["name"]] = rings
    json.dump(out, open(DST, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    pts = sum(len(r) for v in out.values() for r in v)
    print(f"서울 {len(out)}개 구 / 고리 {sum(len(v) for v in out.values())}개 / 점 {pts}개 (조건: 시군구 코드가 11로 시작)")
    print(f"저장: {DST}")


main()
