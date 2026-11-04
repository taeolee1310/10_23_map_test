#!/usr/bin/env sh
# 새 PC(맥·리눅스)에서 데이터 도구(러스트)를 쓸 수 있게 맞춘다. 여러 번 돌려도 된다.
#   실행: 프로젝트 폴더에서  sh scripts/setup.sh
# 맥·리눅스는 한글 경로에서도 빌드되므로 빌드 폴더 설정은 필요 없다.
set -e
cd "$(dirname "$0")/.."
[ -f "$HOME/.cargo/env" ] && . "$HOME/.cargo/env"
if ! command -v cargo >/dev/null 2>&1; then
  echo "설치: rustup (https://rustup.rs 공식 설치)"
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
  . "$HOME/.cargo/env"
fi
if [ "$(uname)" = "Darwin" ] && ! xcode-select -p >/dev/null 2>&1; then
  echo "⛔ 맥은 링커가 필요해요. 'xcode-select --install'을 실행해 설치한 뒤 다시 실행해 주세요"
  exit 1
fi
rm -f .cargo/config.toml   # 윈도우용 빌드 폴더 설정이 섞여 있으면 지운다
cargo fetch
cargo build --release
echo
echo "준비 끝. 실행: cargo run --release --bin <이름>"
echo "도구: $(ls src/bin | sed 's/\.rs$//' | tr '\n' ' ')"
