# DICOM Viewer

A self-hosted, web-based DICOM viewer in the spirit of **RadiAnt**, **Weasis**
and **Horos**. Built with **Next.js 16 + Cornerstone3D**, designed to run on a
**Synology NAS** (Docker/Container Manager) and to pull studies from your
**PACS** through an Orthanc gateway. The same codebase runs in any browser,
installs as a PWA on phones/tablets, and is the foundation for the later
Windows (Tauri) and iOS (Capacitor) applications.

> **Non-diagnostic notice:** this viewer is under active development and is not
> certified for diagnostic use. Always confirm findings on a certified
> workstation.

![Status](https://img.shields.io/badge/status-v0.6.0-teal) ![Stack](https://img.shields.io/badge/stack-Next.js%2016%20%2B%20Cornerstone3D%205-black)

## Features

### Core viewer (Phase 1)

- GPU-accelerated 2D stack viewing (CT/MR/CR/…) via Cornerstone3D
- RadiAnt-style interaction:
  - **left drag / one finger**: window/level (or selected tool)
  - **right drag / pinch**: zoom
  - **middle drag**: pan
  - **wheel / swipe**: stack scroll
- Window presets: Lung, Bone, Brain, Abdomen, Mediastinum, Angio
- Measurements: length, angle, ellipse ROI, rectangle ROI, arrow, pixel probe
- Series thumbnail rail with real windowed previews
- Live overlays: patient/study, WW/WC, zoom, slice position
- Local ingestion: drag & drop `.dcm` files or use **Open files**
- Bundled **sample CT study** (synthetic phantom, works offline)
- Responsive dark UI + installable **PWA** (iOS/Android home screen)

### Phase 2 — login, cine, layouts, auto-pull

- **Login** — session auth for everything (pages, APIs, proxy):
  - First credentials are seeded from `AUTH_USERNAME` / `AUTH_PASSWORD`
    (documented defaults `admin`/`admin` — change them!) and stored scrypt-hashed
    in the viewer database
  - Change username/password any time in **Settings → Security** (requires the
    current password)
  - Sessions are HMAC-signed cookies; the signing secret comes from
    `AUTH_SECRET` or is auto-generated and persisted (no secrets in code);
    TTL via `AUTH_TTL_HOURS` (default 7 days)
- **Cine loop playback** (Horos-inspired): play/pause the active tile,
  user-adjustable **fps (1–60)** and **direction (forward / backward /
  oscillate)**; preferences persist in the browser
- **Grid layouts** (RadiAnt/Horos-style): 1×1, 1×2, 2×1, 2×2, 3×3, 4×4 —
  data-driven, add more in `src/lib/viewer/layouts.ts`
  - thumbnails load into the **selected tile** (teal outline)
  - per-tile stack scroll, W/L, zoom, measurements; **Fit all** tiles
- **PACS settings UI** — add/edit/delete any number of remote PACS nodes
  (**display name / AE Title / IP / port**), C-ECHO "Test" button, gateway
  (Orthanc) URL + credentials editable in **Settings → Gateway**
- **Auto-Puller** (Phase 2 of the Care Diagnostics deployment):
  a sidecar service that C-FINDs your modalities every cycle and automatically
  retrieves missing studies (C-MOVE) into the gateway — no dependence on
  technician auto-send
  - fully environment-configured (`MODALITIES`, `POLL_INTERVAL_SECONDS`,
    `LOOKBACK_DAYS`, `MAX_RETRIEVES_PER_CYCLE`, `FAIL_COOLDOWN_MINUTES`,
    `RUN_ONCE` for cron users)
  - writes a heartbeat to the viewer: monitor the last cycle and the recent
    per-study activity (pulled / skipped / failed) in **Settings → Auto-Pull**
- **PACS query/retrieve** via DICOMweb (QIDO-RS + WADO-URI) through Orthanc
- HTTPS-ready docker-compose stack: **viewer + Orthanc + auto-puller + Caddy**

### Phase 2.5 — the full Horos-inspired feature pack

Everything below is data-driven: **window presets, viewer defaults and all
toggles live in server preferences or localStorage — no site values are
hardcoded anywhere in the code.**

- **Server-backed viewer preferences** (Settings → Viewer):
  - window/level **presets are editable** (add/rename/reorder/delete, set
    WW/WC) — seeds are generic defaults, every site keeps its own protocols
  - defaults for layout, cine fps/direction, overlay visibility and
    interpolation — new sessions and new devices start configured
  - stored in the viewer DB, served by `/api/viewer-preferences`
- **Sync mode** (RadiAnt "link"): stack scroll, cine playback and W/L presets
  fan out to **every loaded tile** — scroll two series together, play all
  cines in lockstep
- **Persistent invert toggle** (Horos-style, per tile, stays until reset)
- **Interpolation toggle** — smooth (linear) vs pixelated (nearest-neighbour)
- **Slice scrubber** on the active tile + jump-to-slice (drag the slider)
- **Orientation markers** — R/L/A/P (S/I where applicable) derived from each
  image's `ImageOrientationPatient`, honouring rotation and flips, Horos-style
- **Double-click a tile to maximize it** (RadiAnt behaviour), click again to
  restore the grid
- **Fill tiles** — one button distributes the active study's series across
  all tiles
- **PNG export** of the active tile (Horos "Export image")
- **Fullscreen** mode
- **Annotations panel** — lists every measurement (length, angle, ROI
  mean/σ/area) and clears them all
- **Keyboard shortcuts** (Horos/RadiAnt-style, data-driven, `?` shows help):
  `1–0` tools, `Alt+1…6` layouts, `↑/↓/PgUp/PgDn` scroll, `Space` cine,
  `+/−` zoom, `i` invert, `h/v` flip, `r/Shift+R` rotate, `f/Shift+F` fit,
  `m` maximize, `y` sync, `o` overlays, `p` PNG, `a` measurements
- **Text overlay toggle** (hide patient info for demos/screenshots)

### Phase 3 — MPR, DICOM Send, measurement persistence

- **Tri-planar MPR** (`Alt+M` or the layout grid): orthogonal Axial/Sagittal/
  Coronal viewports driven by a Cornerstone3D volume, with a **thick-slab
  slider** (0.1–50 mm) that doubles as **slab MIP** for angiographic reading
- **DICOM Send**: push the current series or whole study to any configured
  DICOM node — **direct C-STORE from the viewer process** (no gateway needed)
  or the classic Orthanc-gateway route, with live progress
- **Measurement persistence**: measurements are saved per series
  (GSPS-style JSON of the full Cornerstone annotation state) and restored
  automatically when the series is reopened; API at `/api/annotations`

### Phase 3.5 — built-in PACS node (the viewer becomes a DICOM node)

The server process speaks native DIMSE (via `dcmjs-dimse`) — most features
below work with **zero external components**; when an Orthanc gateway is
configured the same flows additionally mirror into its cache.

- **DICOM listener (C-STORE SCP)** — enable it in **Settings → PACS → DICOM
  listener** (AE Title + port, default `DICOMVIEWER:4104`, persisted in the
  DB). Modalities and other PACS can then push studies straight into the
  viewer: every received instance is stored under `db/dicom-received/`
  (override with `DVV_RECEIVED_DIR`), indexed in SQLite, and optionally
  forwarded into the Orthanc gateway. The listener auto-starts with the
  server when enabled, answers **C-ECHO / C-FIND** (study-level query of the
  inbox) and accepts every storage SOP class / transfer syntax.
- **Inbox in the Query dialog** — studies received by the listener appear
  under "Inbox — received by this viewer" and open with one click.
- **Direct query/retrieve** — C-FIND + C-GET (or C-MOVE) pull from any
  configured PACS straight into the inbox, with live progress and job
  polling; C-GET needs no registration on the remote side.
- **Direct C-ECHO test** — Settings → PACS “Test” now echoes straight from
  the viewer (round-trip ms shown), no gateway required.
- **Direct send** — the Send dialog offers every configured PACS as a
  "Direct" destination (payload from the inbox or the gateway cache).

### Phase 3.6 — storage & automatic retention (housekeeping)

Everything the viewer keeps (received studies, settings, measurements) lives
in **one SQLite database** plus the inbox folder — and now manages itself:

- **Storage dashboard** — **Settings → Storage** shows live numbers: studies,
  series, instances, bytes on disk, SQLite database size, and free/total
  space of the volume that holds the inbox.
- **Auto-delete rules** — three independent limits, oldest studies removed
  first: *older than N days*, *keep max N studies*, *keep inbox under N MB*.
  Enforced by a background scheduler (checked every 10 minutes, lazily
  started with the server; no cron needed) and persisted in the DB.
- **Safe by default** — *Preview cleanup* runs a dry-run and lists exactly
  which studies would be deleted and why (age / count / disk rule) before
  anything is removed; *Clean up now* asks for confirmation. Disabling the
  switch stops all automatic deletion.
- **Auditability** — the result of the last automatic run (when, how many
  studies, how much freed) is stored and shown in the dialog.
- API: `GET/PUT /api/storage`, `POST /api/storage/cleanup` (`{"dryRun":true}`
  for previews). Smoke test: `bun scripts/storage-smoke.ts` (26 assertions).

### Ideas taken from Horos (analysis)

Horos (the open-source OsiriX fork) shaped several Phase 2 decisions:

| Horos concept | What we adopted |
|---|---|
| Tile-based 2D viewer with grid layouts (1×1 … 5×5) | Grid layouts with per-tile series assignment and an active-tile model |
| Cine/loop playback with fps + direction control | Cine engine with fps slider, forward/backward/oscillate, persisted prefs |
| Layouts are presets, not code paths | Layouts live in one data table; toolbar/viewport render from it |
| Series (smart) playlists → tiles | Thumbnails target the selected tile; tiles auto-fill from the series list |
| Viewer preferences persist between runs | Server preferences (presets, defaults) + localStorage user tweaks |
| Keyboard shortcuts for tools/actions | Full shortcut map, generated help dialog (`?`) |
| Invert, flip, rotate, interpolation controls | Persistent invert, H/V flip, rotate, smooth/pixelated toggle |
| ROI statistics (mean/σ/area) panel | Annotations panel with live values and clear-all |
| Orientation markers on every tile | R/L/A/P(S/I) from ImageOrientationPatient, rotation/flip-aware |
| Export image | One-click PNG of the active tile |
| Gap: Horos has no web/mobile UI, no PACS polling | We add login, PWA/mobile, and the auto-puller service |

Still on the roadmap from the Horos study: ROI statistics histograms
(mean/SD/min/max), key-image bookmarking, DICOMDIR import/export, hanging
protocols and print/Presentation-State (GSPS SOP class) export.

## Repository layout

```
src/app/                 Next.js app (login, viewer page, /api/* routes)
src/components/viewer/   multi-tile viewport, thumbnails, toolbar, dialogs
src/lib/viewer/          cornerstone init, ingestion, PACS client, store, layouts
src/lib/server/          auth (scrypt+HMAC), Orthanc client, PACS validation
deploy/                  Synology deployment (compose, Orthanc, auto-puller, Caddy)
deploy/auto-puller/      Phase 2 auto-pull service (Python + Docker)
public/samples/          synthetic CT phantom study (30 slices)
scripts/mock-orthanc.ts  mock gateway + PACS for local end-to-end testing
```

## Run in development

```bash
bun install
bun run db:push      # create/update the SQLite schema
bun run dev          # http://localhost:3000  (login: admin/admin by default)
```

Click **Sample study** to load the bundled phantom immediately. To try PACS
searching locally, run the mock gateway + a real Orthanc:

```bash
bun scripts/mock-orthanc.ts          # mock Orthanc+PACS on :3030 (sandbox)
# or the real thing:
docker run --rm -p 8042:8042 orthancteam/orthanc:24.10.2
# then: ORTHANC_URL=http://localhost:8042 bun run dev
```

## Deploy on a Synology NAS

1. Install **Container Manager** (DSM 7.2+) from Package Center.
2. Copy the repository to a share, e.g. `/docker/dicomviewer`.
3. `cd /docker/dicomviewer/deploy && cp .env.example .env` and fill in:
   - `AUTH_USERNAME` / `AUTH_PASSWORD` — **change the defaults!**
   - `AUTH_SECRET` — `openssl rand -hex 32`
   - `ORTHANC_AE_TITLE`, `ORTHANC_NAME`, `ORTHANC_USER`, `ORTHANC_PASSWORD`
   - `AUTO_PULL_*` — modalities to poll (`UIH_MRI:on,CT_MACHINE:on,XRAY_1:off`),
     interval, lookback, and `AUTO_PULL_TOKEN` (shared heartbeat secret)
   - `ACME_HOSTNAME` — `localhost` for LAN-only HTTPS, or your DDNS name
4. Container Manager → **Project → Create** → point it at
   `/docker/dicomviewer/deploy/docker-compose.yml` → **Build**.
5. Open `https://<NAS-IP>` (accept the self-signed certificate once), sign in,
   and manage PACS nodes in **Settings → PACS** (or edit the seeded
   `DicomModalities` in `deploy/orthanc.json` before first start).

Only ports **80/443 (Caddy)** are exposed. The viewer talks to Orthanc through
its internal `/api/pacs` proxy (no CORS, credentials never reach the browser);
the auto-puller talks to Orthanc and the viewer heartbeat inside the compose
network only.

### How studies arrive

- **On demand** — viewer: **PACS → enter patient name/ID → Search → Open**.
  Orthanc C-FINDs the remote PACS, pulls the study (C-GET/C-MOVE), caches it
  on the NAS volume and serves it to the browser over WADO.
- **Automatically** — the auto-puller polls every modality each cycle
  (default 5 min, lookback 1 day) and retrieves any study the gateway is
  missing. Watch it happen in **Settings → Auto-Pull**.

## Run on Windows (offline package)

A **self-contained Windows deployment zip** is available as a release asset
(`dicomviewer-v0.6.0-windows.zip` on the v0.6.0 release) — no installer, no
Node.js preinstalled, no internet needed at runtime.

1. Extract the zip to a simple path such as `C:\DICOMViewer`.
2. Double-click **START-VIEWER.bat** (allow SmartScreen once: *More info →
   Run anyway*). The browser opens `http://localhost:3000`.
3. Sign in with `admin` / `admin` and change the password in
   **Settings → Security**.

Inside the package:

| Path | Purpose |
|------|---------|
| `app\` | Next.js standalone build + full `node_modules` (Windows Prisma engine, sharp win32 prebuilds, `dcmjs-dimse` closure) + pre-seeded SQLite DB |
| `runtime\node.exe` | portable Node 22 LTS (win-x64) |
| `START-VIEWER.bat` | start server (web :3000, DICOM :4104) + open browser |
| `STOP-VIEWER.bat` | stop the server |
| `OPEN-FIREWALL-PORTS.bat` | one-click LAN firewall rules (run as admin) |
| `RESET-ADMIN.bat` | reset the login back to `admin` / `admin` |
| `README-WINDOWS.txt` | full Windows handbook (ports, LAN access, auto-start, backup, troubleshooting) |

Build the package yourself with:

```bash
bun install && bunx prisma generate && bun run build
bash scripts/make-windows-package.sh     # -> download/dicomviewer-v0.7.0-windows.zip
bash scripts/make-windows-installer.sh   # -> download/DicomViewer-Setup-v0.7.0-signed.exe
```

The packaging script embeds the Windows query engine
(`binaryTargets = ["native", "windows"]` in `prisma/schema.prisma`), the
sharp win32-x64 prebuilds, a portable `node.exe`, and a freshly pushed
SQLite database, then verifies every critical file before zipping.

## Windows Setup installer (signed) + trial licensing

`scripts/make-windows-installer.sh` builds `DicomViewer-Setup-v0.7.0-signed.exe`
(portable NSIS, code-signed with a timestamp): double-click, pick the folder,
done - it installs to `C:\Program Files\DicomViewer`, keeps patient data in
`C:\ProgramData\DicomViewer` (writable, survives upgrades), creates Start
Menu/Desktop shortcuts, opens firewall ports 4310 (web) + 4104 (DICOM) and
registers a proper uninstaller.

Trials are enforced by the app itself (Ed25519-signed license keys):

- No/expired key -> the whole application (UI, every API, the DICOM
  receiver) is replaced by an **activation screen**; patient data is kept.
- The vendor issues keys offline with the **license admin kit**
  (`license-keygen.mjs --name "Clinic" --days 30` or `--until 2026-12-31`);
  the customer pastes the key or drops `license.key` into
  `C:\ProgramData\DicomViewer\`.
- Fresh key == new trial period, and it also unlocks a box whose clock was
  rolled back (anti-tamper sidecar `.licstate.json`).
- `--perpetual` keys never expire (your own deployments).
- The signing/signing key material never leaves the kit folder; it is
  gitignored and must not be distributed.

## Security notes

- **Change the default `admin`/`admin` login** (Settings → Security) after
  the first deployment; credentials are stored scrypt-hashed.
- Sessions are signed cookies (`HttpOnly`, `SameSite=Lax`, `Secure` when
  served over HTTPS); auto-pull heartbeats accept an optional shared token.
- HTTPS terminates at Caddy; Orthanc is never exposed; its credentials live in
  the server environment.
- Prefer VPN (Tailscale/WireGuard on DSM) over port-forwarding; if using DDNS,
  forward only 443 and keep DSM interfaces closed.
- The Orthanc volume is a cache — schedule Hyper Backup for it and prune via
  `MaximumStorageSize` in `orthanc.json`.

## Roadmap

| Phase | Scope |
|-------|-------|
| 1 | MVP viewer ✅ |
| 2 | Login, cine, layouts, PACS settings, auto-puller ✅ |
| 2.5 | Horos feature pack: sync, presets editor, orientation markers, scrubber, shortcuts, measurements panel, PNG export ✅ |
| 3 | MPR + thick-slab MIP, DICOM Send, measurement persistence (AnnotationSet/GSPS JSON) ✅ |
| 3.5 | Built-in PACS node: DIMSE listener (C-STORE/C-ECHO/C-FIND SCP), direct C-FIND/C-GET/C-MOVE/C-STORE SCU, inbox ✅ |
| 3.6 | Storage dashboard + automatic retention (delete by age / study count / disk space) ✅ |
| 3.7 | Trial licensing (Ed25519 keys, activation gate, anti-tamper) + signed NSIS Windows installer ✅ |
| 4 | Synology deployment drill, key images, DICOMDIR import/export, ROI histograms, hanging protocols |
| 5 | Windows desktop (Tauri wrapper) |
| 6 | iOS application (Capacitor, App Store) |

**Phase 3 order rationale:** the dry-run validates the whole stack on real
hardware first (it is the project's stated primary target); **DICOM send** is
a quick win on top of the existing Orthanc gateway (`/modalities/{id}/store`);
**measurement persistence** starts with viewer-owned JSON persistence and
graduates to true DICOM GSPS objects; **MPR/MIP** is the heaviest item (volume
loader, full series in memory) and benefits from everything before it being
stable.

## License

TBD (project code) - runtime depends on open-source libraries:
Cornerstone3D, Orthanc (GPLv3 for some plugins - verify your deployment
scenario), Caddy (Apache-2.0).
