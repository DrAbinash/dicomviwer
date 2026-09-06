@echo off
setlocal EnableExtensions
title DICOM Viewer - Reset Admin Login
set "PKG=%~dp0"
set "NODE_EXE=%PKG%runtime\node.exe"
set "DATAHOME=%ProgramData%\DicomViewer"
set "DBURL=%DATAHOME:\=/%"
set "DATABASE_URL=file:%DBURL%/db/custom.db"

if not exist "%NODE_EXE%" (
  echo [ERROR] runtime\node.exe is missing. Reinstall the application.
  pause
  exit /b 1
)

echo This resets the viewer login back to the factory default:
echo    username: admin
echo    password: admin
echo.
choice /c YN /m "Reset login now"
if errorlevel 2 exit /b 0

"%NODE_EXE%" "%PKG%app\scripts\reset-admin.mjs"
echo.
echo Now start (or restart) the viewer and sign in with admin / admin.
echo Change the password in Settings - Security afterwards.
pause
