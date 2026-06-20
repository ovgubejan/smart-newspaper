@echo off
chcp 65001 >nul 2>nul
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"
title Smart Newspaper - Tam Proje Baslatici

set "APP_NAME=Smart Newspaper - Black Mamba"
set "PORT=3000"
set "APP_URL=http://localhost:%PORT%"
set "LOG_FILE=%TEMP%\smart-newspaper-server.log"
set "ERR_FILE=%TEMP%\smart-newspaper-server-error.log"
set "CHECK_FILE=%TEMP%\smart-newspaper-server-check.txt"

echo.
echo ==================================================
echo  %APP_NAME%
echo  Frontend + Backend + DB + Eklentiler Baslatici
echo ==================================================
echo.

echo [1/9] Node.js ve npm kontrol ediliyor...
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
where npm.cmd >nul 2>nul
if errorlevel 1 (
    echo.
    echo HATA: npm bulunamadi. Node.js kurulumunu kontrol et.
    echo.
    pause
    exit /b 1
)
for /f "tokens=*" %%V in ('node -v') do set "NODE_VERSION=%%V"
for /f "tokens=*" %%V in ('npm.cmd -v') do set "NPM_VERSION=%%V"
echo      Node.js: !NODE_VERSION!
echo      npm:     !NPM_VERSION!

echo.
echo [2/9] Proje dosyalari kontrol ediliyor...
if not exist "package.json" (
    echo HATA: package.json bu klasorde bulunamadi.
    echo Bu BAT dosyasini proje ana klasorunden calistir.
    pause
    exit /b 1
)
if not exist "server.js" (
    echo HATA: server.js bu klasorde bulunamadi.
    pause
    exit /b 1
)
if not exist "index.html" (
    echo HATA: index.html bu klasorde bulunamadi.
    pause
    exit /b 1
)
if not exist "build.js" (
    echo HATA: build.js bu klasorde bulunamadi.
    pause
    exit /b 1
)
echo      Frontend ve backend ana dosyalari hazir.

echo.
echo [3/9] .env kontrol ediliyor...
if not exist ".env" (
    if exist ".env.example" (
        copy /y ".env.example" ".env" >nul
        echo      .env dosyasi .env.example uzerinden olusturuldu.
    ) else (
        (
            echo PORT=3000
            echo APP_ORIGIN=http://localhost:3000
            echo SESSION_SECRET=dev-session-secret-change-me
            echo NEWS_REFRESH_INTERVAL_HOURS=23
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

findstr /b /i "APP_ORIGIN=" ".env" >nul 2>nul
if errorlevel 1 (
    >> ".env" echo APP_ORIGIN=%APP_URL%
    echo      APP_ORIGIN .env dosyasina eklendi.
)
findstr /b /i "SESSION_SECRET=" ".env" >nul 2>nul
if errorlevel 1 (
    >> ".env" echo SESSION_SECRET=dev-session-secret-change-me
    echo      SESSION_SECRET .env dosyasina eklendi.
)

echo.
echo [4/9] Veritabani kontrol ediliyor...
if not exist "db" (
    mkdir "db"
    echo      db klasoru olusturuldu.
)
if not exist "db\demo-regional-pandemic.json" (
    echo HATA: db\demo-regional-pandemic.json bulunamadi.
    echo Sunucu bu demo veri dosyasina ihtiyac duyuyor.
    pause
    exit /b 1
)
if not exist "db\data.json" (
    if exist "db\seed.json" (
        copy /y "db\seed.json" "db\data.json" >nul
        echo      db\data.json seed dosyasindan olusturuldu.
    ) else (
        > "db\data.json" echo {"users":[],"articles":[],"bookmarks":[],"readStatus":[],"articleEvents":[],"userArticleEvents":[],"preferences":{},"financePreferences":{},"userSources":[],"sourceContentCache":{},"savedSearches":[],"institutionalEvents":[],"eventReadStatus":[],"eventReminders":[],"hiddenEvents":[],"ingestionRuns":[],"sharedNews":[],"notifications":[]}
        echo      Bos db\data.json olusturuldu.
    )
) else (
    echo      db\data.json mevcut.
)

echo.
echo [5/9] Node paketleri ve eklentiler kontrol ediliyor...
if not exist "node_modules" (
    echo      node_modules bulunamadi. Paketler kuruluyor...
    if exist "package-lock.json" (
        call npm.cmd ci
    ) else (
        call npm.cmd install
    )
    if errorlevel 1 (
        echo.
        echo HATA: Paket kurulumu basarisiz oldu.
        echo Internet baglantisini ve npm erisimini kontrol edip tekrar dene.
        pause
        exit /b 1
    )
) else (
    node -e "require.resolve('esbuild')" >nul 2>nul
    if errorlevel 1 (
        echo      Eksik paketler var. npm install calistiriliyor...
        call npm.cmd install
        if errorlevel 1 (
            echo.
            echo HATA: Eksik paketler yuklenemedi.
            pause
            exit /b 1
        )
    ) else (
        echo      Paketler hazir.
    )
)

echo.
echo [6/9] Frontend build aliniyor...
call npm.cmd run build
if errorlevel 1 (
    echo.
    echo HATA: Frontend build basarisiz oldu.
    pause
    exit /b 1
)
if not exist "dist\app.min.js" (
    echo HATA: dist\app.min.js olusmadi.
    pause
    exit /b 1
)
if not exist "dist\style.min.css" (
    echo HATA: dist\style.min.css olusmadi.
    pause
    exit /b 1
)
echo      Frontend dist dosyalari hazir.

echo.
echo [7/9] Backend JavaScript kontrol ediliyor...
node --check server.js >nul 2>"%ERR_FILE%"
if errorlevel 1 (
    echo HATA: server.js icinde JavaScript hatasi var.
    type "%ERR_FILE%"
    pause
    exit /b 1
)
echo      server.js kontrolu basarili.

echo.
echo [8/9] Port %PORT% kontrol ediliyor...
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
echo ==================================================
echo  SISTEM BASLATILIYOR
echo.
echo  Frontend:    %APP_URL%
echo  Backend API: %APP_URL%/api/health
echo  Admin panel: %APP_URL%/admin.html
echo  DB:          db\data.json
echo.
echo  Bu pencere acik kaldigi surece sunucu calisir.
echo  Kapatmak icin Ctrl+C yap veya pencereyi kapat.
echo ==================================================
echo.

echo [9/9] Sunucu calistiriliyor...
if /i not "%SMART_NEWS_NO_OPEN%"=="1" (
    start "" /min powershell -NoProfile -ExecutionPolicy Bypass -Command "$url='%APP_URL%'; for($i=1; $i -le 45; $i++){ try { $r=Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2; if($r.StatusCode -ge 200 -and $r.StatusCode -lt 500){ Start-Process $url; break } } catch { Start-Sleep -Seconds 1 } }"
)

node server.js

echo.
echo Sunucu kapandi.
pause
