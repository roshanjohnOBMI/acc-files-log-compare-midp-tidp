# Changelog

All notable changes to this app are documented here, newest first. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/) (`MAJOR.MINOR.PATCH` — MINOR for new features, PATCH
for fixes, MAJOR reserved for breaking changes to saved setups or the QA/QC report format).

Every production update should add an entry here before/with the deploy that ships it.

## [1.5.0] - 2026-09-20

### Added
- **Streaming TIDP/MIDP parser** (`xlsxStream.service.ts`) — reads a workbook by streaming its XML
  through a SAX parser and keeping only cell values, instead of building exceljs's full workbook
  object model. A 50 MB multi-tab, formula-heavy MIDP now costs a few hundred MB and seconds rather
  than roughly 2 GB and minutes (the old loader was running past the request timeout on files that
  size). If a file can't be read this way, parsing falls back to the previous exceljs loader.
  Verified against the old loader on a generated multi-tab workbook: identical cell values,
  dates, formula results, header-row detection, and tab order.
- Clear "file too large" message: an upload over the size cap now returns HTTP 413 with "Pick it
  from ACC instead, or trim the workbook" instead of a generic error.

### Changed
- TIDP/MIDP upload cap raised from 50 MB to **200 MB** (Windows' "50 MB" is MiB, so a file shown
  as 50 MB could sit a few hundred KB over an exact cap). The Files Log upload cap is unchanged at
  50 MB.
- Parse timeout now scales with file size (60 s + 4 s per MB, capped at 300 s) instead of one flat
  60 s; the client-side request timeout was raised to 330 s to stay above it.
- JSON request body limit raised from 10 MB to 100 MB so the compare/export payload for a very
  large TIDP (one result row per deliverable format) isn't rejected with a 413.
- `saxes` is now declared as a direct server dependency (it was already installed at the same
  version through exceljs).
- Header UI: the OBMI wordmark is shown without a box/border around it, and the hub/project
  selector sizes to its longest project name (capped at 45% of the viewport width) instead of a
  fixed 280 px maximum.

## [1.4.0] - 2026-09-20

### Added
- **Extra Documents section on the QA/QC report's Summary sheet** — Files Log entries that matched
  no TIDP/MIDP deliverable are now itemized (discipline, file name, format, folder path) instead of
  appearing only as an "Extra" count in the progress tiles, so they can be reviewed and reconciled
  (or confirmed as legitimately extra) without switching to the Comparison sheet.

### Fixed
- **QA/QC report export could receive non-Buffer bytes.** Since the worker-thread pool arrived in
  1.1.0, the workbook was built on a worker and handed back via `postMessage()`, which delivers a
  `Buffer` as a plain `Uint8Array`. Express's `res.send()` only treats a true `Buffer` as file
  bytes, and the ACC upload path expects one too, so the export route now re-wraps the result with
  `Buffer.from(...)` before using it. Verified against the built server: the worker returns a
  `Uint8Array`, the re-wrapped value is a `Buffer`, and the resulting workbook opens with the new
  section present.

## [1.3.0] - 2026-09-04

### Added
- The help panel's auto-opened first view (a brand-new browser's very first visit only) now
  includes an extra tip: open "Setup & mapping" first and confirm tabs/header row/column mapping
  match your workbook before comparing. Later manual opens (via the "?" trigger) don't repeat it.

### Changed
- The help panel no longer closes when clicking its backdrop - only the explicit "Close" button
  does now, so the first-visit tip above can't be dismissed by an accidental outside click.

## [1.2.1] - 2026-09-03

### Fixed
- **Saved setups could fail to write on a fresh deploy.** `server/data/` is gitignored (it holds
  only runtime state), so a clean checkout - which is what every deploy actually is - doesn't
  contain it; lowdb's writer creates `setups.json` on first use but never its parent directory, so
  every `POST`/`PUT /api/setups` call failed with `ENOENT` until something else happened to create
  the folder first. The server now creates `server/data/` itself at startup if it's missing.
