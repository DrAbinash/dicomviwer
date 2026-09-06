# Worklog — DICOM Viewer (RadiAnt/Weasis-class, Cornerstone3D)

Shared multi-agent log. Append-only: add a `---` section per task.

---
Task ID: 0 (history, prior sessions)
Agent: main
Task: MVP + Phase 1 + Phase 2 core

Work Log:
- MVP viewer (Cornerstone3D): local files / drag&drop / sample study / PACS retrieve
- v0.2: Settings — user-managed PACS connections (AE title / IP / port), C-ECHO test, Orthanc gateway config
- v0.3 (commit 3b0d739): login auth (scrypt + HMAC cookie + middleware), cine (fps/direction, persisted),
  Horos-style grid layouts (1x1..4x4, per-tile series, active tile), auto-puller service (deploy/auto-puller)
  with heartbeat monitoring in Settings > Auto-Pull, CareDiagnostics orthanc config seeded

Stage Summary:
- Local commits only; NOT yet pushed to github.com/DrAbinash/dicomviwer (token push pending)

---
Task ID: 2.5 (current)
Agent: main
Task: "all of them and more you can think of" — full Horos-inspired feature pack, nothing hardcoded

Work Log (plan):
- Server-backed viewer preferences (window presets + defaults) via /api/viewer-preferences → AppSetting
  (window presets stop being hardcoded; sites edit them in Settings > Viewer)
- Persistent invert, interpolation toggle, overlay toggle, sync scroll/cine across tiles
- Slice scrubber on active tile, orientation markers (R/L/A/P from IOP metadata)
- Double-click tile to maximize, Fill-tiles-from-series button
- PNG snapshot export, fullscreen
- Data-driven keyboard shortcuts + help dialog
- Annotations panel (list measurements, values, clear all) via annotation.state
- Settings > Viewer tab: presets CRUD + viewer defaults
- Then: README, package, commit, push with token

Stage Summary:
- Implemented Phase 2.5 "all of them and more":
  - Server-backed viewer preferences: src/lib/server/viewer-preferences.ts +
    /api/viewer-preferences (GET/PUT, auth-guarded) storing presets + defaults
    in AppSetting["viewer.preferences"]; client bridge src/lib/viewer/preferences.ts
    with localStorage overrides; FALLBACK seeds keep offline dev working
  - Store: syncEnabled, persistent inverted, showOverlays, smoothInterpolation,
    maximizedCell, annotationsOpen, helpOpen, presets, initViewerPrefs()
  - Viewport: scrubber on active tile, R/L/A/P orientation markers
    (lib/viewer/orientation.ts from ImageOrientationPatient, rotation/flip-aware),
    sync cine across tiles, double-click maximize, overlay toggle
  - api.ts: syncPredicate fan-out for scroll/W-L/invert, interpolationType,
    scrollToIndex, snapshot() PNG export, clearCellInvert
  - Toolbar: server presets, Sync/Inv/Smooth/Info toggles, Fill tiles, PNG,
    fullscreen, help; vertical flip added
  - Shortcuts: lib/viewer/shortcuts.ts data-driven map + global handler in
    dicom-viewer.tsx + shortcuts-dialog.tsx (generated from the same map)
  - Annotations panel: annotation.state.getAllAnnotations, values (mm/deg/mean/sigma/area),
    clear-all
  - Settings > Viewer tab (viewer-tab.tsx): presets CRUD + defaults editor
- Fixed: interpolation property name (interpolationType), unknown-body cast
  in preferences route; lint clean; tsc clean
- README: Phase 2.5 section + Horos adoption table expanded + roadmap reorder
- package.json version 0.3.0 -> 0.4.0
- Phase 3 candidates answered: Synology dry-run -> DICOM send -> GSPS -> MPR/MIP

Stage Summary:
- E2E verified (production webpack build + standalone server + agent-browser):
  login flow, server presets in toolbar, sample study render, scroll + ArrowDown,
  persistent invert, cine via Space, 2x2 + Fill (4 canvases), double-click
  maximize / m-restore, measurements panel, shortcuts dialog (32 entries),
  Settings > Viewer CRUD, auth gates 307/401. Screenshot checked visually:
  orientation markers A/R correct radiological convention, scrubber visible.
- Build notes for small containers: turbopack OOMs at ~2.3GB rss on 4GB box ->
  use `next build --webpack` (config already handles canvas/fs stubs); set
  turbopack.memoryLimit 2048 + outputFileTracingRoot pinned in next.config.ts

---
Task ID: 4 (ship)
Agent: main
Task: commit v0.4.0 and push all work to GitHub

Work Log:
- Commit 18b6075 "Phase 2.5: full Horos-inspired feature pack - zero hardcoded
  viewer config" (18 files, +1749/-148)
- Pushed to github.com/DrAbinash/dicomviwer main (3b0d739..18b6075); remote
  HEAD verified = 18b6075
- Packaged /home/z/my-project/download/dicomviewer-v0.4.0.zip via git archive

Stage Summary:
- GitHub main = v0.4.0 with Phase 1 + 2 + 2.5 complete
- Phase 3 recommended order: Synology dry-run -> DICOM send -> GSPS -> MPR/MIP

---
Task ID: 3 (candidates, user asked)
Agent: main
Task: Phase 3 scoping

Stage Summary:
- Candidate order recommended: 1) Synology deployment dry-run (validates whole stack, original goal)
  2) DICOM send (C-STORE via Orthanc /modalities/{id}/store — quick win, UI "Send study to…")
  3) Measurement persistence (start internal JSON/DB persistence, then true GSPS export/import)
  4) MPR + thick-slab MIP (heaviest: volume loader, full series in memory, oblique tools)

---
Task ID: 5 (v0.6.0)
Agent: main
Task: Storage & automatic retention (Phase 3.6) — SQLite visibility + auto-delete
  received studies by disk space / study count / age

Work Log:
- src/lib/server/storage-retention.ts: stats (studies/series/instances, inbox bytes
  on disk via recursive scan, SQLite file size, disk free/total via fs.statfs with
  graceful fallback), planCleanup (age/count/disk rules, oldest-first, multi-reason
  victims), runCleanup (dryRun mode), AppSetting-persisted settings + lastRun record,
  lazy scheduler (10-min interval, globalThis-guarded, unref'd timers).
- API: GET/PUT /api/storage (stats+settings+scheduler), POST /api/storage/cleanup
  {dryRun} — both requireSession-protected; scheduler hooked into /api/storage,
  /api/dimse/received list.
- UI: Settings gained a 6th tab "Storage" — 6 stat cards, auto-delete switch,
  maxAgeDays/maxStudies/maxDiskMb inputs (0 = unlimited), preview cleanup list with
  per-study reasons, confirm-guarded "Clean up now", last-auto-run line.
- scripts/storage-smoke.ts: 26 assertions, ALL PASS (count/age/disk rules, dry-run
  purity, file+row deletion, settings round-trip, lastRun persistence).
- HTTP E2E on production standalone build: 401 unauth, login, GET stats, dry-run,
  PUT settings, browser-verified Storage tab (screenshot) incl. save + preview flows.
- Fixed env gotcha: bun auto-loads workspace .env (absolute DATABASE_URL); scripts
  must not override it with a relative file: URL (resolves to a different sqlite file).

Stage Summary:
- v0.6.0: viewer storage is fully visible and self-managing; retention default OFF,
  oldest-first deletion, dry-run preview. Roadmap updated (3/3.5/3.6 done, 4 next:
  Synology drill, key images, DICOMDIR, ROI histograms, hanging protocols).
