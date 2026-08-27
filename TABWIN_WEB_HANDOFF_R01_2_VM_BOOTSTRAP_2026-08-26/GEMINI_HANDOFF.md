# GEMINI HANDOFF — TabWin Web Engineering Worker

You are an implementation worker joining an existing project. You are **not** the authority on legacy TabWin semantics.

## Mission

Help implement and validate **TabWin Web**, a modern local-first open-source web implementation of important DATASUS TabWin 4.15 analytical behavior.

Your immediate milestone is **R01.2: real-data pipeline toward the first exact golden test (G001)**.

## Mandatory reading order

Before editing any code, read:

1. `HANDOFF_README.md`
2. `CHECKPOINT_MASTER.md`
3. `PROJECT_STATE.json`
4. `docs/testing/G001_CAPTURE_PROTOCOL.md`
5. `docs/testing/GOLDEN_TEST_STRATEGY.md`
6. `docs/legacy/DEF_SPEC_R01.md`
7. `docs/architecture/ADR-0001-local-first.md`
8. `docs/architecture/ADR-0002-compatibility-query-plan.md`
9. `docs/architecture/ADR-0003-cnv-compatibility.md`
10. `docs/architecture/ADR-0004-def-is-executable-metadata.md`

Then inspect the relevant source/tests for the assigned task.

## Baseline you must preserve

Before making changes, run:

```bash
npm test
```

Expected handoff baseline:

- 22 tests;
- 22 passing;
- 0 failing;
- TypeScript build succeeds.

If the baseline does not match, **stop and report the discrepancy before editing**.

## Semantic safety rules

For every material claim, mentally classify it as one of:

- `[DOCUMENTED]` supported by preserved documentation/manual/history;
- `[TESTED]` supported by automated or golden evidence;
- `[INFERENCE]` plausible but not proven;
- `[UNKNOWN]` insufficient evidence.

Rules:

1. **Never invent undocumented TabWin semantics.**
2. If behavior is unknown, preserve/parse it when possible and mark it unsupported rather than guessing.
3. Never alter a golden expected result merely to make a test pass.
4. Existing tests are contracts unless concrete evidence demonstrates that the test itself is wrong.
5. Do not collapse the architecture into ad-hoc SQL or DuckDB behavior. Preserve `AnalysisSpec -> QueryPlan -> Executor` separation.
6. Local-first processing is an architectural requirement.
7. Do not introduce mandatory cloud services into the user execution path.
8. Do not redistribute original TabWin executable/assets unless license status is resolved.
9. Keep changes bounded to the assigned task.
10. Prefer the smallest evidence-backed patch.

## Git safety rules

- Never push directly to `main`/protected branches.
- Work in a dedicated branch.
- Do not force-push shared history.
- Do not delete tests/fixtures to make CI green.
- Do not commit credentials, API keys, GCP tokens, SSH keys or user secrets.
- Show the diff before proposing merge.

## Current infrastructure context

Development workstation:

- Google Compute Engine;
- Ubuntu 26.04 LTS Minimal;
- 2 vCPU / 8 GB RAM;
- 100 GB balanced disk;
- São Paulo region;
- no VM service account attached.

The original TabWin 4.15 oracle runs on the user's **local Windows PC**, not this Ubuntu VM.

Therefore, do not claim you executed the original TabWin unless the user supplied a capture/result from that Windows machine.

## Immediate task sequence for R01.2

Do not jump straight to UI polish.

Preferred sequence:

1. inspect current format/core APIs and tests;
2. identify the minimum DBC ingestion boundary required by G001;
3. integrate a real SIH DBC fixture without coupling DBC decoding to semantic tabulation logic;
4. materialize/parse real `RD2008.DEF` and referenced CNVs;
5. compile the selected real dimensions/measure/filter into the existing `AnalysisSpec/QueryPlan` pipeline;
6. execute the Web/reference engine result;
7. serialize the result deterministically for comparison;
8. wait for/capture the Windows TabWin 4.15 reference result;
9. compare with exact labels/order/shape/cells and zero numeric tolerance;
10. classify discrepancies by ingest/DEF/CNV/filter/measure/order/nonclassified/export/unknown;
11. fix only evidence-backed causes;
12. update checkpoint and compatibility status.

## What NOT to do

- Do not redesign the UI as the first task.
- Do not rewrite the engine wholesale.
- Do not add Kubernetes/GKE/backend infrastructure.
- Do not assume DuckDB semantics equal TabWin semantics.
- Do not interpret new-format CNV `N` offsets by guess.
- Do not invent DEF `X` semantics.
- Do not use Wine output as authoritative TabWin 4.15 evidence unless separately validated.

## Required end-of-task output

At the end of every bounded task, create or update `GEMINI_REVIEW_PACKET.md` with this exact structure:

```markdown
# Gemini Review Packet

## Task
<what was requested>

## Result
<short outcome>

## Files changed
- ...

## Tests before
- command:
- result:

## Tests after
- command:
- result:

## Evidence used
- [DOCUMENTED] ...
- [TESTED] ...
- [INFERENCE] ...
- [UNKNOWN] ...

## Compatibility impact
<none / candidate / proven by golden test>

## Open questions / uncertainties
1. ...

## Risks
- ...

## Suggested next action
...
```

Also provide:

```bash
git status --short
git diff --stat
git diff
```

Do **not** declare the task merged or compatible. Stop for supervisor review.

## Supervisor

ChatGPT in the user's main conversation is the current semantic/architectural supervisor. The user will pass your diff/review packet to ChatGPT or expose the GitHub branch/PR for review.

Treat `CHECKPOINT_MASTER.md` as the durable external memory shared across agents.

## VM state update

At handoff time the Ubuntu VM is online and reachable by SSH. Gemini CLI is installed and reports version 0.57.0. An optional npm self-upgrade failed with EACCES because npm is system-installed under /usr/lib/node_modules. Ignore that failure; DO NOT spend time upgrading npm unless the project itself requires it. Do not use sudo to mutate project files.

First commands after extracting this handoff:

```bash
cd <repo-root>
node -v
npm -v
gemini --version
npm test
```

Record the exact outputs in CHECKPOINT_MASTER.md before making compatibility-sensitive changes.
