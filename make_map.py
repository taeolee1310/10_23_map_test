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
CONFIG_FILE = "map_config.js"  # JS 키만 담는 파일. .gitignore에 있어서 GitHub에 안 올라간다

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
<div class="tip">지도가 회색이면 확인할 것 3가지: ① 카카오맵 사용 설정 ② 지금 주소(포트까지) 등록 ③ 서버 주소로 열기</div>
__KEY_LOADER__
<script>
  const markers = __MARKERS__;

  function draw() {
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
  }

  // 🔌 API 호출: 지도 SDK (JS 키는 위에서 불러온 window.KAKAO_JS_KEY)
  const sdk = document.createElement("script");
  sdk.src = "__SDK__?appkey=" + encodeURIComponent(window.KAKAO_JS_KEY || "") + "&autoload=false";
  sdk.onload = function () { kakao.maps.load(draw); };
  document.head.appendChild(sdk);
</script>
</body>
</html>
"""


def _safe_json(data):
    """<script> 안에 넣어도 태그가 깨지지 않게 '</'를 막는다."""
    return json.dumps(data, ensure_ascii=False).replace("</", "<\\/")


def kakao_map_config(js_key):
    """JS 키만 담은 map_config.js 글자를 만든다."""
    return f"window.KAKAO_JS_KEY = {_safe_json(js_key)};\n"


def kakao_map_html(js_key, markers, separate_key=False):
    """마커 [{이름, 주소, 위도, 경도}, ...]를 찍는 카카오 지도 HTML 글자를 만든다. JS 키만 쓴다.

    separate_key=True면 HTML에 키를 넣지 않고 map_config.js를 불러오게 한다.
    (st.iframe처럼 파일 하나로 보여 줄 때는 False)
    """
    if separate_key:
        loader = f'<script src="{CONFIG_FILE}"></script>'
    else:
        loader = f"<script>{kakao_map_config(js_key)}</script>"
    return (
        HTML.replace("__KEY_LOADER__", loader)
        .replace("__SDK__", API["sdk"])
        .replace("__MARKERS__", _safe_json(markers[:MAX_MARKERS]))
    )


if __name__ == "__main__":
    js_key = os.getenv("KAKAO_JS_KEY")
    if not js_key:
        print("⛔ .env에 KAKAO_JS_KEY 값을 넣어 주세요")
        raise SystemExit(1)
    if js_key == os.getenv("KAKAO_REST_API_KEY"):
        print("⛔ KAKAO_JS_KEY에 REST 키가 들어가 있어요. JavaScript 키로 바꿔 주세요")
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

    # map.html에는 키가 없고, 키는 map_config.js에만 있다
    with open("map.html", "w", encoding="utf-8") as f:
        f.write(kakao_map_html(js_key, places, separate_key=True))
    with open(CONFIG_FILE, "w", encoding="utf-8") as f:
        f.write(kakao_map_config(js_key))

    print(f"\n마커 {len(places)}개로 map.html을 만들었어요 (검색어: '{query}', 최대 10개)")
    print("키는 map.html이 아니라 map_config.js에만 있어요 (둘 다 GitHub에 안 올라가요)")
    print("이 폴더에서 서버를 켜고 브라우저로 여세요:")
    print("  python -m http.server 8000 --bind 127.0.0.1")
    print("  http://localhost:8000/map.html")
    print("카카오 콘솔 JavaScript SDK 도메인에 http://localhost:8000 이 등록돼 있어야 해요")
    print("출처: 카카오 로컬 API (키워드로 장소 검색), 카카오맵 JavaScript SDK")