- Browser tab favicon pointed at `/obmi-mark.png`, removed in 1.1.0's branding update — was a
  broken image request on every page load. Points at the wordmark image instead.

## [1.2.0] - 2026-09-03

### Added
- **Help panel** — a "?" trigger in the top bar opens a short reference (the 3-step workflow plus
  a few things that aren't obvious from the UI alone); opens itself once automatically on a
  browser's first visit, click-only after that.
- **Step guide** — a small progress tracker (TIDP/MIDP file → ACC Files Log → Results) showing
  where you are in a comparison at a glance.
- **First-visit onboarding callout** — a one-time "start here" nudge pointing at the first thing
  to click in a brand-new session, dismissed for good (this browser) once acted on or closed.
- **Inline setup rename** — the "Update" action in Setup Save/Update now includes an editable name
  field, so renaming a saved setup no longer requires a separate step.
- **Theme-aware branding** — the top bar and login page now swap between navy and off-white OBMI
  wordmark images to match the active light/dark theme, instead of one fixed logo.
- Staleness warnings on both upload paths (TIDP/MIDP and Files Log): uploaded files aren't linked
  to ACC's version history, so there's no way to confirm they're current — the UI now says so.

### Changed
- The TIDP/MIDP file and ACC Files Log pickers now collapse to a compact summary chip once a
  source is loaded ("Change source" re-expands it), instead of always showing the full picker.
- The Compare button pulses when a comparison is ready to run but hasn't been run yet.
- Results table no longer repeats the source filename as a subtitle (redundant with the summary
  chip above it).

### Fixed
- `PUT /api/setups/:id` now validates `name`/`hubId`/`projectId` are present, matching the create
  endpoint's validation — a malformed update request could previously blank out a setup's name
  instead of failing loudly.

## [1.1.0] - 2026-09-03

### Added
- **Setup & mapping page** — tabs/header rows, column mapping, row filters, the Files Log
  folder-path filter, and a comparison preview, consolidated off the Workspace page into one
  dedicated page (`/setup`), reached via "Edit / Setup" links.
- **Persistent top bar** — hub/project pickers and a pinned "Compare N row(s)" button now sit
  above every page, backed by one shared `WorkspaceContext` instead of page-local state.
- **Light/dark/system theme** — toggle in the top bar, persisted per browser, applied before first
  paint (no flash of the wrong theme).
- Checking a folder in the Files Log's multi-folder scan picker now also checks its immediate
  subfolders (expanding it first if needed), instead of requiring each subfolder to be checked by
  hand.
- **Saved setups** redesigned as a card list (Load/Rename/Delete), with the previous full-table
  view kept as a collapsible "Full configuration table".
- Full visual redesign (new type/color system, IBM Plex-adjacent hierarchy throughout).

### Performance
- Workbook parsing, row matching, and QA/QC export generation now run on a `worker_threads` pool
  (`server/src/workers/`) instead of the main request thread — a large MIDP or Files Log no longer
  stalls other requests, including the Activity Log panel's own polling. Pool size follows the
  host's CPU count (`min(4, cpuCount - 1)`, at least 1).

## [1.0.0] - 2026-08-27

Initial production release — ACC Files Log vs TIDP/MIDP comparison tool, deployed to Azure App
Service (`apsFilesComparison`).

### Added
- APS 3-legged OAuth (PKCE) sign-in, scoped to hub/project access the signed-in Autodesk account
  already has.
- TIDP/MIDP source: pick a live workbook from ACC, or upload one, with auto-detected header row
  and per-column filtering.
- ACC Files Log assembly three ways: live recursive multi-folder scan, an already-exported log
  workbook picked from ACC, or one uploaded from disk.
- Matching engine with four match modes (`exact`, `startsWith`, `contains`, `deep`), duplicate
  detection on both sides, and best-effort ACC revision lookup.
- Branded QA/QC report export (`.xlsx`) — download or save straight back into an ACC folder.
- Saved setups (reusable comparison configurations) and an in-app activity/error log.
