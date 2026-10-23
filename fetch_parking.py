import os

import pandas as pd
import requests
from dotenv import load_dotenv

# 🔌 API 주소는 여기 한 곳에만
API = {
    "parking": "https://api.data.go.kr/openapi/tn_pubr_prkplce_info_api",
}

PAGE_SIZE = 100  # 한 번에 받는 줄 수
MAX_ROWS = 1000  # 처음엔 적게. 더 필요하면 숫자만 키운다
RAW_PATH = "data/parking_raw.csv"

load_dotenv(override=True)


def fetch_parking(max_rows=MAX_ROWS):
    """전국주차장정보표준데이터 API. 표(DataFrame)를 돌려준다.

    키·연결 문제는 '⛔'로 시작하는 한국어 한 줄 RuntimeError로 낸다.
    요청 주소·응답 본문은 키가 들어 있을 수 있어 출력하지 않는다.
    """
    key = os.getenv("DATA_GO_KR_API_KEY")
    if not key:
        raise RuntimeError("⛔ .env에 DATA_GO_KR_API_KEY 값을 넣어 주세요")

    rows = []
    page = 1
    while len(rows) < max_rows:
        try:
            # 🔌 API 호출
            res = requests.get(
                API["parking"],
                params={"serviceKey": key, "pageNo": page, "numOfRows": PAGE_SIZE, "type": "json"},
                timeout=10,
            )
        except requests.RequestException:
            raise RuntimeError("⛔ 공공데이터포털에 연결하지 못했어요. 인터넷을 확인해 주세요") from None

        if res.status_code in (401, 403):
            raise RuntimeError("⛔ 인증키가 틀렸거나 활용신청이 아직 승인되지 않았어요")
        if res.status_code != 200:
            raise RuntimeError(f"⛔ 공공데이터포털 응답 오류예요 (코드 {res.status_code})")

        try:
            body = res.json()["response"]
        except (ValueError, KeyError):
            # 키가 틀리면 JSON이 아니라 XML 오류문이 온다
            raise RuntimeError("⛔ 인증키가 틀렸거나 활용신청이 아직 승인되지 않았어요") from None

        if body["header"]["resultCode"] != "00":
            raise RuntimeError(f"⛔ 공공데이터포털 오류예요 (코드 {body['header']['resultCode']})")

        items = body["body"].get("items") or []
        if not items:
            break
        rows.extend(items)
        if len(rows) >= int(body["body"]["totalCount"]):
            break
        page += 1

    return pd.DataFrame(rows[:max_rows])


if __name__ == "__main__":
    try:
        df = fetch_parking()
    except RuntimeError as e:
        print(e)
        raise SystemExit(1)

    print("줄 수·칸 수:", df.shape)
    print("빈칸 개수:")
    print(df.isna().sum())
    print("칸 이름:", list(df.columns))
    os.makedirs("data", exist_ok=True)
    df.to_csv(RAW_PATH, encoding="utf-8-sig", index=False)
    print(f"저장: {RAW_PATH} (조건: API 앞에서 {MAX_ROWS}줄까지)")
    print("출처: 공공데이터포털 전국주차장정보표준데이터 (data.go.kr/data/15012896)")
