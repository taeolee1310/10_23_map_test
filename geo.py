import os

import requests
from dotenv import load_dotenv

# 🔌 API 주소는 여기 한 곳에만
API = {
    "address": "https://dapi.kakao.com/v2/local/search/address.json",
    "coord2address": "https://dapi.kakao.com/v2/local/geo/coord2address.json",
}

load_dotenv(override=True)


def _get(url, params):
    """카카오 REST 호출 공통 부분. 키·연결 문제는 '⛔' 한 줄 RuntimeError."""
    key = os.getenv("KAKAO_REST_API_KEY")
    if not key:
        raise RuntimeError("⛔ .env에 KAKAO_REST_API_KEY 값을 넣어 주세요")

    try:
        # 🔌 API 호출
        res = requests.get(
            url,
            headers={"Authorization": f"KakaoAK {key}"},
            params=params,
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
    return res.json()


def in_korea(lat, lng):
    return 33 <= lat <= 39 and 124 <= lng <= 132


def address_to_coord(address):
    """주소 → (위도, 경도). 못 찾으면 None."""
    docs = _get(API["address"], {"query": address})["documents"]
    if not docs:
        return None
    lat, lng = float(docs[0]["y"]), float(docs[0]["x"])  # y=위도, x=경도 (글자 → 숫자)
    if not in_korea(lat, lng):
        raise RuntimeError("⛔ 한국 밖 좌표가 나왔어요. 위도·경도 순서를 확인해 주세요")
    return lat, lng


def coord_to_address(lat, lng):
    """(위도, 경도) → 도로명 주소. 도로명이 없으면 지번 주소. 못 찾으면 None."""
    if not in_korea(lat, lng):
        raise RuntimeError("⛔ 한국 밖 좌표예요. 위도·경도 순서를 확인해 주세요")
    docs = _get(API["coord2address"], {"x": lng, "y": lat})["documents"]  # 요청은 x=경도, y=위도
    if not docs:
        return None
    road = docs[0].get("road_address")  # 도로명은 null일 수 있다
    if road:
        return road["address_name"]
    return docs[0]["address"]["address_name"]


if __name__ == "__main__":
    address = input("주소: ").strip()
    try:
        coord = address_to_coord(address)
        if coord is None:
            print(f"'{address}'을(를) 찾지 못했어요")
            raise SystemExit(0)
        lat, lng = coord
        print(f"1) 주소 → 좌표: (위도 {lat}, 경도 {lng})")

        back = coord_to_address(lat, lng)
        if back is None:
            print("2) 좌표 → 주소: 이 좌표의 주소를 찾지 못했어요")
        else:
            print(f"2) 좌표 → 주소: {back}")
    except RuntimeError as e:
        print(e)
        raise SystemExit(1)
    print("출처: 카카오 로컬 API (주소→좌표, 좌표→주소)")
