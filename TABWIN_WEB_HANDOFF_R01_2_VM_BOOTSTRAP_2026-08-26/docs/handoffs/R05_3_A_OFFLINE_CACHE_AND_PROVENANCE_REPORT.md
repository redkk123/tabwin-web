# R05.3-A — Offline cache, recent downloads and acquisition provenance

**Date:** 2026-08-27  
**Status:** COMPLETE LOCALLY — PUBLIC CACHE REOPEN SMOKE PENDING DEPLOYMENT

## 1. Outcome

The official DATASUS acquisition cache is now a visible, user-controlled
product surface instead of an invisible performance detail. The browser lists
cached data and auxiliary envelopes, reports their aggregate local size,
reopens data archives without contacting the network, removes individual
entries and clears the whole cache only after explicit confirmation.

This is an R05.3 slice, not completion of all R05.3. Automatic auxiliary rules
outside the verified SIH-RD case remain unsupported until each rule is backed
by official artifacts. The app continues to prefer a manual path over guessing
a DEF/CNV bundle.

## 2. Cache contract

Each new IndexedDB entry records:

- deterministic key derived from sorted official FTP source addresses;
- retrieval timestamp;
- complete ZIP bytes;
- ZIP byte size and SHA-256;
- role: data or auxiliary;
- official file name, source, modality and FTP address.

The existing six-envelope retention policy remains. Old entries are migrated
without rewriting their bytes: their source names and data/auxiliary role are
recovered conservatively from the prior deterministic key. Expired entries can
still be opened explicitly from **Downloads recentes**; age only controls
whether an automatic acquisition refresh reuses them.

IndexedDB denial, private browsing and quota failures remain non-fatal. They
disable persistence but never block an otherwise valid official download.

## 3. User surface

The official-source dialog now includes **Downloads recentes** with:

- number of data archives and total cache size;
- file names, data/auxiliary classification, size and local date;
- **Abrir offline** for data archives;
- per-envelope **Remover**;
- confirmed **Limpar cache**;
- an explicit explanation that removal affects only this browser cache.

Offline reopen reads the cached ZIP, applies the same bounded supported-file
extraction, chooses the named DBC/DBF (or the first recognized data file for a
legacy entry), and sends that file through the ordinary local `loadFiles`
boundary. It does not create a second analytical path.

## 4. Provenance and recipes

Officially acquired sources now retain two separate fingerprints:

1. the existing SHA-256 of the extracted DBC/DBF source;
2. SHA-256 of the official ZIP envelope.

The source also records its official FTP URL and archive retrieval time. These
facts appear in Audit and are optionally serialized in version-1
`.twrecipe.sourceHints` as `sourceUrl`, `retrievedAt` and `archiveSha256`.
Recipe parsing validates the ISO date and 64-digit archive hash. Older recipes
remain valid because all three fields are optional.

No acquisition metadata enters `AnalysisSpec`, `QueryPlan` or executor
semantics.

## 5. Verification

`npm run check` passed:

- 86 tests passed;
- TypeScript semantic-kernel build passed;
- browser typecheck passed;
- Vite production build passed;
- production bundle: 135.71 kB JavaScript (45.40 kB gzip).

Recipe tests cover deterministic round trip with the new provenance and reject
an invalid retrieval timestamp. No golden reference changed.

The local browser case verified:

- the official-source dialog opens;
- the recent-downloads region is exposed with accessible structure;
- the empty-cache and disabled-clear states are correct;
- viewport 390 x 844 has no horizontal document overflow;
- the browser console contains no error.

The production Worker intentionally accepts only the public Pages origin, so a
localhost browser cannot create a real official cache entry through it. A real
**download -> reload -> open offline** smoke is therefore pending the next
Pages deployment. This limitation is recorded rather than bypassing production
CORS or claiming unobserved evidence.

## 6. External CI observation

Workflow run `33120550257` was manually dispatched against main after this
local verification request. GitHub created the build job but stopped it after
two seconds with the exact annotation:

> The job was not started because your account is locked due to a billing issue.

No checkout, test or build step ran. Removing a spending budget does not clear
this account-level billing lock. This remains an external CI blocker and is not
evidence against the locally passing release gate.

## 7. Remaining R05.3 work

1. deploy and run the public offline-reopen smoke;
2. add explicit retry/cancel/progress controls for slow acquisition;
3. expose safe manual auxiliary-package contents whenever no rule is verified;
4. build the system-by-system auxiliary rule evidence matrix;
5. proceed to multi-file/multi-period acquisition only through the R06.0
   schema/order/fingerprint contract.

