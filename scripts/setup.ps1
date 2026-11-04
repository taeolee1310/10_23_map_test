# 새 PC(윈도우)에서 데이터 도구(러스트)를 쓸 수 있게 맞춘다. 여러 번 돌려도 된다.
#   실행: 프로젝트 폴더에서  powershell -ExecutionPolicy Bypass -File scripts\setup.ps1
# 하는 일
#   1) 러스트가 없으면 winget으로 rustup 설치
#   2) Visual Studio C++ 빌드 도구가 없으면 GNU 툴체인 + MinGW(dlltool) 설치
#   3) 프로젝트 경로에 한글·공백이 있으면 영문 빌드 폴더를 정해 .cargo/config.toml(깃에 안 올림)에 적음
#      (윈도우 GNU 링커가 한글 경로에서 실패해서)
#   4) cargo fetch + cargo build --release, 끝나면 도구 목록 출력
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Refresh-Path {
    $env:PATH = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User") + ";$env:USERPROFILE\.cargo\bin"
}
function Has($cmd) { [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }
function Winget-Install($id) {
    if (-not (Has "winget")) { throw "⛔ winget이 없어요. Microsoft Store의 '앱 설치 관리자'를 설치한 뒤 다시 실행해 주세요" }
    Write-Host "설치: $id"
    winget install --id $id -e --silent --accept-source-agreements --accept-package-agreements | Out-Host
    Refresh-Path
}

Refresh-Path

# 1) 러스트
if (-not (Has "rustup")) { Winget-Install "Rustlang.Rustup" }
if (-not (Has "rustup")) { throw "⛔ rustup을 찾지 못했어요. 터미널을 새로 열고 다시 실행해 주세요" }

# 2) 툴체인: MSVC 링커가 있으면 MSVC, 없으면 GNU + MinGW
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$hasMsvc = (Test-Path $vswhere) -and [bool](& $vswhere -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath)
if ($hasMsvc) {
    $toolchain = "stable-x86_64-pc-windows-msvc"
} else {
    $toolchain = "stable-x86_64-pc-windows-gnu"
    if (-not (Has "dlltool")) {
        Winget-Install "BrechtSanders.WinLibs.POSIX.UCRT"
        if (-not (Has "dlltool")) {
            $d = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Recurse -Filter dlltool.exe -ErrorAction SilentlyContinue | Select-Object -First 1
            if (-not $d) { throw "⛔ MinGW의 dlltool을 찾지 못했어요" }
            $env:PATH = "$($d.DirectoryName);$env:PATH"
        }
    }
}
rustup toolchain install $toolchain --profile minimal | Out-Host
rustup override set $toolchain | Out-Host   # 이 프로젝트 폴더에서만 쓰는 툴체인
Write-Host "툴체인: $toolchain"

# 3) 빌드 폴더: 경로가 영문이면 기본(target/), 아니면 영문 경로
$config = Join-Path $root ".cargo\config.toml"
$ascii = { param($p) $p -notmatch '[^\x21-\x7E]' }   # 공백·한글이 없으면 true
if (-not $hasMsvc -and -not (& $ascii $root)) {
    $sha = [Security.Cryptography.SHA256]::Create()
    $hash = -join ($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($root))[0..3] | ForEach-Object { $_.ToString("x2") })
    $base = if (& $ascii $env:USERPROFILE) { "$env:USERPROFILE\.cargo\target" } else { "$env:SystemDrive\cargo-target" }
    $dir = (Join-Path $base "tangbang-$hash") -replace '\\', '/'
    New-Item -ItemType Directory -Force (Split-Path $config) | Out-Null
    $body = "# scripts/setup.ps1이 이 PC에 맞춰 만든 파일(깃에 올리지 않음). 프로젝트 경로에 한글·공백이 있어 빌드 결과만 영문 경로에 둔다.`n[build]`ntarget-dir = `"$dir`"`n"
    [IO.File]::WriteAllText($config, $body, (New-Object Text.UTF8Encoding $false))
    Write-Host "빌드 폴더: $dir"
} elseif (Test-Path $config) {
    Remove-Item $config
    Write-Host "빌드 폴더: target/ (기본)"
}

# 4) 받기 + 빌드
cargo fetch | Out-Host
cargo build --release | Out-Host
if ($LASTEXITCODE -ne 0) { throw "⛔ 빌드에 실패했어요. 위 오류를 확인해 주세요" }
$bins = (Get-ChildItem src\bin -Filter *.rs).BaseName -join ", "
Write-Host "`n준비 끝. 실행: cargo run --release --bin <이름>"
Write-Host "도구: $bins"
