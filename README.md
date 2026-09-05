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

![Status](https://img.shields.io/badge/status-Phase%202-teal) ![Stack](https://img.shields.io/badge/stack-Next.js%2016%20%2B%20Cornerstone3D%205-black)

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

### Ideas taken from Horos (analysis)

Horos (the open-source OsiriX fork) shaped several Phase 2 decisions:

| Horos concept | What we adopted |
|---|---|
| Tile-based 2D viewer with grid layouts (1×1 … 5×5) | Grid layouts with per-tile series assignment and an active-tile model |
| Cine/loop playback with fps + direction control | Cine engine with fps slider, forward/backward/oscillate, persisted prefs |
| Layouts are presets, not code paths | Layouts live in one data table; toolbar/viewport render from it |
| Series (smart) playlists → tiles | Thumbnails target the selected tile; tiles auto-fill from the series list |
| Viewer preferences persist between runs | Cine prefs persist (localStorage), PACS/gateway/login persist in the DB |
| Gap: Horos has no web/mobile UI, no PACS polling | We add login, PWA/mobile, and the auto-puller service |

Still on the roadmap from the Horos study: 3D MPR + thick-slab MIP, ROI
statistics histograms (mean/SD/min/max), key-image bookmarking, DICOMDIR
import/export, and DICOM send (SCU) to downstream stations.

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
| 3 | Synology release hardening + real PACS matrix testing |
| 4 | Clinical tools: annotation persistence (GSPS), key images, DICOMDIR, export, DICOM send |
| 5 | MPR (axial/coronal/sagittal) + thick-slab MIP |
| 6 | Windows desktop (Tauri wrapper) |
| 7 | iOS application (Capacitor, App Store) |

## License

TBD (project code) - runtime depends on open-source libraries:
Cornerstone3D, Orthanc (GPLv3 for some plugins - verify your deployment
scenario), Caddy (Apache-2.0).
