import json
import os

from dotenv import load_dotenv

from place import search_place

# 🔌 지도 SDK 주소는 여기 한 곳에만 (장소 검색 API 주소는 place.py)
API = {
    "sdk": "https://dapi.kakao.com/v2/maps/sdk.js",
}

load_dotenv(override=True)

MAX_MARKERS = 200

HTML = """<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>장소 지도</title>
<style>
  body { margin: 0; font-family: sans-serif; }
  #map { width: 100%; height: 520px; }
  .tip { padding: 8px 12px; font-size: 13px; color: #555; }
  .iw { padding: 6px 10px; font-size: 13px; line-height: 1.4; }
</style>
</head>
<body>
<div id="map"></div>
<div class="tip">지도가 회색이면 확인할 것 3가지: ①카카오맵 사용 설정 ② 지금 주소(포트까지) 등록 ③ 서버 주소로 열기</div>
<!-- 🔌 API 호출: 지도 SDK -->
<script src="__SDK__?appkey=__JS_KEY__&autoload=false"></script>
<script>
  const markers = __MARKERS__;
  kakao.maps.load(function () {
    const map = new kakao.maps.Map(document.getElementById("map"), {
      center: new kakao.maps.LatLng(37.5665, 126.9780),
      level: 5,
    });
    const bounds = new kakao.maps.LatLngBounds();
    let opened = null;
    markers.forEach(function (m) {
      const pos = new kakao.maps.LatLng(m["위도"], m["경도"]);  // 위도, 경도 순서
      const marker = new kakao.maps.Marker({ map: map, position: pos });
      const box = document.createElement("div");
      box.className = "iw";
      const name = document.createElement("b");
      name.textContent = m["이름"];
      const addr = document.createElement("div");
      addr.textContent = m["주소"];
      box.appendChild(name);
      box.appendChild(addr);
      const info = new kakao.maps.InfoWindow({ content: box });
      kakao.maps.event.addListener(marker, "click", function () {
        if (opened) opened.close();
        info.open(map, marker);
        opened = info;
      });
      bounds.extend(pos);
    });
    if (markers.length) map.setBounds(bounds);
  });
</script>
</body>
</html>
"""


def kakao_map_html(js_key, markers):
    """마커 [{이름, 주소, 위도, 경도}, ...]를 찍는 카카오 지도 HTML 글자를 만든다. JS 키만 쓴다."""
    data = json.dumps(markers[:MAX_MARKERS], ensure_ascii=False).replace("</", "<\\/")
    return (
        HTML.replace("__SDK__", API["sdk"])
        .replace("__JS_KEY__", js_key)
        .replace("__MARKERS__", data)
    )


if __name__ == "__main__":
    js_key = os.getenv("KAKAO_JS_KEY")
    if not js_key:
        print("⛔ .env에 KAKAO_JS_KEY 값을 넣어 주세요")
        raise SystemExit(1)

    query = input("검색어: ").strip()
    try:
        places = search_place(query, size=10)
    except RuntimeError as e:
        print(e)
        raise SystemExit(1)

    if not places:
        print(f"'{query}'을(를) 찾지 못했어요")
        raise SystemExit(1)

    for i, p in enumerate(places, 1):
        print(f"{i}. {p['이름']} | {p['주소']} | ({p['위도']}, {p['경도']})")

    with open("map.html", "w", encoding="utf-8") as f:
        f.write(kakao_map_html(js_key, places))

    print(f"\n마커 {len(places)}개로 map.html을 만들었어요 (검색어: '{query}', 최대 10개)")
    print("이 폴더에서 서버를 켜고 브라우저로 여세요:")
    print("  python -m http.server 8000 --bind 127.0.0.1")
    print("  http://localhost:8000/map.html")
    print("카카오 콘솔 JavaScript SDK 도메인에 http://localhost:8000 이 등록돼 있어야 해요")
    print("출처: 카카오 로컬 API (키워드로 장소 검색), 카카오맵 JavaScript SDK")
