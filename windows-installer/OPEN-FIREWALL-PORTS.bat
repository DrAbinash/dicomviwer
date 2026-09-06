@echo off
title DICOM Viewer - Firewall
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Please right-click this file and choose "Run as administrator".
  pause
  exit /b 1
)
echo Adding Windows Firewall inbound rules...
netsh advfirewall firewall add rule name="DICOM Viewer Web (TCP 4310)" dir=in action=allow protocol=TCP localport=4310 >nul
netsh advfirewall firewall add rule name="DICOM Viewer DICOM (TCP 4104)" dir=in action=allow protocol=TCP localport=4104 >nul
echo Done. Other devices on the network can now reach this PC at:
echo   Web  : http://^<this-pc-ip^>:4310
echo   DICOM: ^<this-pc-ip^>:4104  (AE title DICOMVIEWER)
echo.
echo Find this PC's IP address with the command:  ipconfig
echo If you changed the ports in START-VIEWER.bat, edit the numbers
echo in this file to match.
pause
