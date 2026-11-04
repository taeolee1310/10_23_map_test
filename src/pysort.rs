//! 판다스 drop_duplicates와 같은 중복 빼기.

/// 판다스 drop_duplicates(keep="last"): 뒤에 같은 열쇠가 또 나오는 줄을 뺀다(순서 유지).
pub fn keep_last<T, K: std::hash::Hash + Eq>(items: Vec<T>, key: impl Fn(&T) -> K) -> Vec<T> {
    let mut seen = std::collections::HashSet::new();
    let mut keep = vec![false; items.len()];
    for (i, it) in items.iter().enumerate().rev() {
        keep[i] = seen.insert(key(it));
    }
    items
        .into_iter()
        .zip(keep)
        .filter(|(_, k)| *k)
        .map(|(x, _)| x)
        .collect()
}

/// 판다스 drop_duplicates(keep="first")
pub fn keep_first<T, K: std::hash::Hash + Eq>(items: Vec<T>, key: impl Fn(&T) -> K) -> Vec<T> {
    let mut seen = std::collections::HashSet::new();
    items
        .into_iter()
        .filter(|it| seen.insert(key(it)))
        .collect()
}
