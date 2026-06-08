@echo off
chcp 65001 >nul 2>nul
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"
title Smart Newspaper - Black Mamba Baslatici

set "APP_NAME=Smart Newspaper - Black Mamba"
set "PORT=3000"
set "LOG_FILE=%TEMP%\smart-newspaper-black-mamba.log"
set "ERR_FILE=%TEMP%\smart-newspaper-black-mamba-error.log"
set "CHECK_FILE=%TEMP%\smart-newspaper-black-mamba-check.txt"

echo.
echo ==================================================
echo  %APP_NAME%
echo  Tek tikla kurulum ve calistirma
echo ==================================================
echo.

echo [1/7] Node.js kontrol ediliyor...
where node >nul 2>nul
if errorlevel 1 (
    echo.
    echo HATA: Node.js bulunamadi.
    echo Once Node.js LTS surumunu kur: https://nodejs.org/
    echo Kurulumdan sonra bu dosyayi tekrar calistir.
    echo.
    pause
    exit /b 1
)
for /f "tokens=*" %%V in ('node -v') do set "NODE_VERSION=%%V"
echo      Node.js bulundu: !NODE_VERSION!

echo.
echo [2/7] Proje dosyalari kontrol ediliyor...
if not exist "server.js" (
    echo HATA: server.js bu klasorde bulunamadi.
    echo Bu BAT dosyasini proje ana klasorunden calistir.
    pause
    exit /b 1
)
if not exist "index.html" (
    echo HATA: index.html bu klasorde bulunamadi.
    pause
    exit /b 1
)
echo      Ana dosyalar hazir.

echo.
echo [3/7] .env kontrol ediliyor...
if not exist ".env" (
    if exist ".env.example" (
        copy /y ".env.example" ".env" >nul
        echo      .env dosyasi .env.example uzerinden olusturuldu.
        echo      API anahtarlari gerekiyorsa .env icinden doldurabilirsin.
    ) else (
        (
            echo PORT=3000
            echo APP_ORIGIN=http://localhost:3000
            echo SESSION_SECRET=dev-session-secret-change-me
        ) > ".env"
        echo      Temel .env dosyasi olusturuldu.
    )
) else (
    echo      .env mevcut.
)

for /f "usebackq tokens=1,* delims==" %%A in (".env") do (
    set "ENV_KEY=%%A"
    set "ENV_VAL=%%B"
    if /i "!ENV_KEY!"=="PORT" if not "!ENV_VAL!"=="" set "PORT=!ENV_VAL!"
)
set "PORT=%PORT: =%"
set "APP_URL=http://localhost:%PORT%"
echo      Kullanilacak adres: %APP_URL%

echo.
echo [4/7] Veritabani kontrol ediliyor...
if not exist "db" (
    mkdir "db"
    echo      db klasoru olusturuldu.
)
if not exist "db\data.json" (
    if exist "db\seed.json" (
        copy /y "db\seed.json" "db\data.json" >nul
        echo      db\data.json seed dosyasindan olusturuldu.
    ) else (
        > "db\data.json" echo {"users":[],"articles":[],"bookmarks":[],"articleEvents":[],"preferences":{},"userSources":[],"savedSearches":[],"institutionalEvents":[],"eventReadStatus":[],"hiddenEvents":[],"ingestionRuns":[],"sharedNews":[]}
        echo      Bos db\data.json olusturuldu.
    )
) else (
    echo      db\data.json mevcut.
)

echo.
echo [5/7] Port %PORT% kontrol ediliyor...
set "FOUND_PID="
for /f "tokens=5" %%P in ('netstat -ano 2^>nul ^| findstr /r /c:":%PORT% .*LISTENING"') do (
    set "FOUND_PID=%%P"
)
if defined FOUND_PID (
    echo      Port %PORT% kullanan eski surec kapatiliyor. PID: !FOUND_PID!
    taskkill /PID !FOUND_PID! /F >nul 2>nul
    timeout /t 2 /nobreak >nul
) else (
    echo      Port bos.
)

del "%LOG_FILE%" "%ERR_FILE%" "%CHECK_FILE%" >nul 2>nul

echo.
echo [6/7] Sunucu hazirlaniyor...
node --check server.js >nul 2>"%ERR_FILE%"
if errorlevel 1 (
    echo HATA: server.js icinde JavaScript hatasi var.
    type "%ERR_FILE%"
    pause
    exit /b 1
)
echo      server.js kontrolu basarili.

echo.
echo ==================================================
echo  SISTEM BASLATILIYOR
echo  Ana sayfa:   %APP_URL%
echo  Admin panel: %APP_URL%/admin.html
echo.
echo  Sunucu basarili cevap verince tarayici otomatik acilacak.
echo  Kapatmak icin bu pencereyi kapat veya Ctrl+C yap.
echo ==================================================
echo.

echo [7/7] Sunucu calistiriliyor...
if /i not "%SMART_NEWS_NO_OPEN%"=="1" (
    start "" /min powershell -NoProfile -ExecutionPolicy Bypass -Command "$url='%APP_URL%'; for($i=1; $i -le 30; $i++){ try { $r=Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2; if($r.StatusCode -ge 200 -and $r.StatusCode -lt 500){ Start-Process $url; break } } catch { Start-Sleep -Seconds 1 } }"
)

node server.js

echo.
echo Sunucu kapandi.
pause
