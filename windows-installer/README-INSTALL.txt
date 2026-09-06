DICOM VIEWER v0.7.0 - Windows installer
========================================

WHAT WAS INSTALLED
  Program files : C:\Program Files\DicomViewer
  Data home     : C:\ProgramData\DicomViewer
                  (database, received DICOM files, license.key)
  Shortcuts     : Start Menu + Desktop ("DICOM Viewer")

FIRST START
  1. Double-click "DICOM Viewer" (Start Menu or Desktop).
     A console window opens and your browser shows the viewer.
     If the browser does not open by itself, go to:
         http://localhost:4310
  2. Sign in:  admin / admin   (change it in Settings > Security).
  3. If you received a TRIAL KEY: paste it into the activation
     screen shown on first start. Without a key the viewer stays
     locked.

GIVE OTHER DEVICES ACCESS (same network)
  Right-click OPEN-FIREWALL-PORTS.bat > Run as administrator (once).
  Then open  http://<this-pc-ip>:4310  on any phone/PC in the clinic.
  Find the PC's IP with:  ipconfig

RECEIVE DICOM STUDIES FROM MODALITIES / OTHER PACS
  Settings > PACS > Listener: enable it (AE title DICOMVIEWER,
  port 4104), then point your modality's C-STORE destination at
  <this-pc-ip>:4104.

DAILY USE
  * Start  : "DICOM Viewer" shortcut (keep the console window open)
  * Stop   : close the console window, or STOP-VIEWER.bat
  * Reset forgotten login to admin/admin : RESET-ADMIN.bat

DATA LOCATIONS (for backup)
  Database      C:\ProgramData\DicomViewer\db\custom.db
  Received DICOM C:\ProgramData\DicomViewer\received
  License key   C:\ProgramData\DicomViewer\license.key

UPGRADES
  Install the new Setup.exe over the old one. Patient data in
  C:\ProgramData\DicomViewer is untouched.

UNINSTALL
  Windows Settings > Apps > DICOM Viewer > Uninstall.
  You will be asked whether to keep the patient data folder.

TROUBLESHOOTING
  * Port busy (4310/4104): edit the two port lines at the top of
    START-VIEWER.bat, then re-run OPEN-FIREWALL-PORTS.bat with the
    matching numbers.
  * "License locked" after a date/time change: set the clock
    correctly, then ask your supplier for a fresh key - activating a
    fresh key unlocks the software.
  * Browser did not open: start the shortcut again and use
    http://localhost:4310 manually.
