# Continuous integration

The root workflow runs the complete browser-independent release gate on every
push and pull request while the application remains in its recovered handoff
subdirectory.

Current gate:

1. Node 22 and deterministic `npm ci` installation;
2. semantic tests, including DEF/CNV and committed G001 comparison;
3. web typecheck and production Vite build;
4. Cloudflare Worker configuration and bundle dry-run.

Planned later gates include accessibility/browser regression, dependency and
license reporting, performance budgets and the expanded differential corpus.
