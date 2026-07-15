@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo ============================================================
echo  on/off 스프레드 일일 갱신
echo ============================================================
echo.

REM [1/4] xlsx 변환 + 구조 검증 (admin과 바이트 동일 구조 검증 포함, 실패 시 즉시 중단)
echo [1/4] xlsx 변환 + 구조 검증 ...
node tools\convert-onoff.mjs
if errorlevel 1 goto convert_fail
echo.

REM [2/4] data/onoff-ktb3y.js 변경 여부 확인 (빈 커밋 방지)
echo [2/4] 변경 여부 확인 ...
git diff --quiet data/onoff-ktb3y.js
if errorlevel 1 (goto has_change) else (goto no_change)

:no_change
echo   갱신분 없음 — 데이터 변화가 없어 커밋하지 않고 종료합니다.
goto end_ok

:has_change
REM [3/4] 최신 날짜 읽어 커밋 메시지 자동 생성
echo [3/4] 커밋 메시지 생성 ...
set "LASTDATE="
for /f "usebackq delims=" %%D in (`node -e "global.window={};const fs=require('fs');eval(fs.readFileSync('data/onoff-ktb3y.js','utf8'));process.stdout.write(window.ONOFF_KTB3Y.updated)"`) do set "LASTDATE=%%D"
if not defined LASTDATE goto date_fail
set "MSG=data: on/off 스프레드 !LASTDATE! 갱신"
echo   !MSG!
echo.

REM [4/4] git add / commit / push
echo [4/4] git add / commit / push ...
git add data/onoff-ktb3y.js
if errorlevel 1 goto git_fail
git commit -m "!MSG!"
if errorlevel 1 goto git_fail
git push origin main
if errorlevel 1 goto push_fail
echo.
echo ============================================================
echo  [성공] !LASTDATE! 갱신분 커밋 + push 완료.
echo ============================================================
goto end_ok

:convert_fail
echo.
echo [실패] 변환/구조 검증 실패 — 위 에러 메시지 확인. 커밋하지 않았습니다.
goto end_err

:date_fail
echo.
echo [실패] 최신 날짜를 읽지 못했습니다. 커밋하지 않았습니다.
goto end_err

:git_fail
echo.
echo [실패] git add/commit 실패 — 위 메시지 확인.
goto end_err

:push_fail
echo.
echo [실패] 커밋은 완료됐으나 push 실패 — 네트워크/인증 확인 후 'git push origin main' 재시도.
goto end_err

:end_ok
echo.
pause
exit /b 0

:end_err
echo.
pause
exit /b 1
