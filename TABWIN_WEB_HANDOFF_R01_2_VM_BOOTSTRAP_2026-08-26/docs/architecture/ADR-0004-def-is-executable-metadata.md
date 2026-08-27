# ADR-0004 — Treat DEF as executable analytical metadata

Status: **Accepted — R01.1-dev**

## Context

A tempting implementation is to use DEF only to populate labels in the UI and let application code decide how values are sliced, converted and counted. That would make compatibility depend on duplicated, system-specific logic.

Historical TabWin documentation shows that DEF contains semantics, not only labels: field start positions, conversion resources, related DBF lookups, increments and grouped-frequency behavior.

## Decision

TabWin Web will treat normalized DEF as executable analytical metadata.

Specifically:

- row/column/filter specs inherit source DBF field and 1-based start position from DEF;
- conversion-file identity is attached to the generated spec;
- `I` becomes an available sum measure;
- `G` modifies frequency into a weighted count;
- related DBF lookups remain explicit unsupported nodes until implemented;
- unknown modern directives remain explicit gaps rather than being silently ignored.

## Consequences

Positive:

- fewer per-system hard-coded adapters;
- better reproducibility;
- easier generation of a compatible UI directly from official auxiliary artifacts;
- clear provenance for why a field was sliced or converted a particular way.

Negative:

- DEF archaeology becomes a core task;
- malformed community DEF files need a future import-assistant/lenient mode;
- legacy DBF lookup behavior must eventually be implemented and golden-tested.
