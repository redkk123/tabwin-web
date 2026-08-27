# SELF HANDOFF — ChatGPT Supervisor

**Project:** TabWin Web
**Checkpoint date:** 2026-08-26
**State label:** R01.2 VM Bootstrap / Gemini-supervised development

## Read first

1. `CHECKPOINT_MASTER.md` — canonical external memory.
2. `PROJECT_STATE.json` — compact machine-readable state.
3. `docs/testing/G001_CAPTURE_PROTOCOL.md` — first real equivalence proof.
4. `docs/legacy/DEF_SPEC_R01.md` — reconstructed DEF behavior.
5. `docs/architecture/` — frozen architectural decisions.
6. `GEMINI_HANDOFF.md` — worker contract for Gemini.

## What this project is

A modern, local-first, open-source web reimplementation of important DATASUS TabWin 4.15 analytical workflows. The goal is not to emulate the old UI pixel-for-pixel and not to wrap the Windows executable. The durable goal is behaviorally compatible analysis with explicit evidence.

Core architecture:

`legacy inputs -> parsers/models -> AnalysisSpec -> QueryPlan -> reference executor -> result/provenance`

DuckDB/WASM may later optimize execution but must never define compatibility semantics.

## Working code baseline

Immediately before this handoff, `npm test` was executed successfully:

- 22/22 tests passed;
- 0 failures;
- TypeScript build succeeded.

Implemented/tested areas include legacy CNV parsing/matching, overlap precedence, numeric ranges, subtotals and `#` metadata, explicit refusal to guess new-format `N` CNV offsets, deterministic row×column tabulation, filters, sums, zero-row suppression, recipes/manifests, DEF start-position semantics, DEF grouped frequency `G`, DEF bridge, strict golden comparator, documented DEF axes/increments/DBF-lookup metadata, and explicit preservation of unknown `X` semantics.

## What remains unproven

The project does **not** yet have its first real end-to-end golden equivalence against TabWin 4.15. The next milestone is G001 using a real SIH DBC, real `RD2008.DEF`, required CNVs, one exact recipe and a zero-tolerance matrix comparison.

Do not use the phrase “TabWin-compatible” broadly until evidence exists feature-by-feature.

## Current infrastructure decision

Development moved to a Google Compute Engine VM in São Paulo:

- Ubuntu 26.04 LTS Minimal;
- `e2-standard-2`;
- 2 vCPU / 8 GB;
- 100 GB balanced persistent disk;
- browser SSH/IAP;
- no service account attached;
- display device enabled;
- vTPM/integrity monitoring enabled;
- Secure Boot off;
- no public HTTP/HTTPS firewall requirement.

The original TabWin 4.15 remains on the user's local Windows PC and is the reference/oracle system for golden captures.

## Current operational state of VM

Ubuntu update/upgrade completed and the VM was rebooted into kernel `7.0.0-1010-gcp`.

`sudo whoami` returned `root` after reconnect.

A later apt invocation showed an interrupted dpkg state. Continuation command:

```bash
sudo dpkg --configure -a
sudo apt --fix-broken install -y
sudo apt install -y git curl wget unzip build-essential ca-certificates gnupg
```

Then install Node 22 and Gemini CLI.

## AI model situation

Claude Sonnet 5 and Opus 5 calls through Google Cloud were technically configured correctly but returned 429 because the project's global Anthropic request/token quotas were zero. The quota console confirmed zero values. Google support rejected the immediate quota increase because the project/billing account is new and advised waiting roughly 48 hours / billing history.

Marketplace activation also warned that Google promotional credits often do not apply to Marketplace purchases. Therefore do not assume Claude/Grok partner MaaS is funded by the promotional balance.

Current plan: **Gemini via Google Cloud + VM, supervised by ChatGPT.**

A Kimi-K3 self-host notebook was inspected and rejected for routine development because it targets two `a4-highgpu-8g` nodes (16 B200 GPUs total). This is not economical for the project.

## Supervisor role

ChatGPT should:

- guard architecture and semantic compatibility;
- review Gemini diffs instead of duplicating mechanical coding;
- insist on evidence for legacy behavior;
- reject silent guesses;
- keep `CHECKPOINT_MASTER.md` current;
- protect golden expected outputs from “test fixing”;
- keep the project portable across models/tools;
- prefer bounded tasks and review loops.

## Preferred loop

1. User/Gemini works on a bounded task on the VM.
2. Gemini runs tests and produces a branch/diff plus `GEMINI_REVIEW_PACKET.md`.
3. User asks ChatGPT to review.
4. ChatGPT reviews changed files, tests, evidence and checkpoint impact.
5. ChatGPT returns APPROVE or CHANGES REQUESTED with exact reasons.
6. Gemini applies only the requested changes.
7. Repeat until accepted.

GitHub should become the durable interchange layer once connected.

## Immediate next engineering target

R01.2:

1. materialize real SIH DBC fixture;
2. materialize real `RD2008.DEF` and required CNVs;
3. connect DBC records to reference executor;
4. run Web result;
5. capture exact Windows TabWin 4.15 result on local PC;
6. compare with zero tolerance;
7. classify mismatch source;
8. resolve without inventing behavior;
9. record evidence and update compatibility matrix/checkpoint.

## Non-negotiable rules

- local-first is architectural;
- cloud credits are acceleration capital, not architecture;
- no essential feature may depend on temporary credits;
- no direct main-branch autonomous agent writes;
- no semantic claim without documentation or golden evidence;
- do not redistribute original TabWin binaries/assets until licensing is established;
- Codex usage remains contingency-only and should be preserved.

If context is lost, treat `CHECKPOINT_MASTER.md` as the canonical source of truth and this file only as the short supervisor entry point.
