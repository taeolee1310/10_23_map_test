//! 서울 25개 구 경계를 화면용으로 줄인다. (왜: 내 위치가 어느 구인지 알려 주려고. 원본은 18MB라 화면에서 못 씀)
//! 읽기: data/raw/skorea-municipalities-2018-geo.json (통계청 SGIS 2018 시군구 경계, 공공누리 제1유형, southkorea/southkorea-maps 저장소에서 받음)
//! 쓰기: web/public/data/seoul-gu.json  ->  {"이름": [[[경도, 위도], ...], ...]} (구마다 바깥 고리 목록, 구멍은 무시)
//! 실행: cargo run --release --bin export_gu_boundary

use anyhow::{anyhow, Result};
use serde_json::{Map, Value};
use tangbang_data::{pyjson, util};

const SRC: &str = "data/raw/skorea-municipalities-2018-geo.json";
const DST: &str = "web/public/data/seoul-gu.json";
const TOL: f64 = 0.00008; // 약 9m. 이보다 작은 꺾임은 펴서 파일을 줄인다

/// Douglas-Peucker. 남길 점의 번호를 돌려준다.
fn simplify(pts: &[(f64, f64)], tol: f64) -> Vec<usize> {
    if pts.len() < 5 {
        return (0..pts.len()).collect();
    }
    let mut keep = vec![false; pts.len()];
    keep[0] = true;
    *keep.last_mut().unwrap() = true;
    let mut stack = vec![(0usize, pts.len() - 1)];
    while let Some((a, b)) = stack.pop() {
        let ((ax, ay), (bx, by)) = (pts[a], pts[b]);
        let (dx, dy) = (bx - ax, by - ay);
        let norm = dx * dx + dy * dy;
        let (mut far, mut idx) = (0.0f64, 0usize);
        for (i, &(px, py)) in pts.iter().enumerate().take(b).skip(a + 1) {
            let d = if norm == 0.0 {
                ((px - ax).powf(2.0) + (py - ay).powf(2.0)).powf(0.5)
            } else {
                let t = (((px - ax) * dx + (py - ay) * dy) / norm).clamp(0.0, 1.0);
                ((px - ax - t * dx).powf(2.0) + (py - ay - t * dy).powf(2.0)).powf(0.5)
            };
            if d > far {
                far = d;
                idx = i;
            }
        }
        if far > tol && idx > 0 {
            keep[idx] = true;
            stack.push((a, idx));
            stack.push((idx, b));
        }
    }
    (0..pts.len()).filter(|i| keep[*i]).collect()
}

/// 파이썬 round(x, 5). 정수 좌표는 정수 그대로.
fn round5(v: &Value) -> Value {
    if v.is_i64() || v.is_u64() {
        return v.clone();
    }
    let x = v.as_f64().unwrap();
    Value::from(format!("{:.5}", x).parse::<f64>().unwrap())
}

fn main() -> Result<()> {
    let data = pyjson::load_file(SRC)?;
    let mut out = Map::new();
    let features = data["features"].as_array().ok_or_else(|| anyhow!("⛔ features가 없어요"))?;
    for f in features {
        let code = pyjson::py_str(&f["properties"]["code"]);
        if !code.starts_with("11") {
            continue; // 11 = 서울특별시
        }
        let geom = &f["geometry"];
        let coords = geom["coordinates"].as_array().unwrap();
        let polys: Vec<&Value> = if geom["type"] == "Polygon" { vec![&geom["coordinates"]] } else { coords.iter().collect() };
        let mut rings = Vec::new();
        for poly in polys {
            let ring = poly[0].as_array().unwrap(); // 바깥 고리만
            let pts: Vec<(f64, f64)> = ring.iter().map(|p| (p[0].as_f64().unwrap(), p[1].as_f64().unwrap())).collect();
            let s = simplify(&pts, TOL);
            if s.len() >= 4 {
                rings.push(Value::Array(
                    s.iter().map(|&i| Value::Array(vec![round5(&ring[i][0]), round5(&ring[i][1])])).collect(),
                ));
            }
        }
        out.insert(pyjson::py_str(&f["properties"]["name"]), Value::Array(rings));
    }
    util::write_text(DST, &pyjson::dumps(&Value::Object(out.clone()), &pyjson::COMPACT))?;
    let ring_count: usize = out.values().map(|v| v.as_array().unwrap().len()).sum();
    let pts: usize = out.values().flat_map(|v| v.as_array().unwrap()).map(|r| r.as_array().unwrap().len()).sum();
    println!("서울 {}개 구 / 고리 {ring_count}개 / 점 {pts}개 (조건: 시군구 코드가 11로 시작)", out.len());
    println!("저장: {DST}");
    Ok(())
}
