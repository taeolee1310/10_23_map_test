#!/usr/bin/env sh
# 탕방 데이터 수집 도구(collector/)를 맥 앱(.app·.dmg)으로 만든다. 여러 번 돌려도 된다.
#   실행: 프로젝트 폴더에서  sh scripts/build-app.sh
#   먼저 sh scripts/setup.sh(러스트·Xcode 도구)를 한 번 돌려 둔다. Node가 없고 Homebrew가 있으면 brew로 설치한다.
#   결과: collector/src-tauri/target/release/bundle/dmg/*.dmg (열어서 응용 프로그램 폴더로 끌어 넣는다)
set -e
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
[ -f "$HOME/.cargo/env" ] && . "$HOME/.cargo/env"
command -v cargo >/dev/null 2>&1 || { echo "⛔ 러스트가 없어요. 먼저 sh scripts/setup.sh 를 실행해 주세요"; exit 1; }
if ! command -v npm >/dev/null 2>&1; then
  if command -v brew >/dev/null 2>&1; then
    echo "설치: Node.js (Homebrew)"
    brew install node
  else
    echo "⛔ Node.js가 없어요. https://nodejs.org 에서 LTS를 설치한 뒤 다시 실행해 주세요"
    exit 1
  fi
fi
cd collector
npm ci --no-audit --no-fund
npx tauri build --bundles app,dmg
TARGET="$(cargo metadata --format-version 1 --no-deps --manifest-path src-tauri/Cargo.toml | sed -n 's/.*"target_directory":"\([^"]*\)".*/\1/p')"
echo
echo "준비 끝. 앱: $(ls -d "$TARGET"/release/bundle/macos/*.app 2>/dev/null | head -1)"
echo "설치 파일: $(ls "$TARGET"/release/bundle/dmg/*.dmg 2>/dev/null | head -1)"
echo "처음 열 때 '확인되지 않은 개발자' 경고가 나오면 앱을 오른쪽 클릭 → 열기. 그다음 이 프로젝트 폴더($ROOT)를 골라 주세요."
