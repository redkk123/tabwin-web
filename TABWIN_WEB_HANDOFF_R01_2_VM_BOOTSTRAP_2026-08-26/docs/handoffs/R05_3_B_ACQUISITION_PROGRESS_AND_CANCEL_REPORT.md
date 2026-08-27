# R05.3-B — Acquisition progress, cancellation and retry states

**Date:** 2026-08-27
**Status:** COMPLETE LOCALLY — PUBLIC DOWNLOAD SMOKE PENDING DEPLOYMENT

## 1. Outcome

Official DATASUS catalog and archive operations are now explicitly cancellable.
Archive download no longer waits for a monolithic `arrayBuffer()`: it reads the
response stream, enforces the compressed-envelope limit while bytes arrive and
reports byte/percentage progress when `Content-Length` is available.

This changes acquisition transport and UX only. DBC/DBF decoding, legacy
metadata, `AnalysisSpec`, `QueryPlan`, execution and golden results are
unchanged.

## 2. Browser behavior

While a catalog or official-download operation is active:

- the ordinary search/download controls are disabled;
- a dedicated **Cancelar** button appears;
- cancel aborts the shared request signal, including auxiliary lookup,
  preparation and archive streaming;
- manual cancellation reports `Consulta cancelada` or `Operação cancelada`
  without presenting a false failure;
- 60-second catalog and 120-second complete-open timeouts remain errors and
  explicitly invite retry;
- controls are restored and the cancel button disappears in every final state.

An aborted auxiliary request is rethrown. It can no longer be mistaken for a
non-fatal missing auxiliary followed by an unwanted data download.

## 3. Streaming safety

The client accepts at most 512 MiB of compressed archive bytes, matching the
deployed Worker envelope limit. It rejects an oversized declared
`Content-Length` before reading and also counts streamed bytes when the server
does not declare a length. On overflow it cancels the reader before throwing.

Chunks are joined only after a complete bounded stream, then pass through the
existing nested-ZIP entry, per-file and expanded-size limits.

## 4. Verification

`npm run check` passed:

- 86 tests passed;
- semantic-kernel build passed;
- browser typecheck passed;
- Vite production build passed;
- production JavaScript: 136.77 kB (45.79 kB gzip).

The local browser case started SIH-RD / AC / 2024-01 catalog search, observed
the cancel button during the active request, cancelled it and verified:

- status `Consulta cancelada.`;
- search enabled again;
- cancel hidden afterward;
- no console errors.

The production Worker rejects localhost by design. Public progress and cancel
smokes are therefore deferred until this build is deployed to Pages.

## 5. Remaining R05.3

The remaining acquisition-coverage work is semantic/evidentiary rather than
transport work:

1. safe manual auxiliary-package inspection and selection;
2. system-by-system verified DEF/CNV bundle rules;
3. never infer unsupported rules from file-name resemblance.
