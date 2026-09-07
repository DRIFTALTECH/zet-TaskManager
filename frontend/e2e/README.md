# Dashboard end-to-end run

Exercises the dashboard against a **throwaway SQLite database**. It never
touches Aurora: `ZET_TEST_SQLITE=1` plus `ZET_SQLITE_PATH` are set before any
backend import, the same way `backend/tests/conftest.py` does it.

## Running

```bash
SCRATCH=/tmp/zet-e2e && mkdir -p $SCRATCH

# 1. Seed a fresh fixture. Re-run this before EVERY run — 06-mutations
#    creates and deletes real rows, so a second run against the same file
#    starts from a database the specs no longer describe.
cd backend
ZET_SQLITE_PATH=$SCRATCH/e2e.db python3 scripts/seed_e2e.py

# 2. Backend on the fixture. CORS must name the test origin: the dev default
#    allows :8080 only, and the browser blocks everything with no clue why.
ZET_TEST_SQLITE=1 ZET_SQLITE_PATH=$SCRATCH/e2e.db APP_ENV=development \
  MICROSOFT_CLIENT_ID= CORS_ORIGINS=http://127.0.0.1:8081 \
  python3 -m uvicorn main:app --port 8001 --host 127.0.0.1 &

# 3. Frontend pointed at it.
cd ../frontend
VITE_API_URL=http://127.0.0.1:8001 npx vite --port 8081 --strictPort &

# 4. Run.
npx playwright test -c playwright.e2e.config.ts
```

## Things that cost time to learn

- **Sign-in is seeded, not driven.** The login page offers Microsoft only, so
  there is no password form to fill. `global-setup.ts` logs in over the API
  once and the token is planted in `localStorage`. Once, because `/auth/login`
  is rate limited per IP — a login per test starts returning 429 around the
  sixth and every later test fails for a reason that looks like the app.
- **`hover({force:true})` is not hovering.** It dispatches at a point without
  moving the cursor, so the toolbar opens and then collapses on the next real
  click. `openToolbar` moves the pointer for real.
- **Radix portals to the end of `<body>`.** A page-wide `getByText('Urgent')`
  matches a task card's priority label long before the filter option. Use
  `pickOption`, which scopes to the open popover.
- **The run asks for reduced motion.** The collapsed search control animates
  forever, and Playwright will not act on an element that never settles. See
  the "collapsed ball holds still" test, which measures that drift on purpose
  and is expected to fail while the animation exists.
