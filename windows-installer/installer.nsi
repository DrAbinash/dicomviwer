; ============================================================================
; installer.nsi - DICOM Viewer Windows Setup
; NSIS 3.x, MUI2. Built by scripts/make-windows-installer.sh with:
;   makensis -DXVERMAJOR=0 -DXVERMINOR=7 -DXVERPATCH=0 -DOUTFILE=... installer.nsi
; ============================================================================

Unicode true
!include "MUI2.nsh"

!ifndef XVERMAJOR
  !define XVERMAJOR 0
!endif
!ifndef XVERMINOR
  !define XVERMINOR 7
!endif
!ifndef XVERPATCH
  !define XVERPATCH 0
!endif
!ifndef OUTFILE
  !define OUTFILE "DicomViewer-Setup.exe"
!endif

Name "DICOM Viewer"
OutFile "${OUTFILE}"
InstallDir "$PROGRAMFILES64\DicomViewer"
InstallDirRegKey HKLM "Software\DicomViewer" "InstallDir"
RequestExecutionLevel admin
ShowInstDetails show
ShowUnInstDetails show
SetCompressor /SOLID lzma

VIProductVersion "${XVERMAJOR}.${XVERMINOR}.${XVERPATCH}.0"
VIAddVersionKey ProductName "DICOM Viewer"
VIAddVersionKey FileDescription "DICOM Viewer Windows Setup"
VIAddVersionKey ProductVersion "${XVERMAJOR}.${XVERMINOR}.${XVERPATCH}"
VIAddVersionKey FileVersion "${XVERMAJOR}.${XVERMINOR}.${XVERPATCH}"
VIAddVersionKey LegalCopyright "Dicom Viewer project"

!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\START-VIEWER.bat"
!define MUI_FINISHPAGE_RUN_TEXT "Start DICOM Viewer now"
!define MUI_FINISHPAGE_SHOWREADME "$INSTDIR\README-INSTALL.txt"
!define MUI_FINISHPAGE_SHOWREADME_TEXT "Show the quick-start guide"

!insertmacro MUI_PAGE_LICENSE "LICENSE-TRIAL.txt"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

; ----------------------------------------------------------------------------
Section "Install"
  SetOutPath "$INSTDIR"
  File /r "payload\*.*"
  ; ---- data home (writable by normal users, survives upgrades) ----
  ReadEnvStr $R0 "ProgramData"
  CreateDirectory "$R0\DicomViewer"
  CreateDirectory "$R0\DicomViewer\db"
  CreateDirectory "$R0\DicomViewer\received"
  ; grant the built-in Users group (locale-independent SID) modify rights
  nsExec::ExecToLog 'icacls "$R0\DicomViewer" /grant *S-1-5-32-545:(OI)(CI)M /T /Q'

  ; ---- firewall (best effort; errors are non-fatal) ----
  nsExec::Exec 'netsh advfirewall firewall add rule name="DICOM Viewer Web (TCP 4310)" dir=in action=allow protocol=TCP localport=4310'
  nsExec::Exec 'netsh advfirewall firewall add rule name="DICOM Viewer DICOM (TCP 4104)" dir=in action=allow protocol=TCP localport=4104'

  ; ---- shortcuts (all users) ----
  SetShellVarContext all
  CreateDirectory "$SMPROGRAMS\Dicom Viewer"
  !ifdef HAVE_ICON
    CreateShortcut "$SMPROGRAMS\Dicom Viewer\DICOM Viewer.lnk" "$INSTDIR\START-VIEWER.bat" "" "$INSTDIR\viewer.ico" 0
    CreateShortcut "$DESKTOP\DICOM Viewer.lnk" "$INSTDIR\START-VIEWER.bat" "" "$INSTDIR\viewer.ico" 0
  !else
    CreateShortcut "$SMPROGRAMS\Dicom Viewer\DICOM Viewer.lnk" "$INSTDIR\START-VIEWER.bat"
    CreateShortcut "$DESKTOP\DICOM Viewer.lnk" "$INSTDIR\START-VIEWER.bat"
  !endif
  CreateShortcut "$SMPROGRAMS\Dicom Viewer\Stop DICOM Viewer.lnk" "$INSTDIR\STOP-VIEWER.bat"
  CreateShortcut "$SMPROGRAMS\Dicom Viewer\Quick-start guide.lnk" "$INSTDIR\README-INSTALL.txt"

  WriteRegStr HKLM "Software\DicomViewer" "InstallDir" "$INSTDIR"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\DicomViewer" \
                 "DisplayName" "DICOM Viewer"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\DicomViewer" \
                 "UninstallString" '"$INSTDIR\Uninstall DICOM Viewer.exe"'
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\DicomViewer" \
                 "DisplayVersion" "${XVERMAJOR}.${XVERMINOR}.${XVERPATCH}"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\DicomViewer" \
                 "Publisher" "Dicom Viewer project"
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\DicomViewer" \
                 "EstimatedSize" 350000

  WriteUninstaller "$INSTDIR\Uninstall DICOM Viewer.exe"
SectionEnd

; ----------------------------------------------------------------------------
Section "Uninstall"
  ; stop the app if it is running (only OUR node.exe - matched by path)
  nsExec::Exec "powershell -NoProfile -ExecutionPolicy Bypass -Command $\"Get-Process node -ErrorAction SilentlyContinue | Where-Object Path -like '$INSTDIR*' | Stop-Process -Force$\""

  SetShellVarContext all
  Delete "$SMPROGRAMS\Dicom Viewer\*.*"
  RMDir "$SMPROGRAMS\Dicom Viewer"
  Delete "$DESKTOP\DICOM Viewer.lnk"

  RMDir /r "$INSTDIR"

  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\DicomViewer"
  DeleteRegKey HKLM "Software\DicomViewer"

  ReadEnvStr $R0 "ProgramData"
  nsExec::Exec 'netsh advfirewall firewall delete rule name="DICOM Viewer Web (TCP 4310)"'
  nsExec::Exec 'netsh advfirewall firewall delete rule name="DICOM Viewer DICOM (TCP 4104)"'
  MessageBox MB_YESNO|MB_ICONQUESTION \
    "Do you also want to DELETE the patient data (database, received studies, license)?$\n$\n$R0\DicomViewer" \
    IDNO +2
  RMDir /r "$R0\DicomViewer"
SectionEnd
