# DATASUS acquisition proxy

This optional Cloudflare Worker lets the static GitHub Pages application call
the official DATASUS transfer endpoints without weakening the local-first
analytical architecture. It does not receive local DBC/DBF files and it does
not execute `AnalysisSpec` or `QueryPlan`.

## Public contract

| Route | Method | Upstream |
| --- | --- | --- |
| `/health` | `GET` | none |
| `/catalog` | `POST` | fixed DATASUS `ftp.php` |
| `/prepare` | `POST` | fixed DATASUS `download.php` |
| `/archive?url=...` | `GET` | one prepared `zipupload/*/arquivo.zip` URL |

All acquisition routes require an exact `Origin` from `ALLOWED_ORIGINS`.
Arbitrary hosts, paths, request headers, methods and POST redirects are refused.
Form bodies and responses are bounded. Archives are checked before being
streamed and remain bounded when the upstream omits `Content-Length`.

## Local verification

```text
npm test
npm run proxy:check
```

`proxy:check` performs a Wrangler dry-run and writes only a generated bundle
under ignored `dist/datasus-proxy`.

For interactive local Worker testing, override the committed production origin
without editing it:

```text
npm run proxy:dev -- --var ALLOWED_ORIGINS:http://127.0.0.1:5173
```

Then build or start the web app with
`VITE_DATASUS_PROXY_BASE=http://127.0.0.1:8787`.

## Production deployment

The committed Wrangler file is the source of truth. It allows only
`https://redkk123.github.io`; it contains no secret.

1. Authenticate interactively with `npx wrangler login`, or expose a scoped
   `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` only in the shell/CI.
2. Run `npm run proxy:check`.
3. Run `npm run proxy:deploy` and record the resulting `workers.dev` URL and
   version ID in the milestone report.
4. Build the Pages artifact with `VITE_DATASUS_PROXY_BASE` set to that exact
   HTTPS origin.
5. Smoke-test `/health`, rejected origins/targets, then SIH-RD AC 2024-01 and
   `TAB_SIH.zip` from the public Pages application.

Never commit `.env`, `.dev.vars`, account IDs or API tokens.

## Rollback

List deployments with:

```text
npx wrangler deployments list --config apps/datasus-proxy/wrangler.jsonc
```

Roll back immediately to a recorded stable version:

```text
npm run proxy:rollback -- <VERSION_ID> --message "rollback to verified version"
```

Rebuild Pages with the previous proxy origin if its hostname also changed.
Cloudflare documents `wrangler rollback` as creating a new deployment of the
selected prior version; it does not rewrite repository history.

Official references:

- https://developers.cloudflare.com/workers/wrangler/configuration/
- https://developers.cloudflare.com/workers/configuration/environment-variables/
- https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/
