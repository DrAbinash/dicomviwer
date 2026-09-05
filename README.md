# DICOM Viewer

A self-hosted, web-based DICOM viewer in the spirit of **RadiAnt** and **Weasis**.
Built with **Next.js 16 + Cornerstone3D**, designed to run on a **Synology NAS**
(Docker/Container Manager) and to pull studies from your **PACS** through an
Orthanc gateway. The same codebase runs in any browser, installs as a PWA on
phones/tablets, and is the foundation for the later Windows (Tauri) and iOS
(Capacitor) applications.

> **Non-diagnostic notice:** this viewer is under active development and is not
> certified for diagnostic use. Always confirm findings on a certified
> workstation.

![Status](https://img.shields.io/badge/status-MVP-teal) ![Stack](https://img.shields.io/badge/stack-Next.js%2016%20%2B%20Cornerstone3D%205-black)

## Features (MVP)

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
- **PACS query/retrieve** via DICOMweb (QIDO-RS + WADO-URI) through Orthanc
- Responsive dark UI + installable **PWA** (iOS/Android home screen)
- HTTPS-ready docker-compose stack: **viewer + Orthanc + Caddy**

## Repository layout

```
src/app/                 Next.js app (single-page viewer + /api/pacs proxy)
src/components/viewer/   viewport, thumbnail rail, toolbar, PACS dialog
src/lib/viewer/          cornerstone init, DICOM ingestion, PACS client, store
deploy/                  Synology deployment (compose, Orthanc, Caddy, Dockerfile)
public/samples/          synthetic CT phantom study (30 slices)
```

## Run in development

```bash
bun install
bun run dev        # http://localhost:3000
```

Click **Sample study** to load the bundled phantom immediately. To try PACS
searching locally, run Orthanc in Docker:

```bash
docker run --rm -p 8042:8042 orthancteam/orthanc:24.10.2
# then: ORTHANC_URL=http://localhost:8042 bun run dev
```

## Deploy on a Synology NAS

1. Install **Container Manager** (DSM 7.2+) from Package Center.
2. Copy the repository to a share, e.g. `/docker/dicomviewer`.
3. `cd /docker/dicomviewer/deploy && cp .env.example .env` and fill in:
   - `ACME_HOSTNAME` - `localhost` for LAN-only HTTPS, or your Synology DDNS name
   - `ORTHANC_AE_TITLE`, `ORTHANC_USER`, `ORTHANC_PASSWORD`
4. Container Manager → **Project → Create** → point it at
   `/docker/dicomviewer/deploy/docker-compose.yml` → **Build**.
5. Open `https://<NAS-IP>` (accept the self-signed certificate once) or
   `https://yourname.synology.me` when DDNS is configured.
6. Edit `deploy/orthanc.json` → `DicomModalities` to register your PACS:
   `"MY_PACS": ["AE_TITLE", "pacs.host.ip", 4242]` and restart the project.

Only ports **80/443 (Caddy)** are exposed. The viewer talks to Orthanc through
its internal `/api/pacs` proxy (no CORS, credentials never reach the browser).

### Retrieving a study from PACS

In the viewer: **PACS → enter patient name/ID → Search → Open**. Orthanc
queries the remote PACS (C-FIND), pulls the study (C-MOVE/C-GET), caches it on
the NAS volume and serves it to the viewer over WADO-RS.

## Security notes

- HTTPS terminates at Caddy; HTTP redirects are enabled on public hostnames.
- Orthanc is never exposed; its credentials live in the server environment.
- Prefer VPN (Tailscale/WireGuard packages on DSM) over port-forwarding when
  possible; if using DDNS, forward only 443 and keep DSM interfaces closed.
- The Orthanc volume is a cache - schedule Hyper Backup for it and prune via
  `MaximumStorageSize` in `orthanc.json`.

## Roadmap

See `docs/plan` (development plan document) for the full phased roadmap:

| Phase | Scope |
|-------|-------|
| 1 | MVP viewer (this release) |
| 2 | PACS integration hardening (real PACS matrix testing) |
| 3 | Synology release + PWA polish + auth |
| 4 | Clinical tools: annotations persistence, cine, layouts, DICOMDIR, export |
| 5 | MPR (axial/coronal/sagittal) + thick-slab MIP |
| 6 | Windows desktop (Tauri wrapper) |
| 7 | iOS application (Capacitor, App Store) |

## License

TBD (project code) - runtime depends on open-source libraries:
Cornerstone3D, Orthanc (GPLv3 for some plugins - verify your deployment
scenario), Caddy (Apache-2.0).
