@echo off
setlocal EnableExtensions
title DICOM Viewer v0.6.0
set "PKG=%~dp0"
set "NODE_EXE=%PKG%runtime\node.exe"
set "APP=%PKG%app"

if not exist "%NODE_EXE%" (
  echo [ERROR] runtime\node.exe is missing. Re-extract the zip package completely.
  pause
  exit /b 1
)
if not exist "%APP%\server.js" (
  echo [ERROR] app\server.js is missing. Re-extract the zip package completely.
  pause
  exit /b 1
)
if not exist "%APP%\db\custom.db" (
  echo [ERROR] app\db\custom.db is missing. Re-extract the zip package completely.
  pause
  exit /b 1
)

rem ----- configuration (edit these two lines if needed) -----
set "PORT=3000"
set "DICOM_PORT=4104"

rem ----- server environment (no need to change below) -----
set "NODE_ENV=production"
set "HOSTNAME=0.0.0.0"
set "DVV_LISTEN_PORT=%DICOM_PORT%"
set "DVV_RECEIVED_DIR=%APP%\db\dicom-received"
set "DBURL=%PKG:\=/%"
set "DATABASE_URL=file:%DBURL%app/db/custom.db"

cd /d "%APP%"

echo ==============================================================
echo   DICOM Viewer v0.6.0  -  self-hosted web DICOM viewer
echo --------------------------------------------------------------
echo   Web interface : http://localhost:%PORT%
echo   LAN access    : http://^<this-pc-ip^>:%PORT%  (see README 5)
echo   DICOM listener : enable in Settings - PACS (port %DICOM_PORT%)
echo   First login   : admin / admin   (change it in Settings!)
echo --------------------------------------------------------------
echo   Keep this window open. Close it (or press Ctrl+C) to stop.
echo ==============================================================

rem open the default browser once the server has had a moment to boot
start "" /min cmd /c "timeout /t 3 /nobreak >nul & start "" http://localhost:%PORT%"

"%NODE_EXE%" server.js

echo.
echo Server stopped.
pause
