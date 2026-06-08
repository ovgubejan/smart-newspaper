@echo off
chcp 65001 >nul 2>nul
setlocal EnableDelayedExpansion
cd /d "%~dp0"
title Smart Newspaper - Server

echo.
echo  ╔══════════════════════════════════════════════╗
echo  ║   Smart Newspaper - Kisisel Gazete Platformu ║
echo  ║   Tam Otomatik Baslatici                     ║
echo  ╚══════════════════════════════════════════════╝
echo.

REM ──────────────────────────────────────────
REM 1. Node.js kontrolu
REM ──────────────────────────────────────────
echo [1/6] Node.js kontrol ediliyor...
where node >nul 2>nul
if errorlevel 1 (
    echo.
    echo  HATA: Node.js bulunamadi!
    echo  Lutfen once Node.js yukleyin: https://nodejs.org/
    echo.
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('node -v') do set NODE_VER=%%v
echo        Node.js %NODE_VER% bulundu.

REM ──────────────────────────────────────────
REM 2. .env dosyasi kontrolu
REM ──────────────────────────────────────────
echo [2/6] Ortam dosyalari kontrol ediliyor...
if not exist ".env" (
    echo        UYARI: .env dosyasi bulunamadi!
    echo        API anahtarlari olmadan bazi ozellikler calismayabilir.
    echo        .env dosyasi olusturup GEMINI_API_KEY vb. ekleyin.
) else (
    echo        .env dosyasi mevcut.
)

REM ──────────────────────────────────────────
REM 3. Veritabani kontrolu
REM ──────────────────────────────────────────
echo [3/6] Veritabani kontrol ediliyor...
if not exist "db" (
    mkdir db
    echo        db klasoru olusturuldu.
)
if not exist "db\data.json" (
    if exist "db\seed.json" (
        copy /y "db\seed.json" "db\data.json" >nul
        echo        Veritabani seed'den olusturuldu.
    ) else (
        echo {"users":[],"articles":[],"bookmarks":[],"articleEvents":[],"preferences":{},"userSources":[],"savedSearches":[],"institutionalEvents":[],"eventReadStatus":[],"hiddenEvents":[],"ingestionRuns":[],"sharedNews":[]}> "db\data.json"
        echo        Bos veritabani olusturuldu.
    )
) else (
    echo        Veritabani mevcut.
)

REM ──────────────────────────────────────────
REM 4. Eski surecleri kapat
REM ──────────────────────────────────────────
echo [4/6] Port 3000 kontrol ediliyor...
set "FOUND_PID="
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr /r /c:":3000 .*LISTENING"') do (
    set "FOUND_PID=%%a"
)
if defined FOUND_PID (
    echo        Port 3000 kullanan eski surec kapatiliyor (PID: !FOUND_PID!)...
    taskkill /PID !FOUND_PID! /F >nul 2>nul
    timeout /t 2 /nobreak >nul
    echo        Eski surec kapatildi.
) else (
    echo        Port 3000 bos, hazir.
)

REM ──────────────────────────────────────────
REM 5. Sunucuyu arka planda baslat
REM ──────────────────────────────────────────
echo [5/6] Sunucu baslatiliyor...
start /b "" node server.js > "%TEMP%\smart-newspaper-server.log" 2>&1

REM Sunucunun ayaga kalkmasini bekle
set RETRY=0
:wait_loop
if !RETRY! GEQ 15 (
    echo.
    echo  HATA: Sunucu baslatılamadi!
    echo  Log dosyasi: %TEMP%\smart-newspaper-server.log
    echo.
    type "%TEMP%\smart-newspaper-server.log"
    echo.
    pause
    exit /b 1
)
timeout /t 1 /nobreak >nul
set /a RETRY+=1

REM Sunucuya baglanmayi dene
curl -s -o nul -w "%%{http_code}" http://localhost:3000/ > "%TEMP%\smart-newspaper-check.txt" 2>nul
set /p STATUS=<"%TEMP%\smart-newspaper-check.txt"
if "%STATUS%"=="200" goto server_ready

REM curl yoksa PowerShell ile dene
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri 'http://localhost:3000/' -UseBasicParsing -TimeoutSec 2; if($r.StatusCode -eq 200){'OK'} } catch {}" > "%TEMP%\smart-newspaper-check.txt" 2>nul
set /p PSCHECK=<"%TEMP%\smart-newspaper-check.txt"
if "%PSCHECK%"=="OK" goto server_ready

echo        Bekleniyor... (!RETRY!/15)
goto wait_loop

:server_ready
echo        Sunucu basariyla calisiyor!

REM ──────────────────────────────────────────
REM 6. Tarayiciyi ac
REM ──────────────────────────────────────────
echo [6/6] Tarayici aciliyor...
start "" "http://localhost:3000"

echo.
echo  ╔══════════════════════════════════════════════╗
echo  ║  SUNUCU AKTIF - HAZIR!                       ║
echo  ╠══════════════════════════════════════════════╣
echo  ║                                              ║
echo  ║  Ana Sayfa:    http://localhost:3000          ║
echo  ║  Admin Panel:  http://localhost:3000/admin    ║
echo  ║                                              ║
echo  ║  Ozellikler:                                 ║
echo  ║    * AI Chatbot (Gemini)                     ║
echo  ║    * Haber Paylasim (Surukle-Birak)          ║
echo  ║    * Ulke Bazli Trendler                     ║
echo  ║    * Interaktif Harita Filtre                ║
echo  ║    * E-Gazete / PDF Export                   ║
echo  ║    * Ekonomi Radari                          ║
echo  ║    * Push Bildirimler                        ║
echo  ║    * Benzer Haber Karsilastirma              ║
echo  ║    * 40+ Uluslararasi Kaynak (BBC, NYT...)   ║
echo  ║                                              ║
echo  ║  Kapatmak icin bu pencereyi kapatin          ║
echo  ║  veya Ctrl+C yapin.                          ║
echo  ╚══════════════════════════════════════════════╝
echo.

REM Sunucu acik kalsin - pencere kapaninca node da kapansin
:keep_alive
timeout /t 5 /nobreak >nul

REM Node hala calisiyor mu kontrol et
tasklist /fi "imagename eq node.exe" 2>nul | findstr /i "node.exe" >nul
if errorlevel 1 (
    echo.
    echo  Sunucu kapandi. Log:
    type "%TEMP%\smart-newspaper-server.log" 2>nul
    echo.
    pause
    exit /b 1
)
goto keep_alive
