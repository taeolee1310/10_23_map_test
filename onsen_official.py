"""행정안전부 전국 온천이용업소 현황(원본 CSV)을 서비스에서 쓰기 좋게 정리해 data/onsen_official_clean.csv로 저장한다.

좌표는 원본에 없다. 카카오로 채우는 일은 하루 30줄 한도 규칙이 있어 여기서 하지 않는다.
"""
import os

import pandas as pd

RAW = "data/행정안전부_전국 온천이용업소 현황_20260827.csv"
OUT = "data/onsen_official_clean.csv"
BASE_DATE = "2026-08-27"  # 파일 이름의 기준일 (20260827)

# 약칭 → 정식 시·도 이름. ("남구" 같은 부분 일치를 막으려고 정식 이름으로 맞춘다)
SIDO = {
    "서울": "서울특별시", "부산": "부산광역시", "대구": "대구광역시", "인천": "인천광역시",
    "광주": "광주광역시", "대전": "대전광역시", "울산": "울산광역시", "세종": "세종특별자치시",
    "경기": "경기도", "강원": "강원특별자치도", "강원도": "강원특별자치도",
    "충북": "충청북도", "충남": "충청남도",
    "전북": "전북특별자치도", "전라북도": "전북특별자치도", "전남": "전라남도",
    "경북": "경상북도", "경남": "경상남도", "제주": "제주특별자치도",
}


def read_csv(path):
    """utf-8-sig → cp949 순서로 시도해 읽고, 읽은 인코딩을 출력한다."""
    for enc in ("utf-8-sig", "cp949"):
        try:
            df = pd.read_csv(path, encoding=enc)
            print(f"읽은 인코딩: {enc}")
            return df
        except UnicodeDecodeError:
            continue
    raise SystemExit("⛔ CSV 인코딩을 읽지 못했어요 (utf-8-sig·cp949 모두 실패)")


# 일반인이 이용하는 온천이 아닌 기관(시청·병원·연수원 등). 이름에 이 말이 들면 뺀다.
INSTITUTION = r"시청|군청|병원|의료재단|대학교|연수원|수련원|인재원|협동조합|복지회|자산관리"
KEEP_NAMES = ["문화온천(현대병원)"]  # 이름에 '병원'이 들었지만 온천 목욕탕이라 남긴다
# 지금은 없는 행정구역: 진해시(창원시 진해구로 통합), 구 없는 '창원시', 대구로 넘어간 경북 군위군
OLD_AREA = lambda df: (
    df["시군구"].isin(["진해시", "창원시"]) | ((df["시도"] == "경상북도") & (df["시군구"] == "군위군"))
)


def sigungu_of(tokens):
    """시·군·구 이름. '창원시 의창구'처럼 시 아래 구가 있으면 둘 다 붙인다."""
    if len(tokens) >= 3 and tokens[1].endswith("시") and tokens[2].endswith("구"):
        return f"{tokens[1]} {tokens[2]}"
    return tokens[1]


def clean(df):
    out = pd.DataFrame()
    out["이름"] = df["업소(기관명)"].str.strip()

    tokens = df["주소"].str.strip().str.split()
    first = tokens.str[0]
    out["시도"] = first.map(SIDO).fillna(first)
    out["시군구"] = tokens.map(sigungu_of)

    # 시·도를 정식 이름으로 바꾼 주소. ')' 뒤에 붙은 업소 이름 꼬리("(망상동)동해약천…")는 자른다.
    addr = tokens.map(lambda t: " ".join(t[1:])).str.replace(r"(\))[^)]+$", r"\1", regex=True)
    out["주소"] = out["시도"] + " " + addr

    phone = df["대표전화"].fillna("").str.strip()
    out["전화"] = phone.mask(phone.str.startswith("010"), "")  # 개인 휴대폰은 뺀다
    out["데이터기준일자"] = BASE_DATE

    before = len(out)
    out = out.drop_duplicates(subset=["이름", "주소"]).reset_index(drop=True)
    print(f"이름+주소가 같은 중복 {before - len(out)}줄 제거")

    is_inst = out["이름"].str.contains(INSTITUTION) & ~out["이름"].isin(KEEP_NAMES)
    is_old = OLD_AREA(out)
    print(f"기관 {int(is_inst.sum())}곳 제외:", ", ".join(out.loc[is_inst, "이름"]))
    print(f"옛 행정구역 {int((is_old & ~is_inst).sum())}곳 제외:", ", ".join(out.loc[is_old & ~is_inst, "이름"]))
    out = out[~(is_inst | is_old)].reset_index(drop=True)
    return out.sort_values(["시도", "시군구", "이름"]).reset_index(drop=True)


if __name__ == "__main__":
    raw = read_csv(RAW)
    print(raw.shape, "빈칸:", raw.isna().sum().to_dict())

    df = clean(raw)
    print(df.shape, "빈칸(전화 빈 글자 포함):", {"전화": int((df["전화"] == "").sum())})
    print("시도별 업소 수 (조건: 이름+주소 중복 제거 후 전체)")
    print(df["시도"].value_counts().to_string())

    os.makedirs("data", exist_ok=True)
    df.to_csv(OUT, index=False, encoding="utf-8-sig")
    print(f"저장: {OUT} (기준일 {BASE_DATE})")
    print("출처: 행정안전부 전국 온천이용업소 현황 (공공데이터포털)")
