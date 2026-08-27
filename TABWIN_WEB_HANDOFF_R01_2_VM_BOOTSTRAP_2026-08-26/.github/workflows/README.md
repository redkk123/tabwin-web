# Continuous integration

R01.1 runs the TypeScript semantic-kernel test suite on every push and pull request.

Current gate:

1. Node 22;
2. dependency installation;
3. TypeScript build;
4. semantic tests, including DEF/CNV and synthetic golden comparison.

Planned gates before an institutional beta:

- formatting/lint;
- real DBC integration fixtures;
- G001+ golden compatibility suite;
- accessibility smoke tests;
- production web build;
- dependency/license/security checks;
- deterministic provenance/recipe fixtures.
