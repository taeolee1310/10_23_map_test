//! 검색한 장소를 카카오 지도에 찍는 map.html을 만든다 (수업 연습, React 화면과 무관).
//! 키는 map.html이 아니라 map_config.js에만 들어간다(.gitignore).
//! 실행: cargo run --release --bin make_map            (검색 → map.html·map_config.js 만들기)
//!       cargo run --release --bin make_map -- --serve (http://localhost:8000/map.html 로 보기, 이 두 파일만 보낸다)

use serde_json::Value;
use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use tangbang_data::kakao::{self, Place};
use tangbang_data::pyjson::{self, obj};
use tangbang_data::util;

// 🔌 지도 SDK 주소는 여기 한 곳에만 (장소 검색 API 주소는 src/kakao.rs)
const SDK: &str = "https://dapi.kakao.com/v2/maps/sdk.js";
const MAX_MARKERS: usize = 200;
const CONFIG_FILE: &str = "map_config.js"; // JS 키만 담는 파일. .gitignore에 있어서 GitHub에 안 올라간다

const HTML: &str = r#"<!DOCTYPE html>
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
"#;

/// <script> 안에 넣어도 태그가 깨지지 않게 '</'를 막는다.
fn safe_json(v: &Value) -> String {
    pyjson::dumps(v, &pyjson::DEFAULT).replace("</", "<\\/")
}

/// JS 키만 담은 map_config.js 글자를 만든다.
fn kakao_map_config(js_key: &str) -> String {
    format!("window.KAKAO_JS_KEY = {};\n", safe_json(&Value::from(js_key)))
}

/// 마커를 찍는 카카오 지도 HTML. separate_key=true면 HTML에 키를 넣지 않고 map_config.js를 불러온다.
fn kakao_map_html(js_key: &str, markers: &[Place], separate_key: bool) -> String {
    let loader = if separate_key {
        format!("<script src=\"{CONFIG_FILE}\"></script>")
    } else {
        format!("<script>{}</script>", kakao_map_config(js_key))
    };
    let m: Vec<Value> = markers
        .iter()
        .take(MAX_MARKERS)
        .map(|p| {
            obj(vec![
                ("이름", Value::from(p.name.clone())),
                ("주소", Value::from(p.addr.clone())),
                ("위도", Value::from(p.lat)),
                ("경도", Value::from(p.lng)),
            ])
        })
        .collect();
    HTML.replace("__KEY_LOADER__", &loader).replace("__SDK__", SDK).replace("__MARKERS__", &safe_json(&Value::Array(m)))
}

/// map.html과 map_config.js 두 파일만 보내는 작은 서버 (127.0.0.1에서만 열린다).
fn serve() -> std::io::Result<()> {
    let listener = TcpListener::bind("127.0.0.1:8000")?;
    println!("http://localhost:8000/map.html 을 브라우저로 여세요 (끄려면 Ctrl+C)");
    for stream in listener.incoming() {
        let mut stream = match stream {
            Ok(s) => s,
            Err(_) => continue,
        };
        let mut line = String::new();
        if BufReader::new(&stream).read_line(&mut line).is_err() {
            continue;
        }
        let path = line.split_whitespace().nth(1).unwrap_or("/");
        let file = match path.split('?').next().unwrap_or("") {
            "/" | "/map.html" => Some(("map.html", "text/html; charset=utf-8")),
            "/map_config.js" => Some((CONFIG_FILE, "text/javascript; charset=utf-8")),
            _ => None,
        };
        let resp = match file.and_then(|(f, t)| std::fs::read(f).ok().map(|b| (b, t))) {
            Some((body, t)) => {
                let mut r = format!("HTTP/1.1 200 OK\r\nContent-Type: {t}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len()).into_bytes();
                r.extend(body);
                r
            }
            None => b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".to_vec(),
        };
        let _ = stream.write_all(&resp);
    }
    Ok(())
}

fn main() {
    if std::env::args().any(|a| a == "--serve") {
        if let Err(e) = serve() {
            println!("⛔ 8000번 포트를 열지 못했어요: {e}");
            std::process::exit(1);
        }
        return;
    }
    kakao::load_env();
    let Some(js_key) = kakao::env("KAKAO_JS_KEY") else {
        println!("⛔ .env에 KAKAO_JS_KEY 값을 넣어 주세요");
        std::process::exit(1);
    };
    if Some(&js_key) == kakao::env("KAKAO_REST_API_KEY").as_ref() {
        println!("⛔ KAKAO_JS_KEY에 REST 키가 들어가 있어요. JavaScript 키로 바꿔 주세요");
        std::process::exit(1);
    }
    let query = util::py_strip(&util::input("검색어: ")).to_string();
    let places = match kakao::search_place(&query, 10) {
        Ok(p) => p,
        Err(e) => {
            println!("{e}");
            std::process::exit(1);
        }
    };
    if places.is_empty() {
        println!("'{query}'을(를) 찾지 못했어요");
        std::process::exit(1);
    }
    for (i, p) in places.iter().enumerate() {
        println!("{}. {} | {} | ({}, {})", i + 1, p.name, p.addr, util::py_float(p.lat), util::py_float(p.lng));
    }
    // map.html에는 키가 없고, 키는 map_config.js에만 있다
    if util::write_text("map.html", &kakao_map_html(&js_key, &places, true)).is_err()
        || util::write_text(CONFIG_FILE, &kakao_map_config(&js_key)).is_err()
    {
        println!("⛔ map.html·map_config.js를 쓰지 못했어요");
        std::process::exit(1);
    }
    println!("\n마커 {}개로 map.html을 만들었어요 (검색어: '{query}', 최대 10개)", places.len());
    println!("키는 map.html이 아니라 map_config.js에만 있어요 (map_config.js는 GitHub에 안 올라가요)");
    println!("이 폴더에서 서버를 켜고 브라우저로 여세요:");
    println!("  cargo run --release --bin make_map -- --serve");
    println!("  http://localhost:8000/map.html");
    println!("카카오 콘솔 JavaScript SDK 도메인에 http://localhost:8000 이 등록돼 있어야 해요");
    println!("출처: 카카오 로컬 API (키워드로 장소 검색), 카카오맵 JavaScript SDK");
}
