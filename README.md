# ACC Files Log vs TIDP/MIDP Checker

Checks a TIDP/MIDP Excel schedule against an Autodesk Construction Cloud (ACC) **Files Log**
instead of a live per-folder search. Both the TIDP/MIDP schedule and the Files Log can each come
from **either** of two places:

- **Live from ACC** - browse and pick the TIDP/MIDP workbook from ACC; for the Files Log, either
  scan folder(s) live (always-current) or pick up an already-exported Files Log workbook (e.g. one
  produced by the companion **ACC File Log Extractor** tool, or ACC's own "SHARED FILES LOG" /
  "WIP FILES LOG" exports).
- **Uploaded from your computer** - drop in a TIDP/MIDP workbook and/or a Files Log workbook you
  already have locally, parsed server-side the same way either path is.

An optional "only Shared" filter narrows the Files Log down to files whose folder path matches a
keyword (e.g. `Shared`), so a comparison can be scoped to documents that have actually reached the
project's ISO 19650 Shared area rather than everything in WIP too. A **deep search** match mode
tries an exact base-filename match first, then falls back to starts-with, then contains - so naming
drift (extra suffixes, version tags, casing) doesn't produce a false "missing" the way committing
to one single match mode up front can; results show which strategy actually found each match.

Filter the TIDP/MIDP schedule down to the filled-in rows you care about, pick the column that holds
each document's base filename and the file formats it should exist in (comma-separated, e.g. `pdf,
dwg, ifc`), then compare against the Files Log. Results and any errors along the way are
exportable as a log, and the full comparison as a branded QA/QC report. Repeat configurations
("setups") can be saved and reloaded for the next submittal cycle.

## Architecture

- `server/` — Express + TypeScript API. Handles APS 3-legged OAuth (PKCE), Data Management API
  calls (hubs/projects/folders), downloading/parsing the TIDP/MIDP source file (exceljs, either
  from ACC or a local upload via multer), three ways of assembling the Files Log (a live recursive
  multi-folder scan, parsing an already-exported Files Log workbook from ACC, or a local upload of
  one), matching TIDP/MIDP rows against it (including the "deep search" combined match strategy),
  saved setups (lowdb JSON store), and the error log.
- `client/` — React + TypeScript + Vite SPA. Has no Excel-parsing dependency at all - it gets back
  ready-to-render JSON from the server - and drives the folder browsing, file uploads, row
  filtering, Files Log source picking, and results UI.

## Prerequisites

1. **Node.js 20+** and npm.
2. An **APS (Autodesk Platform Services) app** — reuse the **same APS app as the
   `tidp_midp_ACCDocumentSubmittal` project** (the credentials in that project's `server/.env`):
   same Client ID/Secret, and the same `http://localhost:3001/api/auth/callback` callback URL
   works here too since this app also runs its server on port 3001. If you'd rather register a
   fresh one, it needs to be a **Traditional Web App** (3-legged Authorization Code + PKCE) with
   the Data Management API product enabled.
3. Your Autodesk account needs access to the ACC hub/project(s) you want to check - the app only
   shows hubs/projects/folders your signed-in account can already see. (Sign-in is still required
   even if you plan to use upload-only for both sides - the app is ACC-integrated throughout, e.g.
   for saved setups and "save report to ACC folder".)

## Setup

```bash
npm install                     # installs root, server, and client workspaces
cp server/.env.example server/.env
```

Edit `server/.env` and fill in the APS Client ID/Secret from Prerequisites above and a random
`SESSION_SECRET`.

## Run

```bash
npm run dev
```

This starts the API on `http://localhost:3001` and the frontend on `http://localhost:5173` (the
frontend dev server proxies `/api/*` to the backend, so just open `http://localhost:5173`). Sign in
with Autodesk, then:

1. Pick the hub and project.
2. Provide the TIDP/MIDP workbook - **Pick from ACC** (browse and select the live `.xlsx`) or
   **Upload from computer**.
3. Filter the filled-in rows (per-column filters + text search) and pick the identifier column
   (the column holding each document's base filename), formats column, and match mode (including
   **Deep search**).
4. Provide the Files Log - **Scan ACC folder(s) live** (check any number of folders; each, and its
   subfolders if enabled, gets walked), **Pick existing file from ACC**, or **Upload from
   computer**. Optionally turn on "only count files whose folder path contains…" (defaults to
   `Shared`) to scope the comparison to files that have reached the Shared area.
5. Click "Compare" and review the per-row, per-format results (including which match strategy hit,
   under Deep search), then export the QA/QC report as `.xlsx` (download, or save straight back
   into an ACC folder) and/or the activity/error log.

Save the current hub/project/Files Log settings/column/format configuration as a named **setup**
to skip re-picking everything next time - load it from the dropdown at the top of the workspace.
The TIDP/MIDP source and the Files Log itself still need to be reselected/rerun/reuploaded each
time, since both are either live ACC data or a local file that isn't persisted between sessions.

## Build

```bash
npm run build      # typechecks + builds both server (dist/) and client (dist/)
```

## Notes

- Sessions are stored server-side in memory (`express-session`), keyed by a cookie - fine for
  local/single-instance use. Restarting the server signs everyone out.
- Saved setups live in `server/data/setups.json` (gitignored) - back it up if you want to keep
  your configurations across machines.
- Uploads are capped at 50MB and held in memory only for the duration of the request (multer's
  memory storage) - nothing uploaded is written to disk or persisted server-side.
- Rows with every cell blank (trailing/spacer rows) are dropped automatically when the TIDP/MIDP
  workbook is parsed - only filled-in rows make it into the filter table.
- The "only Shared" filter is a plain case-insensitive substring match against each file's folder
  path - ACC Docs has no built-in ISO 19650 CDE state field, so this only works as well as your
  project's folder naming convention does. A file with no recognizable "Folder Path" (an uploaded
  or ACC-picked log workbook missing that column) is left in regardless of the filter (a warning is
  logged).
- A file matched from a live ACC scan carries a real ACC item id (deep link + revision lookup both
  work); a file parsed out of an exported/uploaded log workbook only has whatever the log recorded
  (its "ACC Link" column is a best-effort deep link, and there's no revision lookup since the log
  never captured a version id).
- Deep search never blends candidates from more than one strategy together - it stops at the first
  strategy (exact, then starts-with, then contains) that finds anything, including a duplicate, so
  a clean exact match is never diluted by broader results.
