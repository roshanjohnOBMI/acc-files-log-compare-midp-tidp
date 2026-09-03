# Changelog

All notable changes to this app are documented here, newest first. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/) (`MAJOR.MINOR.PATCH` — MINOR for new features, PATCH
for fixes, MAJOR reserved for breaking changes to saved setups or the QA/QC report format).

Every production update should add an entry here before/with the deploy that ships it.

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
