# TabWin Web — Cloud Credits & AI Acceleration Strategy

Date: 2026-08-26
Status: active development policy

## Principle

**Cloud credits are acceleration capital, not architecture.**

TabWin Web is intended to remain local-first. Temporary Google Cloud/Azure credits may speed development, testing, benchmarking, model-assisted coding and demos, but the application must remain viable when those credits disappear.

## Google Cloud

Preferred uses during the credit window:

- Vertex AI / Gemini for scoped coding, debugging and review;
- Cloud Run for scale-to-zero optional services and demos;
- temporary object storage for benchmarks/fixtures where redistribution permits;
- optional BigQuery benchmarks against browser/local execution;
- disposable batch/compute experiments;
- staging and observability.

Avoid by default:

- GKE/Kubernetes;
- always-on VMs;
- mandatory server-side DBC processing;
- architectural dependence on BigQuery;
- databases kept running without a measured need.

## Azure

Treat Azure as a secondary disposable laboratory:

- Windows/Linux benchmark workers;
- temporary high-memory or high-CPU runs;
- model/tool comparison;
- isolated batch processing.

Do not create a second production architecture merely because credits exist.

## AI worker policy

AI-generated changes are contributions, not specifications.

Any compatibility-affecting patch must have:

- a small explicit task;
- inspectable diff;
- automated tests;
- documentary or golden-test evidence for claimed TabWin behavior;
- no direct main-branch writes;
- checkpoint/ADR update for architectural changes.

Use inexpensive models for boilerplate, tests, documentation and mechanical refactors. Reserve stronger models for semantic archaeology, difficult mismatches and review.

## Codex reserve

Remaining Codex usage is scarce (~7%). Keep it for narrow blockers that cannot be efficiently solved otherwise and whose output can be locally verified.

## What the credits should leave behind

When credits expire, we want durable assets rather than a monthly bill:

- working local-first product;
- compatibility corpus;
- golden tests;
- benchmark reports;
- CI/CD definitions;
- reproducible recipes and provenance;
- documentation;
- optional deploy manifests that can scale to zero.

## Current priority

Do **not** optimize cloud deployment before semantic validation.

Critical path:

`real DBC -> real DEF/CNV -> web execution -> TabWin 4.15 reference -> exact comparison`.

The first strong milestone is G001 passing with evidence.
