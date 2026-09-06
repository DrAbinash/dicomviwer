================================================================
  DICOM VIEWER v0.7.0 - WINDOWS DEPLOYMENT PACKAGE (OFFLINE)
================================================================

A self-hosted, RadiAnt-style web DICOM viewer with a built-in
DICOM node (C-STORE SCP listener + C-ECHO / C-FIND / C-GET /
C-MOVE SCU), SQLite storage, and automatic retention.

This package is SELF-CONTAINED. It ships its own Node.js
runtime and every npm dependency, including the Windows-native
binaries (Prisma engine, sharp codecs). Nothing needs to be
installed and no internet connection is required to run it.

----------------------------------------------------------------
0. TRIAL ACTIVATION (IMPORTANT - read this first)
----------------------------------------------------------------
This build ships WITHOUT a license key, so the first start shows
the ACTIVATION screen instead of the viewer. Nothing works until
a key is installed - that is by design (trial licensing).

To activate, either:
  a) paste the license key you received into the activation
     screen, or
  b) drop the license.key file into this folder (next to
     START-VIEWER.bat).

The key encodes an expiry date. After that date the viewer stops
working (web UI, APIs, DICOM receiver) until you get a fresh key.
Patient data is kept while locked. The clock must be set
correctly: rolling it back locks the license.

Self-testing? Generate a key with the vendor kit:
  node license-keygen.mjs --name "Test" --days 7 --out license.key


----------------------------------------------------------------
1. REQUIREMENTS
----------------------------------------------------------------
- Windows 10 or 11, 64-bit
- About 500 MB of free disk space
- No admin rights needed to run (admin is only needed once for
  the optional firewall helper, section 5)

----------------------------------------------------------------
2. QUICK START (3 STEPS)
----------------------------------------------------------------
1) Extract the whole zip to a folder with a SIMPLE path, e.g.

      C:\DICOMViewer

   Avoid OneDrive / Desktop sync folders. Do not move the
   folder later (see section 9).

2) Double-click  START-VIEWER.bat
   Windows SmartScreen may warn about an unrecognized app:
   click "More info" -> "Run anyway".

3) Your browser opens http://localhost:3000

      Login:  admin
      Pass :  admin    (change it in Settings > Security!)

That's it. Keep the black console window open while using the
viewer; closing it stops the server.

----------------------------------------------------------------
3. WHAT'S INSIDE
----------------------------------------------------------------
app\      The built application (Next.js standalone server) with
          all npm dependencies (node_modules), the Windows
          Prisma engine, and a pre-seeded SQLite database at
          app\db\custom.db
runtime\  Portable Node.js v22 LTS (node.exe), nothing else
START-VIEWER.bat          Start the server + open the browser
STOP-VIEWER.bat           Stop the server (ends node.exe)
OPEN-FIREWALL-PORTS.bat   Allow LAN access (run as administrator)
RESET-ADMIN.bat           Reset the login back to admin / admin
README-WINDOWS.txt        This file

----------------------------------------------------------------
4. PORTS AND ENDPOINTS
----------------------------------------------------------------
Web UI : http://localhost:3000          (PORT in START-VIEWER.bat)
DICOM  : TCP 4104, AE title DICOMVIEWER (DICOM_PORT, and the
         listener can also be managed in Settings > PACS)

RECEIVE studies from any modality or PACS: enable the listener
in Settings > PACS, then point the sender's DICOM destination
at <this-pc-ip> : 4104, AE title DICOMVIEWER. Received studies
appear in the DICOM inbox.

PULL studies from a remote PACS: Settings > PACS connections ->
add AE title / IP / port, test with C-ECHO, then Query
(C-FIND) and Retrieve (C-GET / C-MOVE). Send (C-STORE) pushes
local studies out to any PACS.

STORAGE: SQLite database at app\db\custom.db; received DICOM
files under app\db\dicom-received\. Auto-delete rules (age in
days / study count / disk space) are in Settings > Storage.

----------------------------------------------------------------
5. ACCESS FROM OTHER DEVICES (LAN / TABLETS)
----------------------------------------------------------------
1) Double-click OPEN-FIREWALL-PORTS.bat as Administrator.
2) Find this PC's IP address: run "ipconfig" (e.g. 192.168.1.50)
3) On any device, browse to http://192.168.1.50:3000

Note: over plain HTTP, mobile browsers treat the app as a
normal page (most still offer "Add to Home Screen"). The full
PWA experience wants HTTPS, which the Docker deployment
(deploy/ folder in the repository, Caddy TLS) provides.

----------------------------------------------------------------
6. CHANGING PORTS
----------------------------------------------------------------
Edit START-VIEWER.bat with Notepad:

  set "PORT=3000"        web server port
  set "DICOM_PORT=4104"  DICOM listener port

Then restart the viewer. Note: once the listener has been enabled
in Settings > PACS, the port saved there takes priority - change
it in Settings (and update the firewall rule, section 5).

----------------------------------------------------------------
7. START AUTOMATICALLY AT LOGIN (OPTIONAL)
----------------------------------------------------------------
Press Win+R, type  shell:startup , press Enter, then copy a
SHORTCUT to START-VIEWER.bat into that folder. In the
shortcut's Properties, set "Run" to "Minimized" so it starts
out of the way.

----------------------------------------------------------------
8. UPDATING / BACKUP
----------------------------------------------------------------
All user data lives in ONE folder:  app\db\

- Backup : copy that folder somewhere safe. It contains the
  SQLite database and every received DICOM file.
- Update : extract the new package to a NEW folder, stop the
  old viewer, copy your old  app\db  over the new one, start
  the new one.

----------------------------------------------------------------
9. IMPORTANT: DO NOT MOVE THE FOLDER
----------------------------------------------------------------
Received studies are stored with ABSOLUTE file paths inside the
database. If you move the package folder to a different drive
or path, previously received files may no longer resolve. Pick
the final location before first use. (The SQLite database
itself is unaffected; only DICOM files received over the
network are path-bound.)

----------------------------------------------------------------
10. TROUBLESHOOTING
----------------------------------------------------------------
- "Windows protected your PC" (SmartScreen): right-click the
  .bat file -> Properties -> Unblock, or click More info ->
  Run anyway. The package only contains a standard Node.js
  runtime and the application.

- Slow first start: antivirus (Windows Defender) scans the
  node_modules folder once; adding the package folder to your
  antivirus exclusions speeds up every start.

- "Port already in use": another app owns 3000 or 4104 -
  change the ports (section 6) or stop the other app.

- Forgot your password: run RESET-ADMIN.bat, then log in with
  admin / admin and set a new password.

- DICOM send fails: check the listener is enabled (Settings >
  PACS), the AE title matches exactly, and the firewall rule
  exists (section 5). AE titles are max 16 characters from
  A-Z, 0-9, space, dash, underscore.

- See detailed errors: run START-VIEWER.bat from a cmd window
  and read the console output - each service logs what fails.

----------------------------------------------------------------
11. UNINSTALL
----------------------------------------------------------------
Delete the package folder. Nothing is written to the registry,
system folders, or anywhere else - all data stays inside the
folder.

================================================================
