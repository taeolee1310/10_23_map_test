//! 파이썬 json.dump(ensure_ascii=False)와 글자 하나까지 같은 모양으로 JSON을 쓴다.
//! (화면이 읽는 onsen.json이 예전과 같아야 React 쪽이 그대로 돈다)

use anyhow::Result;
use serde_json::{Map, Number, Value};

use crate::util;

pub struct Style {
    pub item: &'static str,
    pub key: &'static str,
    pub indent: Option<usize>,
}

/// json.dumps 기본값 (", ", ": ")
pub const DEFAULT: Style = Style { item: ", ", key: ": ", indent: None };
/// separators=(",", ":")
pub const COMPACT: Style = Style { item: ",", key: ":", indent: None };
/// indent=1
pub const INDENT1: Style = Style { item: ",", key: ": ", indent: Some(1) };

pub fn dumps(v: &Value, st: &Style) -> String {
    let mut out = String::new();
    write(v, st, 0, &mut out);
    out
}

fn newline(st: &Style, level: usize, out: &mut String) {
    if let Some(n) = st.indent {
        out.push('\n');
        out.extend(std::iter::repeat_n(' ', n * level));
    }
}

pub fn num(n: &Number) -> String {
    if let Some(i) = n.as_i64() {
        i.to_string()
    } else if let Some(u) = n.as_u64() {
        u.to_string()
    } else {
        util::json_float(n.as_f64().unwrap_or(f64::NAN))
    }
}

fn esc(s: &str, out: &mut String) {
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            '\u{8}' => out.push_str("\\b"),
            '\u{c}' => out.push_str("\\f"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
}

fn write(v: &Value, st: &Style, level: usize, out: &mut String) {
    match v {
        Value::Null => out.push_str("null"),
        Value::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        Value::Number(n) => out.push_str(&num(n)),
        Value::String(s) => esc(s, out),
        Value::Array(a) => {
            if a.is_empty() {
                out.push_str("[]");
                return;
            }
            out.push('[');
            newline(st, level + 1, out);
            for (i, x) in a.iter().enumerate() {
                if i > 0 {
                    out.push_str(st.item);
                    newline(st, level + 1, out);
                }
                write(x, st, level + 1, out);
            }
            newline(st, level, out);
            out.push(']');
        }
        Value::Object(m) => {
            if m.is_empty() {
                out.push_str("{}");
                return;
            }
            out.push('{');
            newline(st, level + 1, out);
            for (i, (k, x)) in m.iter().enumerate() {
                if i > 0 {
                    out.push_str(st.item);
                    newline(st, level + 1, out);
                }
                esc(k, out);
                out.push_str(st.key);
                write(x, st, level + 1, out);
            }
            newline(st, level, out);
            out.push('}');
        }
    }
}

/// json.dumps(v, sort_keys=True) — 값이 같은지 비교할 때 쓴다.
pub fn canon(v: &Value) -> String {
    fn sorted(v: &Value) -> Value {
        match v {
            Value::Object(m) => {
                let mut keys: Vec<&String> = m.keys().collect();
                keys.sort();
                let mut out = Map::new();
                for k in keys {
                    out.insert(k.clone(), sorted(&m[k]));
                }
                Value::Object(out)
            }
            Value::Array(a) => Value::Array(a.iter().map(sorted).collect()),
            x => x.clone(),
        }
    }
    dumps(&sorted(v), &DEFAULT)
}

/// 파이썬 json.load처럼 읽는다. BOM을 떼고, 파이썬이 쓴 NaN·Infinity는 null로 읽는다.
pub fn loads(text: &str) -> Result<Value> {
    let t = text.trim_start_matches('\u{feff}');
    Ok(serde_json::from_str(&fix_nan(t))?)
}

pub fn load_file(path: &str) -> Result<Value> {
    let s = std::fs::read_to_string(path)
        .map_err(|e| anyhow::anyhow!("⛔ {path}을(를) 읽지 못했어요: {e}"))?;
    loads(&s)
}

fn fix_nan(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut in_str = false;
    let mut escape = false;
    let mut rest = s;
    while let Some(c) = rest.chars().next() {
        if in_str {
            if escape {
                escape = false;
            } else if c == '\\' {
                escape = true;
            } else if c == '"' {
                in_str = false;
            }
            out.push(c);
            rest = &rest[c.len_utf8()..];
            continue;
        }
        let mut hit = false;
        for tok in ["NaN", "-Infinity", "Infinity"] {
            if rest.starts_with(tok) {
                out.push_str("null");
                rest = &rest[tok.len()..];
                hit = true;
                break;
            }
        }
        if hit {
            continue;
        }
        if c == '"' {
            in_str = true;
        }
        out.push(c);
        rest = &rest[c.len_utf8()..];
    }
    out
}

/// 파이썬 bool(v)
pub fn truthy(v: Option<&Value>) -> bool {
    match v {
        None | Some(Value::Null) => false,
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_f64().map(|f| f != 0.0).unwrap_or(true),
        Some(Value::String(s)) => !s.is_empty(),
        Some(Value::Array(a)) => !a.is_empty(),
        Some(Value::Object(m)) => !m.is_empty(),
    }
}

/// 파이썬 str(v)
pub fn py_str(v: &Value) -> String {
    match v {
        Value::Null => "None".into(),
        Value::Bool(b) => if *b { "True".into() } else { "False".into() },
        Value::Number(n) => {
            if n.is_f64() {
                util::py_float(n.as_f64().unwrap())
            } else {
                num(n)
            }
        }
        Value::String(s) => s.clone(),
        x => dumps(x, &DEFAULT),
    }
}

/// f64 → JSON 숫자(실수). NaN은 null.
pub fn f(x: Option<f64>) -> Value {
    match x {
        Some(v) => Value::from(v),
        None => Value::Null,
    }
}

/// 순서를 지키는 JSON 객체를 만든다.
pub fn obj(pairs: Vec<(&str, Value)>) -> Value {
    let mut m = Map::new();
    for (k, v) in pairs {
        m.insert(k.to_string(), v);
    }
    Value::Object(m)
}
