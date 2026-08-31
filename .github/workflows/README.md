# Continuous integration

The root workflow runs the complete release gate on every push and pull request.

Current gate:

1. Node 22 and deterministic `npm ci` installation;
2. semantic tests, including DEF/CNV and committed golden comparisons;
3. web typecheck and production Vite build;
4. Cloudflare Worker configuration and bundle dry-run.
5. Playwright Chromium installation and the complete browser E2E suite.

Planned later gates include dedicated accessibility regression, dependency and
license reporting, performance budgets and broader cross-browser coverage.
