# TabWin Web — Handoff Entry Point

**Revision:** R01.2 VM Bootstrap / Gemini-supervised development  
**Date:** 2026-08-26

This directory is a complete portable project handoff.

## Human / ChatGPT continuation

Read in this order:

1. `SELF_HANDOFF_CHATGPT.md`
2. `CHECKPOINT_MASTER.md`
3. `PROJECT_STATE.json`
4. `docs/testing/G001_CAPTURE_PROTOCOL.md`

## Gemini worker continuation

Read in this order:

1. `GEMINI_HANDOFF.md`
2. `CHECKPOINT_MASTER.md`
3. `PROJECT_STATE.json`
4. the relevant ADR/specification documents

## Verified baseline at packaging

`npm test` -> **22 passed / 0 failed**.

## Immediate operational VM state

Google Compute Engine Ubuntu VM is online in São Paulo. Ubuntu upgrade completed and rebooted. `sudo` works. If apt still reports interrupted `dpkg`, run:

```bash
sudo dpkg --configure -a
sudo apt --fix-broken install -y
```

Then install development prerequisites, Node 22 and Gemini CLI.

## Immediate engineering milestone

R01.2 -> real DBC + real `RD2008.DEF`/CNVs -> Web result -> Windows TabWin 4.15 reference -> exact G001 comparison.
