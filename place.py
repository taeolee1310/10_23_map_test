import os

import requests
from dotenv import load_dotenv

# 🔌 API 주소는 여기 한 곳에만
API = {
    "keyword": "https://dapi.kakao.com/v2/local/search/keyword.json",
}

load_dotenv(override=True)


def search_place(query, size=5):
    """카카오 키워드 장소 검색. [{이름, 주소, 위도, 경도}, ...] 반환.

    키·연결 문제는 '⛔'로 시작하는 한국어 한 줄 RuntimeError로 낸다.
    """
    key = os.getenv("KAKAO_REST_API_KEY")
    if not key:
        raise RuntimeError("⛔ .env에 KAKAO_REST_API_KEY 값을 넣어 주세요")

    try:
        # 🔌 API 호출
        res = requests.get(
            API["keyword"],
            headers={"Authorization": f"KakaoAK {key}"},
            params={"query": query, "size": size},
            timeout=10,
        )
    except requests.RequestException:
        raise RuntimeError("⛔ 카카오에 연결하지 못했어요. 인터넷을 확인해 주세요") from None

    if res.status_code == 401:
        raise RuntimeError("⛔ 카카오 REST API 키가 틀렸어요")
    if res.status_code == 403:
        raise RuntimeError("⛔ 카카오맵 사용 설정을 켜 주세요")
    if res.status_code != 200:
        raise RuntimeError(f"⛔ 카카오 응답 오류예요 (코드 {res.status_code})")

    places = []
    for d in res.json()["documents"]:
        lat, lng = float(d["y"]), float(d["x"])  # y=위도, x=경도 (글자 → 숫자)
        if not (33 <= lat <= 39 and 124 <= lng <= 132):  # 한국 밖 좌표는 버린다
            continue
        places.append(
            {
                "이름": d["place_name"],
                "주소": d["road_address_name"] or d["address_name"],  # 도로명이 비면 지번
                "위도": lat,
                "경도": lng,
            }
        )
    return places


if __name__ == "__main__":
    query = input("검색어: ").strip()
    try:
        places = search_place(query)
    except RuntimeError as e:
        print(e)
        raise SystemExit(1)

    if not places:
        print(f"'{query}'을(를) 찾지 못했어요")
    for i, p in enumerate(places, 1):
        print(f"{i}. {p['이름']} | {p['주소']} | ({p['위도']}, {p['경도']})")
    print("출처: 카카오 로컬 API (키워드로 장소 검색)")
