//! 네이버 ID가 없는 곳을 이름으로 검색해 ID를 찾고, 주소·업종이 맞으면 홈 수집 결과도 같이 남긴다.
//! 페이지는 ego 브라우저가 연다(러스트는 브라우저를 띄우지 않는다). 절차는 data/README.md의 '네이버 수집'.
//!
//! - 대상: data/merged/onsen_merged.csv 중 naver_places.csv·naver_match_manual.csv·이 도구가 이미 판정한 곳에 없는 곳
//! - 돌릴 때마다: 저장된 검색 결과(naver_pages/search/<카카오ID>.html)에서 후보 3개를 고르고, 후보 홈(naver_pages/home/<네이버ID>.txt)을
//!   차례로 본다. 필요한 페이지가 아직 없으면 data/collected/naver_find_todo.csv에 적고 그 곳은 다음에 판정한다.
//! - 후보 채택 조건: 후보 페이지의 주소에 우리 목록의 도로명 주소(구 이후)가 들어 있고, 이름이 비슷하고(유사도 0.5 이상),
//!   업종이 목욕·사우나·찜질·온천·한증일 때만. 같은 건물의 다른 가게를 잘못 잇지 않으려는 것이다. 못 맞추면 '못 찾음'.
//! - 저장: data/collected/naver_id_found.csv(찾은 결과·못 찾음), 맞은 곳의 홈 결과는 naver_home_facts.csv에 추가(collect_home과 같은 칸).
//! - ego 수집 규칙: 페이지마다 10초 간격, 한 번에 --max개, 캡차·차단이 보이거나 3번 연속 비면 멈춘다.
//!
//! 실행(프로젝트 폴더에서): cargo run --release --bin find_naver_ids -- [--max 120]

use anyhow::Result;
use clap::Parser;
use percent_encoding::{utf8_percent_encode, AsciiSet, NON_ALPHANUMERIC};
use std::collections::HashSet;
use tangbang_data::csvio::{self, g, Dtype, Row};
use tangbang_data::naver::{self, COLS, PAGES};
use tangbang_data::{difflib, re, util};

const FOUND: &str = "data/collected/naver_id_found.csv";
const TODO: &str = "data/collected/naver_find_todo.csv";
const FCOLS: [&str; 8] = [
    "카카오ID",
    "이름",
    "주소",
    "네이버ID",
    "네이버이름",
    "네이버주소",
    "결과",
    "확인일",
];
re!(BATH, r"목욕|사우나|찜질|온천|한증"); // 네이버 업종 기준. '스파'·'피부' 업종은 마사지·미용이라 뺀다
re!(PAREN, r"\(.*?\)");
re!(SEOUL_GU, r"^서울(특별시)?\s*\S+구\s*");
re!(WS, r"\s+");
re!(NAME_JUNK, r"\(주\)|주식회사|\s+");
re!(MY_NAME, r"마이플레이스\n(.+?)\n");
re!(MY_ADDR, r"\n주소\n(.+?)\n");
re!(PLACE_ID, r"/place/(\d{5,})");
// 파이썬 urllib.parse.quote(q) 기본값(safe="/")
const QUOTE: &AsciiSet = &NON_ALPHANUMERIC
    .remove(b'-')
    .remove(b'_')
    .remove(b'.')
    .remove(b'~')
    .remove(b'/');

#[derive(Parser)]
struct Args {
    /// 한 번에 ego로 열 페이지 수 상한
    #[arg(long, default_value_t = 120)]
    max: usize,
}

fn read(path: &str) -> Result<Vec<Row>> {
    Ok(csvio::read_csv(path, true, Dtype::AllStr)?.records())
}

fn addr_tail(addr: &str) -> String {
    let a = PAREN.replace_all(addr, "");
    let a = SEOUL_GU.replace(&a, "");
    WS.replace_all(&a, "").into_owned()
}

fn norm_name(n: &str) -> String {
    NAME_JUNK.replace_all(n, "").into_owned()
}

fn cap1(re: &regex::Regex, s: &str) -> String {
    re.captures(s).map(|c| c[1].to_string()).unwrap_or_default()
}

fn search_file(kid: &str) -> String {
    format!("{PAGES}/search/{kid}.html")
}

