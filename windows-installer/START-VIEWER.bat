@echo off
setlocal EnableExtensions
title DICOM Viewer v0.7.0
set "PKG=%~dp0"
set "NODE_EXE=%PKG%runtime\node.exe"
set "APP=%PKG%app"

if not exist "%NODE_EXE%" (
  echo [ERROR] runtime\node.exe is missing. Reinstall the application.
  pause
  exit /b 1
)
if not exist "%APP%\server.js" (
  echo [ERROR] app\server.js is missing. Reinstall the application.
  pause
  exit /b 1
)

rem ----- data home (survives upgrades, writable without admin) -----
set "DATAHOME=%ProgramData%\DicomViewer"
if not exist "%DATAHOME%\db" mkdir "%DATAHOME%\db" >nul 2>&1
if not exist "%DATAHOME%\received" mkdir "%DATAHOME%\received" >nul 2>&1
if not exist "%DATAHOME%\db\custom.db" (
  if exist "%PKG%template\custom.db" (
    copy /y "%PKG%template\custom.db" "%DATAHOME%\db\custom.db" >nul
  )
)

rem ----- configuration (edit these two lines if needed) -----
set "PORT=4310"
set "DICOM_PORT=4104"

rem ----- server environment (no need to change below) -----
set "NODE_ENV=production"
set "HOSTNAME=0.0.0.0"
set "DVV_LISTEN_PORT=%DICOM_PORT%"
set "DVV_RECEIVED_DIR=%DATAHOME%\received"
set "DVV_LICENSE_FILE=%DATAHOME%\license.key"
set "DBURL=%DATAHOME:\=/%"
set "DATABASE_URL=file:%DBURL%/db/custom.db"

cd /d "%APP%"

echo ==============================================================
echo   DICOM Viewer v0.7.0  -  self-hosted web DICOM viewer
echo --------------------------------------------------------------
echo   Web interface  : http://localhost:%PORT%
echo   LAN access     : http://^<this-pc-ip^>:%PORT%  (see README)
echo   DICOM listener : enable in Settings - PACS (port %DICOM_PORT%)
echo   First login    : admin / admin   (change it in Settings!)
echo   License file   : %DATAHOME%\license.key
echo --------------------------------------------------------------
echo   Keep this window open. Close it (or press Ctrl+C) to stop.
echo ==============================================================

rem open the default browser once the server has had a moment to boot
start "" /min cmd /c "timeout /t 3 /nobreak >nul & start "" http://localhost:%PORT%"

"%NODE_EXE%" server.js

echo.
echo Server stopped.
pause
