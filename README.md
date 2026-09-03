# ACC Files Log vs TIDP/MIDP Checker

**v1.2.1** - see [`CHANGELOG.md`](CHANGELOG.md) for version history and what changed in each
release.

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
  saved setups (lowdb JSON store), and the error log. Workbook parsing, matching, and QA/QC report
  generation each run on a small `worker_threads` pool (`server/src/workers/`) instead of the main
  thread, so a large MIDP or a big Files Log doesn't stall other requests (or the Activity Log's
  own polling) while it's being processed.
- `client/` — React + TypeScript + Vite SPA. Has no Excel-parsing dependency at all - it gets back
  ready-to-render JSON from the server. Shared workspace state (hub/project, the loaded workbook,
  column mapping, Files Log, results) lives in one React Context (`client/src/context/`) so the
  persistent top bar, the Workspace page, and the dedicated **Setup & mapping** page all read/act
  on the same state. Supports light/dark/system theme (persisted, flash-free on load).

See [`docs/REFERENCE.md`](docs/REFERENCE.md) for the full technical reference - API surface, data
model, matching engine internals, QA/QC report structure, and the deployment record below in more
depth.

## Prerequisites

1. An **Azure subscription** — the app runs as a single Linux App Service (Node 20). See
   [`deploy/azure-provision.sh`](deploy/azure-provision.sh) for the resources it needs (App Service
   Plan, Web App, Key Vault, Application Insights).
2. An **APS (Autodesk Platform Services) app** at [aps.autodesk.com](https://aps.autodesk.com) — a
   **Traditional Web App** (3-legged Authorization Code + PKCE) with the Data Management API
   product enabled, and a callback URL matching `https://<your-app-name>.azurewebsites.net/api/auth/callback`.
   Required scopes: `data:read data:write data:create data:search account:read`. Give this tool its
   **own** APS app rather than sharing a Client ID with another tool - Autodesk enforces API rate
   limits per Client ID across *all* of that app's traffic, so sharing one means both tools compete
   for the same budget (this was the actual cause of "slow ACC scans" the first time this app was
   deployed - see [`docs/REFERENCE.md`](docs/REFERENCE.md#deployment)).
3. Your Autodesk account needs access to the ACC hub/project(s) you want to check - the app only
   shows hubs/projects/folders your signed-in account can already see. (Sign-in is still required
   even if you plan to use upload-only for both sides - the app is ACC-integrated throughout, e.g.
   for saved setups and "save report to ACC folder".)

## Deploy

The app runs as a single Linux App Service; client and API are served from the same Azure Web App
origin, so there's no separate frontend host or dev server in the deployed app.

### Provisioning new infrastructure

```bash
APS_CLIENT_ID=... APS_CLIENT_SECRET=... SESSION_SECRET=... bash deploy/azure-provision.sh
```

Provisions the Azure resources and wires up App Settings (see the script for what it creates) - App
Service Plan, Web App, Key Vault, Application Insights. Edit the variables at the top of the script
first (names/region/SKU are placeholders).

### Continuous deployment

Every push to `main` builds and deploys automatically via
[`.github/workflows/azure-deploy.yml`](.github/workflows/azure-deploy.yml). It authenticates to
Azure with **Azure AD OIDC** (a federated Azure AD app registration scoped to just this one Web
App) rather than a stored publish profile - if the target Web App has basic publishing credentials
(SCM/FTP) disabled at the policy level, as this one does, a publish-profile-based deploy fails
outright with "Publish profile is invalid". Required repo secrets: `AZURE_CLIENT_ID`,
`AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` - no passwords. Setting this up for a new Web App means
creating an app registration, adding a federated credential trusting
`repo:<owner>/<repo>:ref:refs/heads/main` as the OIDC subject (GitHub may present this with
immutable IDs appended, e.g. `repo:owner@id/repo@id:ref:...` - check the failed run's logs for the
exact subject it presented if the federated credential doesn't match), and granting it the
`Website Contributor` role scoped to the Web App.

### Two settings that matter and aren't obvious

- **`NODE_ENV=production` must be set on the Web App's Startup Command, not as an App Setting** -
  App Settings are visible to the Oryx build step too (`SCM_DO_BUILD_DURING_DEPLOYMENT=true`), and
  with `NODE_ENV=production` present there, `npm install` silently skips `devDependencies` -
  breaking the TypeScript build (`tsc: not found`) since `typescript` lives in `devDependencies`.
  Startup Command: `NODE_ENV=production node server/dist/index.js`.
- **Always On** should be enabled (Basic tier and above support it, at no extra cost) - without it,
  the app fully idles out after ~20 minutes of no traffic, and the next request pays for a cold
  start (container pull + Node boot, observed to take anywhere from 30s to several minutes).

Once deployed, sign in with Autodesk at the app's Azure URL, then:

1. Pick the hub and project in the top bar - this stays put across every page below.
2. On **Workspace**: provide the TIDP/MIDP workbook (**Pick from ACC** or **Upload**) and the ACC
   Files Log (**Scan folder(s) live**, **Pick existing file from ACC**, or **Upload**).
3. Open **Setup & mapping** (linked from either "Edit / Setup" pill on Workspace) to configure the
   comparison in one place: which tabs to include and each tab's header row, the identifier/
   formats/planned-date/revision column mapping and match mode (including **Deep search**), row
   filters, the Files Log's "only count files whose folder path contains…" keyword filter
   (defaults to `Shared`), and a preview of exactly what will be compared.
4. Back on **Workspace**, click **Compare** (also pinned in the top bar whenever a workbook is
   loaded) and review the per-row, per-format results - including which match strategy hit, under
   Deep search - then export the QA/QC report as `.xlsx` (download, or save straight back into an
   ACC folder) and/or the activity/error log.

Save the current configuration as a named **setup** under **Saved setups** to skip re-picking
everything next time - the same dialog that saves changes back to a loaded setup also lets you
rename it inline. The TIDP/MIDP source and the Files Log itself still need to be reselected/
rerun/reuploaded each time, since both are either live ACC data or a local file that isn't
persisted between sessions.

A step tracker at the top of Workspace shows where you are (file → Files Log → results), a
one-time "start here" callout points at the first thing to click on a brand-new browser, and a "?"
in the top bar opens a short in-app guide any time.

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
- Live folder scans walk the ACC tree only 2 folders at a time, with exponential backoff on
  429s, specifically to avoid the Autodesk SDK's shared circuit breaker (opens after 5 consecutive
  failures and blocks *all* ACC calls for 60s). If a scan is slow, check the Activity Log panel for
  retry/rate-limit warnings before assuming it's an infrastructure problem - it's almost always
  Autodesk-side throttling, not this app. Scoping a scan to fewer, more specific folders (rather
  than a broad top-level folder with subfolders included) is the most effective fix.
- Checking a folder in the Files Log's multi-folder picker also checks its immediate subfolders
  (expanding it first if needed) - a quick way to pick up everything one level down without
  expanding and ticking each subfolder by hand. It's deliberately shallow (one level, not the
  whole subtree): the scan itself already walks arbitrarily deep server-side when "Include
  subfolders" is on, with the retry/backoff protection above - auto-checking every descendant here
  client-side would just race that same API with none of those protections.
- CPU-heavy work (parsing a workbook, matching rows, building the QA/QC export) runs on a small
  pool of `worker_threads`, not the main request thread - so one large MIDP or Files Log being
  processed doesn't stall other requests, including the Activity Log panel's own polling.
