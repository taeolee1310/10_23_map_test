# 탕방 데이터 수집 도구(collector/)를 윈도우 설치 파일(.exe)로 만든다. 여러 번 돌려도 된다.
#   실행: 프로젝트 폴더에서  powershell -ExecutionPolicy Bypass -File scripts\build-app.ps1
#   먼저 scripts\setup.ps1(러스트·툴체인)을 한 번 돌려 둔다. Node가 없으면 winget으로 설치한다.
#   결과: 빌드 폴더의 release\bundle\nsis\*.exe (설치하면 시작 메뉴에 '탕방 데이터 수집 도구')
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$env:PATH = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User") + ";$env:USERPROFILE\.cargo\bin"

if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) { throw "⛔ 러스트가 없어요. 먼저 scripts\setup.ps1을 실행해 주세요" }
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Host "설치: Node.js LTS"
    winget install --id OpenJS.NodeJS.LTS -e --silent --accept-source-agreements --accept-package-agreements | Out-Host
    $env:PATH = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User") + ";$env:USERPROFILE\.cargo\bin"
    if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw "⛔ Node를 찾지 못했어요. 터미널을 새로 열고 다시 실행해 주세요" }
}
if (-not (Test-Path .cargo\config.toml) -and ($root -match '[^\x21-\x7E]')) { throw "⛔ 빌드 폴더 설정이 없어요. 먼저 scripts\setup.ps1을 실행해 주세요" }

Set-Location collector
npm ci --no-audit --no-fund | Out-Host
npx tauri build --bundles nsis | Out-Host
if ($LASTEXITCODE -ne 0) { throw "⛔ 앱 빌드에 실패했어요. 위 오류를 확인해 주세요" }

$meta = cargo metadata --format-version 1 --no-deps --manifest-path src-tauri\Cargo.toml | ConvertFrom-Json
$exe = Get-ChildItem (Join-Path $meta.target_directory "release\bundle\nsis") -Filter *.exe | Sort-Object LastWriteTime | Select-Object -Last 1
Write-Host "`n준비 끝. 설치 파일: $($exe.FullName)"
Write-Host "설치한 뒤 시작 메뉴에서 '탕방 데이터 수집 도구'를 열고, 처음 한 번 이 프로젝트 폴더($root)를 골라 주세요."
