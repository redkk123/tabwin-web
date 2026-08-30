# ADR-0001 — Local-first analysis

- **Status:** Accepted in R00
- **Date:** 2026-08-26

## Context

TabWin historically operates on local files. A web reimplementation could easily become server-dependent, creating privacy, deployment and scalability burdens that are unnecessary for public DATASUS files and problematic for arbitrary local DBF inputs.

## Decision

The core analysis path will execute locally in the browser. Opening a local file must not require uploading it to an application server.

Servers may later be used optionally for catalog/download proxying, collaboration or enterprise connectors, but not for basic tabulation.

## Consequences

### Positive

- simpler self-hosting;
- offline/intranet feasibility;
- stronger privacy story;
- lower operational cost;
- avoids central upload bottleneck.

### Negative

- browser memory constraints;
- worker/WASM complexity;
- direct FTP/CORS constraints for automatic downloads;
- careful storage rules required on shared workstations.
