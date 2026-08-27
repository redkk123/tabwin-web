# R03.3 — Public release and G001 oracle preparation

**Date:** 2026-08-27
**Status:** PUBLIC STATIC APP ONLINE; G001 ASSETS READY; REFERENCE UI CAPTURE PENDING

## 1. Public release

The repository was made public with explicit owner authorization. Because the
account's ordinary Actions runners are locked by a billing issue, the verified
`dist-web` artifact was published through an isolated `gh-pages` branch.

Live URL:

`https://redkk123.github.io/tabwin-web/`

The deployed interface and DATASUS search dialog were inspected in the browser.
Local DBC/DBF/DEF/CNV/MAP opening remains entirely client-side.

## 2. DATASUS browser-origin finding

The official server-side verifier continues to pass, but a real request from
the GitHub Pages origin fails before a response is exposed to JavaScript. Header
inspection found duplicated `Access-Control-Allow-Origin: *` fields on the
official WordPress endpoint; browsers reject that combined value.

R03.3 therefore:

- replaces the opaque `Failed to fetch` with an honest local-file/proxy message;
- adds `VITE_DATASUS_PROXY_BASE` routing for `/catalog`, `/prepare` and `/archive`;
- adds a small allowlisted proxy implementation under `apps/datasus-proxy`;
- rejects arbitrary archive hosts and paths;
- does not silently route public health downloads through an unrelated proxy.

The proxy implementation is not deployed. This remains an explicit public-host
integration blocker rather than a compatibility defect.

## 3. G001 materialization

`scripts/materialize-g001.mjs` now deterministically downloads the pinned
upstream DBC fixture and current official SIH auxiliary bundle, selects only
`RD2008.DEF` and `COMPLEX2.CNV`, and records sizes, hashes and source URLs.
Transient official 5xx responses use four bounded retries.

The local isolated oracle workspace reproduced the expected hashes:

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| RDAC2401.dbc | 313,213 | `41B7AD58932CD56D6C60455CBF67E7995F5FD2E64375D0CC440631A191638429` |
| RD2008.DEF | 33,581 | `15376FB2E56917B4122FA475B15F1E270E9DAA4238F518D75E6BB6044372C652` |
| COMPLEX2.CNV | 265 | `680EB03BD06964CF4DAE4B571BC757990688279ADB164B54D5253009D8A3975F` |

The user-supplied `TabWin415.exe` was extracted into the isolated workspace.
Its SHA-256 is
`0E29A44DE78D164CE13FAA73EC74B76C77041FCF3D8BF6374A893B5E6A713F02`.
The G001 folder structure matches the DEF-relative `CNV\COMPLEX2.CNV` path.

## 4. Verification

`npm run check` passes 44/44 tests, browser typechecking and the Vite production
build. No golden output was created or changed.

## 5. Immediate next action

Launch the supplied TabWin 4.15 binary after the required executable-run
confirmation, open `G001/RD2008.DEF`, select `RDAC2401.dbc`, configure the exact
protocol, export the lossless result and compare it with zero tolerance.
