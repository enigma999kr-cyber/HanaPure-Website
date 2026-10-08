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
