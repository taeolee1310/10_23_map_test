@echo off
rem Tangbang report desk launcher (double-click). Comments are ASCII so cmd reads this file in any code page.
rem Runs from the project folder, rebuilds only when the code changed, then opens the desk in its own app window.
rem This console closes by itself once the app window is up. Close the app window to stop the report desk.
chcp 65001 >nul
title Tangbang Report Desk
cd /d "%~dp0.."
cargo run --release --quiet --bin report_desk -- --app %*
if errorlevel 1 (
  echo.
  echo [report desk] could not start. If the report desk is already open, close it and try again.
  echo Read the message above, then press any key.
  pause >nul
)