fn main() -> Result<()> {
    let a = Args::parse();
    let today = util::today_kst();

    let m = read("data/merged/onsen_merged.csv")?;
    let mut have: HashSet<String> = read("data/collected/naver_places.csv")?
        .iter()
        .map(|r| g(r, "카카오ID").to_string())
        .collect();
    have.extend(
        read("data/curated/naver_match_manual.csv")?
            .iter()
            .map(|r| g(r, "카카오ID").to_string()),
    );
    let (fcols_file, mut found) = if util::exists(FOUND) {
        let tb = csvio::read_csv(FOUND, true, Dtype::AllStr)?;
        (csvio::union_cols(&tb.cols, &FCOLS), tb.records())
    } else {
        (FCOLS.iter().map(|s| s.to_string()).collect(), vec![])
    };
    let done_ids: HashSet<String> = found.iter().map(|r| g(r, "카카오ID").to_string()).collect();
    let todo: Vec<Row> = m
        .iter()
        .filter(|r| {
            !g(r, "카카오ID").is_empty()
                && !have.contains(g(r, "카카오ID"))
                && !done_ids.contains(g(r, "카카오ID"))
        })
        .cloned()
        .collect();
    let facts_tb = csvio::read_csv(naver::OUT, true, Dtype::AllStr)?;
    let facts_cols = csvio::union_cols(&facts_tb.cols, COLS);
    let mut facts = facts_tb.records();
    let mut facts_ids: HashSet<String> =
        facts.iter().map(|r| g(r, "네이버ID").to_string()).collect();
    println!(
        "합친 목록 {}곳 중 ID 없음·미처리 {}곳 / 이번에 ego로 열 페이지 상한 {}개",
        m.len(),
        todo.len(),
        a.max
    );

    let mut need: Vec<Vec<String>> = Vec::new();
    let mut judged = 0;
    let mut facts_changed = false;
    for r in &todo {
        let kid = g(r, "카카오ID");
        let sp = search_file(kid);
        let Some(html) = naver::read_page(&sp) else {
            let q = format!("{} {}", g(r, "시군구"), norm_name(g(r, "이름")));
            let url = format!(
                "https://m.search.naver.com/search.naver?query={}",
                utf8_percent_encode(&q, QUOTE)
            );
            need.push(vec![
                kid.into(),
                g(r, "이름").into(),
                "검색 결과(outerHTML)".into(),
                url,
                sp,
            ]);
            continue;
        };
        if naver::blocked(&html) {
            println!("⛔ 캡차·차단 화면이 저장돼 있어요 ({sp}). 우회하지 않고 멈춥니다. 파일을 지우고 나중에 다시 받으세요.");
            return Ok(());
        }
        let mut cands: Vec<String> = Vec::new();
        for c in PLACE_ID.captures_iter(&html) {
            if !cands.contains(&c[1].to_string()) {
                cands.push(c[1].to_string());
            }
        }
        cands.truncate(3);
        let mut res: Row = FCOLS
            .iter()
            .map(|c| (c.to_string(), String::new()))
            .collect();
        for c in ["카카오ID", "이름", "주소"] {
            res.insert(c.into(), g(r, c).to_string());
        }
        res.insert("결과".into(), "못 찾음".into());
        res.insert("확인일".into(), today.clone());
        let mut pending = false;
        for cid in &cands {
            let hp = naver::home_file(cid);
            let Some(t2) = naver::read_page(&hp) else {
                need.push(vec![
                    kid.into(),
                    g(r, "이름").into(),
                    "후보 홈(naver_page_text.js)".into(),
                    naver::home_url(cid),
                    hp,
                ]);
                pending = true; // 앞 후보부터 차례로 봐야 해서 다음 실행에서 이어 판정한다
                break;
            };
            if naver::blocked(&t2) {
                println!("⛔ 캡차·차단 화면이 저장돼 있어요 ({hp}). 우회하지 않고 멈춥니다. 파일을 지우고 나중에 다시 받으세요.");
                return Ok(());
            }
            if !naver::valid_home(&t2) {
                continue;
            }
            let (nn, na) = (cap1(&MY_NAME, &t2), cap1(&MY_ADDR, &t2));
            let row = naver::parse(&t2);
            let tail = addr_tail(g(r, "주소"));
            let same_addr = !tail.is_empty() && WS.replace_all(&na, "").contains(&tail);
            let similar = difflib::ratio(&norm_name(g(r, "이름")), &norm_name(&nn)) >= 0.5;
            // 업종이 헬스장·모텔·예식장이면 같은 건물의 다른 가게다
            if same_addr && similar && BATH.is_match(g(&row, "네이버분류")) {
                res.insert("네이버ID".into(), cid.clone());
                res.insert("네이버이름".into(), nn);
                res.insert("네이버주소".into(), na);
                res.insert("결과".into(), "일치".into());
                if !facts_ids.contains(cid) {
                    let mut full: Row = COLS
                        .iter()
                        .map(|c| (c.to_string(), String::new()))
                        .collect();
                    full.extend(row);
                    full.insert("카카오ID".into(), kid.to_string());
                    full.insert("네이버ID".into(), cid.clone());
                    full.insert("이름".into(), g(r, "이름").to_string());
                    full.insert("수집일".into(), today.clone());
                    full.insert("상태".into(), "ok".into());
                    facts.push(full);
                    facts_ids.insert(cid.clone());
                    facts_changed = true;
                }
                break;
            }
        }
        if pending {
            continue;
        }
        println!(
            "{} → {} {}",
            g(r, "이름"),
            g(&res, "결과"),
            g(&res, "네이버이름")
        );
        found.push(res);
        judged += 1;
    }
    if facts_changed {
        csvio::write_rows(naver::OUT, &facts_cols, &facts)?;
    }
    if judged > 0 {
        csvio::write_rows(FOUND, &fcols_file, &found)?;
    }
    need.truncate(a.max);
    csvio::write_csv(
        TODO,
        &["카카오ID", "이름", "받을것", "주소", "저장할파일"],
        &need,
    )?;
    println!("이번에 판정 {judged}곳 → {FOUND}");
    println!("ego로 열 페이지 {}개 (상한 {}) → {TODO}", need.len(), a.max);
    Ok(())
}
