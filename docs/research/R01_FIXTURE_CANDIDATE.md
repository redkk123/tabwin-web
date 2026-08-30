# R01 ingestion fixture candidate

**Candidate:** `RDAC2401.dbc`  
**System:** SIH-RD  
**Period/geography:** Acre, 2024-01  
**Upstream repo:** `Precisa-Saude/datasus-dbc`  
**Observed GitHub size:** ~306 KB  
**Upstream test metadata:** 4,315 records; record size 702 bytes.

The upstream end-to-end test says this is a real DATASUS file downloaded from the official FTP and uses it to validate DBC → DBF → record decoding.

## Why this is a good first fixture

- very small compared with typical national/large-state DBC files;
- real SIH-RD schema;
- already has upstream decoder expectations;
- deterministic record-count sanity check;
- suitable for UI/file-ingestion benchmarks before adding DEF/CNV semantics.

## Missing for a true TabWin golden test

- matching `RD2008.DEF`;
- matching CNV dependencies;
- a simple TabWin 4.15 tabulation output + log;
- exact panel selections.

## References

- https://github.com/Precisa-Saude/datasus-dbc/tree/main/packages/dbc/test/fixtures
- https://github.com/Precisa-Saude/datasus-dbc/blob/main/packages/dbc/test/e2e.test.ts
