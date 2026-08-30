# R05.2 — DATASUS proxy hardening

**Date:** 2026-08-27  
**Status:** COMPLETE — WORKER AND PUBLIC PAGES FLOW VERIFIED

## 1. Outcome

The optional Cloudflare Worker is now a bounded acquisition adapter suitable
for connecting the static GitHub Pages application to the official DATASUS
transfer service. It handles only acquisition envelopes. It never receives
local user files and has no dependency on legacy parsing, `AnalysisSpec`,
`QueryPlan`, execution or analytical results.

The public Pages build now uses the stable Worker origin through a committed
Vite production environment file. No provisional URL or credential is present.

## 2. Enforced proxy contract

| Route | Accepted method | Destination |
| --- | --- | --- |
| `/health` | `GET` | local JSON health response |
| `/catalog` | `POST` | exact DATASUS `wp-content/ftp.php` |
| `/prepare` | `POST` | exact DATASUS `wp-content/download.php` |
| `/archive?url=...` | `GET` | exact HTTPS `zipupload/<one-segment>/arquivo.zip` envelope |

The implementation additionally enforces:

- canonical `http`/`https` origins from an explicit comma-separated allowlist;
- production CORS only for `https://redkk123.github.io`;
- per-route preflight method and `Accept`/`Content-Type` header allowlists;
- `application/x-www-form-urlencoded` POST bodies, bounded before and while
  reading;
- bounded form responses and ZIP streams even without `Content-Length`;
- ZIP content types observed/expected from the official service;
- official host/path validation before every upstream request and after every
  redirect;
- POST redirects only when 307/308 preserve the request contract;
- separate form/archive timeouts and a maximum redirect count;
- normalized JSON errors without upstream bodies or internal details;
- explicit safe response headers rather than copying the upstream header set;
- `no-store` for forms/errors and private five-minute browser caching for the
  prepared archive stream.

## 3. Deployment reproducibility

Pinned development dependency: `wrangler@4.127.0`.

Commands:

```text
npm run proxy:check
npm run proxy:dev
npm run proxy:deploy
npm run proxy:rollback -- <VERSION_ID>
```

`apps/datasus-proxy/wrangler.jsonc` is the deployment source of truth. It
contains the public origin and numerical safety settings, but no account ID,
token or secret. CI installs from the lockfile, runs the complete application
gate and performs the Worker dry-run.

Observed dry-run:

- Wrangler: `4.127.0`;
- upload: `18.43 KiB`;
- gzip: `4.81 KiB`;
- bindings: exact origin plus form/archive size, timeout and redirect limits;
- result: PASS.

Observed production deployment:

- Worker: `tabwin-web-datasus-proxy`;
- origin: `https://tabwin-web-datasus-proxy.tabwin-web.workers.dev`;
- Worker version: `1ff6db56-2b8b-4086-8241-b1fad1b88f8f`;
- Pages commit: `74e04d6`;
- health: HTTP 200 after `workers.dev` TLS propagation.

## 4. Tests

`npm run check` passed:

- 86 tests, all passing;
- TypeScript kernel build;
- browser typecheck;
- Vite production build.

The proxy file contributes eleven tests. They exercise successful and hostile
requests without contacting the network: route/query rejection, URL variants,
origin parsing, health/configuration behavior, method/preflight rules, request
limits, response-header filtering, redirect rejection, normalized upstream
failure and streamed ZIP response validation.

The workflow was moved from the recovered project subdirectory to the
repository-root `.github/workflows`, making it discoverable by GitHub. The
first run (`33119469943`) was stopped before runner allocation with the explicit
annotation that the GitHub account is locked due to a billing issue. No CI step
ran or failed. The root workflow remains ready to execute the already-passing
local gates when the account-level lock is resolved.

## 5. Official-envelope probe

A live probe contacted only the official public service and cancelled the ZIP
body after receiving its headers.

| Observation | Value |
| --- | --- |
| Catalog | HTTP 200 |
| Prepare | HTTP 200 |
| Prepared path | `/wp-content/zipupload/Arq_642881253/arquivo.zip` |
| Archive | HTTP 200 |
| Content-Type | `application/zip` |
| Declared length | 287,299 bytes |

This is transport evidence, not a new TabWin semantic claim.

## 6. Production end-to-end evidence

Direct Worker checks produced:

| Check | Result |
| --- | --- |
| Health | 200 with normalized service JSON |
| Hostile origin | 403, no reflected CORS origin |
| Hostile archive target | 400 `invalid_archive_target` |
| Valid catalog preflight | 204 for the exact Pages origin |
| Official catalog | 200, found `RDAC2401.dbc` |
| Official prepare | 200, approved `zipupload` URL |
| Archive through Worker | 287,299 bytes, ZIP signature `50 4B 03 04` |

The deployed Pages interface then ran the same user-facing path:

1. opened **Buscar no DATASUS**;
2. selected SIH/SUS, RD, 2024, January, AC;
3. found one `RDAC2401.dbc` result;
4. downloaded and opened the DBC through the Worker;
5. requested the verified automatic SIH auxiliary bundle;
6. reported `RDAC2401.dbc aberto com 97 auxiliares`;
7. listed `COMPLEX2.CNV` and other DEF/CNV/MAP material in the workspace.

The prior Android screenshot remains a useful physical-device regression case
for R09.1, but its CORS root cause is closed by the same deployed origin.

No golden reference was modified and no TabWin behavior was inferred from the
proxy work.
