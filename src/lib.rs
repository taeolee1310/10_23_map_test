//! 탕방 데이터 도구 공용 모듈. 예전 파이썬(판다스) 스크립트와 같은 결과 파일을 만들도록 맞췄다.
//! - csvio: CSV 읽기(utf-8-sig → cp949)·쓰기(utf-8-sig, 판다스와 같은 따옴표·줄바꿈)
//! - pyjson: 파이썬 json.dumps와 같은 모양으로 JSON 쓰기
//! - keys: 이름·주소 비교용 열쇠
//! - naver: 네이버 플레이스 홈 페이지 읽기(브라우저)·문장 뽑기
//! - kakao: 카카오 로컬 REST (REST 키는 여기서만 읽는다)
//! - reportdesk: 제보함(report_desk)의 제보 묶기·칩·판정·curated 반영 규칙

pub mod csvio;
pub mod difflib;
pub mod kakao;
pub mod keys;
pub mod naver;
pub mod pyjson;
pub mod pysort;
pub mod reportdesk;
pub mod util;

/// 정규식을 한 번만 만들어 두는 정적 변수.
#[macro_export]
macro_rules! re {
    ($name:ident, $pat:expr) => {
        static $name: std::sync::LazyLock<regex::Regex> =
            std::sync::LazyLock::new(|| regex::Regex::new($pat).expect("정규식"));
    };
}
