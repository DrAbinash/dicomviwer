@echo off
setlocal EnableExtensions
title DICOM Viewer - Reset Admin Login
set "PKG=%~dp0"
set "NODE_EXE=%PKG%runtime\node.exe"

if not exist "%NODE_EXE%" (
  echo [ERROR] runtime\node.exe is missing. Re-extract the zip package completely.
  pause
  exit /b 1
)

set "DBURL=%PKG:\=/%"
set "DATABASE_URL=file:%DBURL%app/db/custom.db"

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
