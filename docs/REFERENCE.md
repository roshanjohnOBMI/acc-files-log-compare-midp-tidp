# ACC Files Log vs TIDP/MIDP Checker — Technical Reference

Architecture, workflow, API surface, and deployment record for the OBMI submittal-QA tool built on
Autodesk Construction Cloud (ACC). Current version **1.2.1** - see
[`../CHANGELOG.md`](../CHANGELOG.md) for full version history.

## Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Core workflow](#core-workflow)
4. [Data sources](#data-sources)
5. [Matching engine](#matching-engine)
6. [API reference](#api-reference)
7. [Data model](#data-model)
8. [QA/QC report](#qaqc-report)
9. [Deployment](#deployment)
10. [Configuration](#configuration)
11. [Operational notes](#operational-notes)
12. [Troubleshooting](#troubleshooting)

## Overview

A QA tool that checks a project's TIDP/MIDP delivery schedule against what has actually landed in
Autodesk Construction Cloud, without relying on a live per-folder search every time.

Under ISO 19650, a Task/Master Information Delivery Plan (TIDP/MIDP) lists every document a
project owes, in which formats, by when. Confirming that each listed deliverable actually exists
in ACC - in the right format, in the right place - is normally a manual, row-by-row exercise
against the Docs folder tree. This tool automates that comparison: it reads the TIDP/MIDP
workbook, reads an ACC **Files Log** (either scanned live or an already-exported log workbook),
matches the two by filename, and produces a branded QA/QC report showing exactly what's complete,
missing, or duplicated.

Both sides of the comparison are flexible about where they come from - live from ACC, or a file
already sitting on the reviewer's computer - so the same tool covers a submittal review whether or
not the reviewer has ACC open.

Not a CDE state tracker: ACC has no built-in ISO 19650 Shared/Published field, so "Shared" is
inferred from folder naming. Reads Files Logs produced by the separate **ACC File Log Extractor**
tool, or ACC's own log exports.

## Architecture

```
 Browser              Express API                Autodesk APS
 (React 19 SPA)  ───►  server/dist/index.js  ───►  Data Management API
                       HTTPS + session cookie      3-legged OAuth + REST
                            │
                            ├─ worker_threads pool (server/src/workers/)
                            │    parseTidpWorkbook · parseFilesLogWorkbook
                            │    matchRows · buildQaQcWorkbook
                            ├─ exceljs         (workbook parsing, inside workers)
                            ├─ lowdb           (server/data/setups.json)
                            ├─ express-session (in-memory store)
                            └─ multer          (in-memory uploads, 50MB cap)
```

A single Node.js process serves both the API and the built React SPA from one Azure Web App
origin - there's no separate frontend host, so the session cookie never has to cross origins.

**Server — `server/`.** Express + TypeScript. Owns APS 3-legged OAuth (PKCE), all Data Management
API calls, TIDP/MIDP and Files Log workbook parsing, the matching engine, QA/QC report generation,
saved setups, and the in-memory activity/error log. The four CPU-heavy jobs - parsing a TIDP/MIDP
or Files Log workbook, matching rows, and building the QA/QC export - run on a small pool of
`worker_threads` (`server/src/workers/workerPool.ts`, sized to `min(4, cpuCount - 1)`, at least 1)
instead of the main thread, so processing a large workbook doesn't stall other requests or the
Activity Log panel's own polling. `logEntry()` calls made inside a worker are forwarded to the main
thread over the worker's message port and re-run there, since each thread would otherwise have its
own private, never-read copy of the in-memory log.

**Client — `client/`.** React 19 + TypeScript + Vite. Has no Excel-parsing dependency of its own -
the server hands back ready-to-render JSON. All workspace state (hub/project, the loaded workbook,
column mapping, Files Log, results) lives in one React Context (`client/src/context/WorkspaceContext.tsx`),
shared by three pages under a persistent top bar: **Workspace** (pick source files, run the
comparison, see results), **Setup & mapping** (tabs/header rows, column mapping, row filters, Files
Log folder-path filter, and a preview - everything that configures a comparison, in one place), and
**Saved setups**. Supports light/dark/system theme (`client/src/hooks/useTheme.ts`, persisted to
`localStorage`, applied before first paint via an inline script in `index.html` so there's no
flash of the wrong theme).

| Layer  | Package                | Version              | Role                              |
| ------ | ----------------------- | --------------------- | ---------------------------------- |
| server | express                | ^4.21                 | HTTP + routing                     |
| server | @aps_sdk/*             | auth, data-management, oss | Autodesk Platform Services SDKs |
| server | exceljs                | ^4.4                  | Workbook read/write                |
| server | express-session        | ^1.18                 | Server-side session, cookie-keyed  |
| server | lowdb                  | ^7.0                  | JSON-file setup store              |
| server | multer                 | ^2.2                  | Multipart upload handling          |
| client | react / react-dom      | ^19.2                 | UI runtime                         |
| client | react-router-dom       | ^7.18                 | Client-side routing                |
| client | vite                   | ^6.0                  | Build / dev server                 |

## Core workflow

A persistent top bar (hub/project pickers, theme toggle, a "?" help trigger, sign-out, and a
pinned **Compare** button) sits above three pages, all reading and acting on the same
`WorkspaceContext` state. A step tracker (`StepGuide`) at the top of Workspace shows progress
through file → Files Log → results at a glance, and a one-time "start here" callout
(`useOnceFlag`, persisted per browser) points at the first thing to click on a brand-new session.

**Workspace** - the day-to-day page:

1. **TIDP/MIDP file** - `acc` (browse and pick the live workbook) or `upload`. Header row
   auto-detected from the sheet's frozen pane, or the row with the most filled cells as a
   fallback. Collapses to a compact summary chip once loaded ("Change source" re-expands it), with
   a pill linking out to Setup & mapping to change tab/column/match-mode choices. Uploaded files
   carry a staleness warning - they aren't linked to ACC's version history.
2. **ACC Files Log** - `scan` (walk folder(s) live - checking a folder also checks its immediate
   subfolders), `file` (pick an exported log workbook from ACC), or `upload` (same staleness
   warning). Also collapses to a summary chip once loaded; a pill shows the current folder-path
   filter and how many files it leaves in, linking to Setup & mapping.
3. **Results** - run the comparison, export the QA/QC report (download or save to an ACC folder),
   and switch between the results table and the activity/error log.

**Setup & mapping** - everything that configures a comparison, in one tabbed page reached from
either "Edit / Setup" pill above:

- **Tabs & header row** - which tabs are included and each one's header row (apply one row to
  every tab at once, or set them individually).
- **Column mapping** - identifier, formats, planned-date, and revision columns (pre-selected by
  header-name heuristics) and match mode, including **Deep search**.
- **Filter rows** - Excel-AutoFilter-style per-column filters, plus the planned-date filter.
- **ACC Files Log filter** - the "only count files whose folder path contains…" keyword filter
  (default `Shared`), with a live count of how many files it leaves in.
- **Preview** - row-by-row preview of identifier, discipline, and format list before running
  anything against ACC.

**Saved setups** - reusable configurations, listed as cards with Load/Rename/Delete (plus a
collapsible full table). Loading one restores the hub/project, Files Log source settings, column
mapping, and match mode into Workspace; the source file and Files Log itself still need to be
reselected/rerun, since both are either live ACC data or a local file not persisted between
sessions. The "Update with current settings" action on Workspace/Setup & mapping also carries an
editable name field, so renaming a loaded setup happens in the same step as saving its other
changes back.

## Data sources

### TIDP/MIDP source

| Mode     | Endpoint                    | Behavior                                                                 |
| -------- | ---------------------------- | -------------------------------------------------------------------------- |
| `acc`    | `GET /api/excel/parse`      | Downloads the tip version's bytes from the signed S3 URL, parses server-side. |
| `upload` | `POST /api/excel/upload`    | Multipart upload, parsed with the identical routine - same response shape. |

### Files Log

| Mode     | Endpoint                       | Behavior                                                                 |
| -------- | -------------------------------- | -------------------------------------------------------------------------- |
| `scan`   | `POST /api/files-log/scan`      | BFS walk of the selected folder(s) (+ subfolders if enabled), 2 folders in flight at a time. Carries a real item id per file - deep links and revision lookup both work. |
| `file`   | `GET /api/files-log/parse`      | Parses an already-exported log workbook from ACC (e.g. ACC File Log Extractor output, or ACC's own "SHARED/WIP FILES LOG" export). |
| `upload` | `POST /api/files-log/upload`    | Same parser, applied to a workbook uploaded from disk.                    |

> A file from an exported/uploaded log workbook has no live item id unless its "ACC Link" column
> encodes one - it's still matchable by name, just without revision lookup.

**Parser heuristics.** Column detection is header-text first (`File Name`, `Folder Path`,
`Version`, `Last Modified`, `Modified By`, `ACC Link` - matched case-insensitively as substrings),
then content-based fallback: whichever column's sampled values mostly end in a recognized
CAD/document extension is assumed to be the File Name column. The header row and worksheet are
both auto-selected by scoring every candidate against how many of those six columns it appears to
have.

## Matching engine

`matchService.ts` compares every filtered TIDP/MIDP row against a Files Log index built once per
search (grouped by extension, then by base filename, for O(1) exact lookups).

**Match modes**

| Mode         | Strategy                                                                                   |
| ------------ | ---------------------------------------------------------------------------------------------- |
| `exact`      | Base filename must match the identifier exactly.                                              |
| `startsWith` | Files Log entry's base filename starts with the identifier.                                   |
| `contains`   | Files Log entry's base filename contains the identifier.                                      |
| `deep`       | Tries exact, then startsWith, then contains, stopping at the first strategy that finds anything - never blends candidates across strategies. Winning strategy recorded per match. |

**Per-row status:** `complete` (every expected format matched), `partial` (some matched),
`missing` (none matched), `skipped` (blank identifier or no formats listed - excluded from
comparison and the report's row list, still counted in the summary).

**Per-format status:** `match`, `not_found_in_log`, `duplicate_in_log` (more than one Files Log
entry matched - ambiguous, not auto-resolved), `duplicate_in_source` (the identifier itself
appears more than once in the TIDP/MIDP register), and `extra` (report-only: a Files Log file that
matched no TIDP/MIDP row).

**Discipline** for a matched row is read from the last dash-separated suffix of its source tab
name (e.g. `MIDP - AR` → `AR`). For an *extra* file with no source row, it falls back to the 4th
field of an ISO 19650-style filename (`REH-MD01-HYH-AR-OBM-1059-M3-000004` → `AR`) - a convention,
not a guarantee.

**Revision** is looked up best-effort via ACC's undocumented `versions:batch-get` Document
Management endpoint (not covered by the official SDK, called directly), capped at 300 matched
files per search. Only meaningful for a clean single match.

## API reference

All routes below except `/api/auth/*` and `/api/health` run behind `requireAuth`, which
transparently refreshes the APS access token within 60s of expiry and returns `401` only on an
actual auth rejection (not a transient APS outage).

**Auth — `/api/auth`**

| Method | Path        | Description                                        |
| ------ | ----------- | --------------------------------------------------- |
| GET    | `/login`    | Starts the PKCE flow, redirects to Autodesk.        |
| GET    | `/callback` | Exchanges the auth code, stores tokens + profile.   |
| GET    | `/me`       | Returns the signed-in profile, or 401.              |
| POST   | `/logout`   | Destroys the server session.                        |

**Hubs & folders — `/api`**

| Method | Path                                                    | Description                          |
| ------ | -------------------------------------------------------- | -------------------------------------- |
| GET    | `/hubs`                                                  | ACC hubs visible to the signed-in account. |
| GET    | `/hubs/:hubId/projects`                                  | Projects within a hub.               |
| GET    | `/hubs/:hubId/projects/:projectId/topFolders`            | A project's top-level folders.       |
| GET    | `/projects/:projectId/folders/:folderId/children`        | One page of a folder's contents (all pages fetched internally). |

**TIDP/MIDP source — `/api/excel`**

| Method | Path                        | Description                                       |
| ------ | --------------------------- | -------------------------------------------------- |
| GET    | `/parse?projectId&itemId`   | Downloads + parses a workbook already in ACC. 60s timeout. |
| POST   | `/upload`                   | Multipart `file` field, 50MB cap, parsed in memory. |

**Files Log — `/api/files-log`**

| Method | Path                        | Description                                          |
| ------ | --------------------------- | ------------------------------------------------------ |
| POST   | `/scan`                     | Body: `{ projectId, folders[], includeSubfolders }`.  |
| GET    | `/parse?projectId&itemId`   | Downloads + parses an already-exported log workbook. |
| POST   | `/upload`                   | Same parser, uploaded workbook.                       |

**Search, setups, log, export**

| Method | Path                             | Description                                            |
| ------ | --------------------------------- | ---------------------------------------------------------- |
| POST   | `/search/run`                    | Runs the match engine; best-effort revision lookup if `projectId` is given. |
| GET    | `/setups`                        | List saved setups.                                     |
| POST   | `/setups`                        | Create a setup.                                         |
| PUT    | `/setups/:id`                    | Update a setup. Validates `name`/`hubId`/`projectId` are present, same as create. |
| DELETE | `/setups/:id`                    | Delete a setup.                                          |
| GET    | `/log`                           | Activity/error log entries, newest first.                |
| DELETE | `/log`                           | Clears the in-memory log.                                 |
| GET    | `/log/export?format=xlsx\|csv`   | Downloads the activity log.                                |
| POST   | `/export/report`                 | Builds the QA/QC workbook; downloads it, or saves to an ACC folder if `saveTo` is given. |

## Data model

Core shapes shared between server and client (`types/domain.ts`, kept in sync on both sides).

- **IndexedFile** — `fileName, baseName, extension, itemId?, versionId?, folderPath?, lastModifiedTime/By?`
- **RowMatchResult** — `rowIndex, identifier, discipline, sourceRevision, formats[], status`
- **FormatMatch** — `format, status, fileName?, revision?, revisionMatch?, matchedVia?`
- **Setup** — hub/project, sourceMode, identifier/formats/planned-date/revision columns, matchMode,
  filesLogMode + scan/file settings, onlyShared, sharedKeyword, exportFolderId

> A **Setup** persists configuration, not data - the TIDP/MIDP file and the Files Log itself are
> always re-selected or re-run, since both are point-in-time and could be stale by the next
> submittal cycle.

## QA/QC report

`reportExport.service.ts` builds a two-sheet, OBMI-branded workbook (`exceljs`).

**Summary sheet** - progress stat tiles (Completion, Total TIDP/MIDP, Total Files Log, Match,
Missing, Duplicates, Extra), a discipline-wise completion table, grouped Missing and Duplicate
deliverable lists, the comparison setup used, and a short prose analysis block.

**Comparison Table QA_QC sheet** - one row per TIDP/MIDP row × format, plus one row per unmatched
Files Log file ("Not found in TIDP/MIDP"). Columns: Deliverable, Format, Status, Discipline, Files
Log Entry (hyperlinked to ACC when available), Version, Folder Path, Last Modified, Modified By,
Log Revision, TIDP/MIDP Revision, Revision Match, Matched Via - autofilter enabled.

Skipped rows are excluded from the Comparison sheet entirely but still counted in the Summary's
stats.

## Deployment

| Setting          | Value                            |
| ----------------- | ---------------------------------- |
| Web App           | `apsFilesComparison`              |
| Resource group    | `apsOBMIDev`                      |
| Region            | Canada Central                     |
| Runtime           | `NODE|24-lts` (Linux)             |
| Plan              | B1 (Basic, 1 vCPU / 1.75GB)        |
| Always On         | enabled                            |

### Build pipeline

Deployed via the classic `zipdeploy` Kudu endpoint (`az webapp deployment source config-zip`, or
the GitHub Actions workflow below) with `SCM_DO_BUILD_DURING_DEPLOYMENT=true`, which invokes Oryx
to run `npm install` + `npm run build` (both workspaces) server-side from a plain source zip.
`az webapp deploy --type zip` does **not** do this - it's a raw file sync (Kudu's OneDeploy path)
with no build step at all.

### Build-time vs. runtime `NODE_ENV`

The server needs `NODE_ENV=production` at runtime (secure cookies, `trust proxy`). But App
Settings are injected into *both* the Oryx build container and the runtime container - with
`NODE_ENV=production` set as an App Setting, Oryx's `npm install` silently skips
`devDependencies`, so `tsc` isn't on the build's `PATH` and the TypeScript build fails with
`tsc: not found`.

Fix: `NODE_ENV` is **not** set as an App Setting. It's set only for the running process, via a
custom Startup Command:

```
NODE_ENV=production node server/dist/index.js
```

> A pre-built zip (bundling `node_modules` directly, skipping Oryx) was also tried, to sidestep
> this - it failed for a different reason: the plan's B1 tier couldn't rsync 6,000+ loose
> `node_modules` files inside the deploy timeout. Oryx's build path packs `node_modules` as a
> single tarball instead, which is why it's the reliable path despite the extra step above.

### Continuous deployment (Azure AD OIDC)

[`.github/workflows/azure-deploy.yml`](../.github/workflows/azure-deploy.yml) deploys on every
push to `main`, authenticating via `azure/login@v2` with a **federated Azure AD app registration**
rather than a stored publish profile.

This Web App has basic publishing credentials (SCM + FTP) disabled at the Azure policy level, so
a publish-profile-based `azure/webapps-deploy` step fails outright with *"Publish profile is
invalid for app-name and slot-name provided"* - the profile's embedded username/password is simply
rejected. OIDC sidesteps this: no password-based credential exists to be blocked.

Setup performed:

1. `az ad app create` - a dedicated app registration (not shared with anything else).
2. `az ad sp create` - service principal for that app.
3. `az ad app federated-credential create` - trusts GitHub's OIDC issuer for this repo on `main`.
   **Note:** this GitHub org presents the OIDC subject with immutable IDs appended -
   `repo:owner@ownerId/repo@repoId:ref:refs/heads/main`, not the plain `repo:owner/repo:ref:...`
   form some docs show. If a federated-credential login fails with `AADSTS700213: No matching
   federated identity record found`, the error message includes the exact subject GitHub actually
   presented - use that verbatim.
4. `az role assignment create --role "Website Contributor"` scoped to just this Web App resource
   (not the resource group) - least privilege.
5. GitHub repo secrets: `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` (identifiers,
   not passwords).

### Dedicated APS app (rate-limit isolation)

The APS Client ID originally used for this deployment was shared with a sibling tool
(`tidp_midp_ACCDocumentSubmittal`). Autodesk enforces Data Management API rate limits **per Client
ID across all of that app's traffic** - sharing one meant both tools competed for the same budget.
Live folder scans (BFS walk, `FOLDER_CONCURRENCY = 2`, exponential backoff on 429s) were hitting
the shared circuit breaker repeatedly, which read as generalized "slow app performance" but was
actually Autodesk-side throttling. Fix: a separate, dedicated APS app was registered for this tool
alone, and `APS_CLIENT_ID`/`APS_CLIENT_SECRET` updated accordingly.

### Known cosmetic issue - Safe Browsing warning

Chrome may show a "Dangerous site" interstitial on first visit. This is a known false-positive
pattern against shared `*.azurewebsites.net` hostnames (frequently abused for throwaway phishing
apps), not a finding against this app's own content - nothing here collects credentials directly;
`/api/auth/login` only redirects to Autodesk's own login page. Clearing it: verify the URL in
Google Search Console and request a security review (typically 24-72h), and/or front the app with
a custom domain to escape the shared hostname's reputation entirely.

## Configuration

| Variable                         | Required        | Purpose                                                        |
| ---------------------------------- | ---------------- | ------------------------------------------------------------------ |
| `NODE_ENV`                        | runtime only     | Set via Startup Command, not App Settings - see [Deployment](#deployment). |
| `PORT`                            | no (default 8080)| Azure sets this itself; leave unset in App Settings.            |
| `CLIENT_URL`                      | yes              | The app's own origin - used for CORS and OAuth redirect targets. |
| `SESSION_SECRET`                  | yes              | Signs the session cookie. Long random string, no default.       |
| `APS_CLIENT_ID`                   | yes              | Autodesk Platform Services app id - dedicated to this tool.     |
| `APS_CLIENT_SECRET`               | yes              | APS app secret.                                                 |
| `APS_CALLBACK_URL`                | yes              | Must exactly match a redirect URI registered on the APS app.    |
| `SCM_DO_BUILD_DURING_DEPLOYMENT`  | yes (Azure)      | Enables the Oryx build - see [Deployment](#deployment).         |

### APS app requirements

A **Traditional Web App** (3-legged Authorization Code + PKCE) at
[aps.autodesk.com](https://aps.autodesk.com), Data Management API product enabled, scopes
`data:read data:write data:create data:search account:read`, with a callback URL matching
`APS_CALLBACK_URL` registered as a redirect URI. Give each deployed tool its own app registration -
see [Deployment](#deployment).

## Operational notes

| Area                 | Behavior                                                                 |
| ---------------------- | ---------------------------------------------------------------------------- |
| Sessions              | In-memory (`express-session` default store) - fine for a single instance; a restart signs everyone out. |
| Saved setups          | `server/data/setups.json` - the `server/data/` directory (gitignored, runtime-only) is created at startup if missing, since a fresh deploy checkout won't have it. |
| Uploads               | 50MB cap, held in memory only for the request - never written to disk.     |
| Blank rows            | Dropped automatically when the TIDP/MIDP workbook is parsed.               |
| "Only Shared" filter  | Plain case-insensitive substring match on folder path - a file with no folder-path column is left in regardless, with a logged warning. |
| Revision lookup       | Live-scan files only (need a real version id); capped at 300 matched files per search. |
| ACC rate limiting     | The Data Management SDK's shared circuit breaker opens after 5 consecutive failures and blocks all calls for 60s - folder scans use low concurrency (2) with exponential backoff for exactly this reason. |
| Cold starts           | Prevented by Always On (enabled) - without it, the app idles out after ~20 minutes and the next request pays for a full container restart. |
| CPU-heavy work        | Runs on the worker-thread pool, not the request thread - see [Architecture](#architecture). Sized to the host's CPU count, so a bigger App Service plan also means more parallel worker capacity. |
| Multi-folder check    | Checking a folder in the Files Log scan picker also checks its immediate (one level) subfolders - deliberately shallow, since the scan itself already walks deeper server-side with rate-limit protection. |

## Troubleshooting

| Symptom                                        | Cause                                                                 | Fix                                                                 |
| ------------------------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Chrome "Dangerous site"                        | Shared `azurewebsites.net` reputation - see [Deployment](#deployment). | Request a Search Console security review, or move to a custom domain. |
| `tsc: not found` during deploy                 | `NODE_ENV=production` set as an App Setting suppresses devDependencies during the Oryx build. | Remove it from App Settings; set it on the Startup Command instead. |
| Deploy times out on a B1 plan                  | Pre-built `node_modules` zipped and rsynced file-by-file.              | Deploy source only, let Oryx build (tarballs `node_modules` instead). |
| `AADSTS700213: No matching federated identity`  | The OIDC subject GitHub presents doesn't match the federated credential (e.g. immutable IDs appended). | Read the exact subject from the failed run's log and update the federated credential to match. |
| `azure/webapps-deploy` fails: "Publish profile is invalid" | Basic publishing credentials (SCM/FTP) disabled on the Web App at the policy level. | Switch the workflow to Azure AD OIDC via `azure/login` instead of a publish profile. |
| Sign-in redirects but session never sticks     | `APS_CALLBACK_URL` not registered on the APS app, or doesn't exactly match. | Add the production callback URL as a redirect URI at aps.autodesk.com. |
| 503 "temporarily rate-limiting"                | APS SDK's shared circuit breaker is open after repeated failures.      | Wait ~60s and retry - this is the SDK protecting itself, not an app bug. |
| ACC scans feel slow, Activity Log shows 429/retry warnings | Autodesk-side rate limiting, often worse if the APS Client ID is shared with another tool. | Scope scans to fewer/specific folders; register a dedicated APS app per tool. |
| "Only Shared" leaves everything in             | The Files Log source has no recognizable Folder Path column.           | Check the Activity log for the warning; re-export the log with that column present. |
