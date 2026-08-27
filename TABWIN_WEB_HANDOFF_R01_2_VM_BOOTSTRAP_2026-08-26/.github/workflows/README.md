# Continuous integration

The verification workflow runs the complete browser-independent release gate on
every push and pull request.

Current gate:

1. Node 22;
2. deterministic `npm ci` installation;
3. semantic tests, including DEF/CNV and committed G001 comparison;
4. web typecheck and production Vite build;
5. Cloudflare Worker configuration and bundle dry-run.

Planned gates before an institutional beta:

- formatting/lint;
- real DBC integration fixtures;
- G001+ golden compatibility suite;
- accessibility smoke tests;
- dependency/license/security checks;
- deterministic provenance/recipe fixtures.
