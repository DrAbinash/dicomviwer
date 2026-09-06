@echo off
title DICOM Viewer - Stop
echo This stops the DICOM Viewer by ending every running node.exe process.
echo NOTE: other unrelated Node.js applications on this PC would also stop.
echo.
choice /c YN /m "Stop DICOM Viewer now"
if errorlevel 2 exit /b 0
taskkill /f /im node.exe 2>nul
if %errorlevel%==0 (
  echo Stopped.
) else (
  echo No running node.exe process was found.
)
pause
