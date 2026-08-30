# Local-first threat model — baseline

## Security objective

Opening and tabulating a local health-data file must not implicitly transmit that file to an application server or analytics provider.

## Trust boundaries

1. local file picker / drag-and-drop;
2. browser main thread;
3. analysis web worker(s);
4. WASM/decoder dependencies;
5. optional browser persistent storage;
6. network resources loaded by the application;
7. exported artifacts.

## Baseline rules

- No upload is required for local analysis.
- Telemetry must be absent by default in institutional builds unless explicitly approved.
- Do not send filenames, field names, values, hashes or recipes to analytics services by default.
- Prefer vendored/pinned production assets over runtime third-party CDNs for institutional/offline builds.
- Hash local sources in-browser for provenance.
- Treat DBC/DBF/DEF/CNV/TAB as untrusted input.
- Parsers need bounds checks and actionable diagnostics.
- Large-file operations must be cancellable.
- Persistent caching must be visible to the user and clearable.
- Exported recipes should not contain raw record data.
- Content Security Policy and dependency integrity become release gates before public institutional deployment.

## Threats to test

- malicious/corrupt DBC causing decompressor exhaustion;
- huge declared DBF record counts;
- malformed fixed-column CNV;
- formula injection in CSV/XLSX exports;
- HTML/script content in labels;
- zip-bomb-like imported bundles;
- memory exhaustion from materializing JS objects;
- accidental network requests during local analysis;
- mutable remote definitions changing a supposedly reproducible result.
