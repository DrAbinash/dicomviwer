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
- (this commit)

---
Task ID: 3 (candidates, user asked)
Agent: main
Task: Phase 3 scoping

Stage Summary:
- Candidate order recommended: 1) Synology deployment dry-run (validates whole stack, original goal)
  2) DICOM send (C-STORE via Orthanc /modalities/{id}/store — quick win, UI "Send study to…")
  3) Measurement persistence (start internal JSON/DB persistence, then true GSPS export/import)
  4) MPR + thick-slab MIP (heaviest: volume loader, full series in memory, oblique tools)
