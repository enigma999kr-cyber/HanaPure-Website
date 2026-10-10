# Storefront browser regression foundation

Requires the repository's Node 24 runtime. Install dependencies with the project's
normal authorized workflow, then install the single test browser:

```powershell
npx playwright install chromium
npm run test:browser
```

`test:browser` builds current sources before starting a dedicated production Next
server on `127.0.0.1:3100`. An occupied port fails rather than reusing a stale app.
No remote provider, ERP connection, approved real product content or credentials
are required. Keep the production catalogue empty; no fixture is injected into it.

The suite exercises hydrated EN/HU/KO storefront controls at 320, 375, 768, 1024
and 1280 CSS pixels (900px height). It checks menu keyboard/focus/breakpoint state,
brand search/A-Z/recovery/links, native catalogue GET controls, locale query
preservation, empty catalogue, product 404 recovery, document-width overflow
after fonts load, and runtime/hydration errors. It does not certify WCAG, compare
pixels, cover actual published product assets, or replace existing domain tests.
Hydration readiness observes React's client-prop attachment under the current
React 19 baseline; revisit this test-only observation on a React upgrade.

One Chromium browser, one worker, zero retries, stop after the first failed test.
Failure screenshot/trace and JSON results live in ignored `.next/browser-test-*`
paths. Inspect with `npx playwright show-trace <trace.zip>`; these may contain
rendered content. Only use local non-secret test data. A later build replaces
`.next`, so preserve needed failure evidence outside it before rebuilding.

If a test reproduces a production defect, report the URL, viewport, expected vs
actual behavior and artifact paths. Do not fix production code as part of this
foundation milestone. Test-harness mistakes may be corrected without relaxing
the behavior asserted. No arbitrary sleeps, retries, mocked storefront responses,
production test flags or pixel baselines.

## Published synthetic catalogue journey

```powershell
node tests/browser/published-catalogue-server.mjs
```

This separate 375/1280px EN/HU/KO matrix production-builds an isolated tracked
application copy at `.next/published-catalogue-app` on loopback port 3101. Only
that disposable copy receives `published-catalogue-fixtures.mjs`: visibly TEST
ONLY editorial records with no commerce fields. It reuses the installed dependencies,
copies no environment files or protected documents, and passes only explicitly
allowed OS/path variables plus locally assigned test settings. The normal production catalogue stays empty and ordinary
`test:browser` continues to select only `storefront.spec.ts`.

The runner owns build/server/test ChildProcess handles and cleans its marked
directory in finally, including start/readiness/test failures. Termination requires
the original object identity, run owner and unchanged spawn executable/arguments;
no persisted PID can authorize termination. It waits for child close before deleting.
Existing directories and ownership/integrity mismatches are rejected. Abrupt OS
termination can leave an orphan directory: this tool refuses to adopt or kill
orphan processes; inspect and obtain separate authority for any recovery.
No automatic production-data restoration is needed or attempted.
Cleanup checks a per-run ownership token and the unchanged real catalogue hash.
The fixture's Webpack production
build uses Next's test-only Google font hook with existing `.next/static` font
bytes/CSS, avoiding external font requests without changing application layouts.
Run the normal build first if those offline assets are absent. This fixture
does not validate font delivery or Turbopack behavior; the ordinary app build does.
Browser evidence remains in `.next/published-browser-*`; there are no remote
images, fixture APIs, production flags, credentials or new publication semantics.
Synthetic results do not establish real LP catalogue or commerce launch readiness.
