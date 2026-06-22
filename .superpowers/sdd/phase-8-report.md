# Phase 8 Report

Agent: Claude Sonnet 4.6 (phase-8)
Tasks completed: 8.1 – 8.3
Commit range: `c777040..85d4c30`

---

## Task 8.1 — Setup backend

**File:** `backend/src/routes/setup.ts` (mounted at `/api/setup` in `app.ts`)

Three routes implemented TDD-first:

- `GET /api/setup/status` → `{ setupRequired: boolean, configured: { starterDb, jwt, google, github, publicUrl } }`. `setupRequired` is `true` until `STARTER_MONGODB_URI` and at least one OAuth provider pair are set in `process.env`.
- `POST /api/setup/test-connection` `{ starterUri }` → `{ ok, error? }`. Uses `mongoose.createConnection` with a 5-second server-selection timeout, awaits `.asPromise()`, then closes the connection. Returns `ok: false` with a human-readable error on failure.
- `POST /api/setup/configure` `{ starterUri, google?, github?, publicUrl, allowedOrigins }` → reads/merges the `.env` file, writes it back, updates `process.env` live. Auto-generates `JWT_SECRET` (32 random bytes, hex) if absent. Guards with 403 if already configured. Requires starterUri + at least one complete OAuth provider pair.

`SETUP_ENV_FILE_PATH` env var allows tests to redirect file writes without touching the project root `.env`.

**Tests:** `backend/src/__tests__/setup.test.ts` — 14 supertest tests covering: status before/after configure, configure writes file + updates `process.env`, JWT secret auto-generation + preservation, idempotency guard (second call → 403), test-connection failure path, field validation errors. Full backend suite: **294 tests, 0 failures**.

---

## Task 8.2 — Setup wizard UI

**Files:**
- `frontend/src/pages/Setup.tsx` — replaces placeholder with full 4-step wizard
- `frontend/src/pages/Setup.css` — layout and component styles
- `frontend/src/components/setup/Stepper.tsx` + `Stepper.css` — left-rail progress indicator
- `frontend/src/components/setup/Step.tsx` + `Step.css` — consistent step panel wrapper
- `frontend/src/api/setup.ts` — typed API helpers for the three setup endpoints

**Design:**

Layout: fixed 280px left rail (brand + stepper) + scrollable right form panel. Not a centered card. The rail uses the crystal facet polygon background motif from the Login page's left panel (same `clip-path: polygon(...)` + facet gradient, reduced opacity to 0.09). Right panel is clean editorial space with DM Serif Display headings.

The stepper uses **diamond-shaped markers** (28×28 `clip-path: polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)`) instead of circles — reinforces the crystal-fragment geometry. Completed steps show a checkmark SVG inside the filled accent diamond; active steps use an accent-glow fill; upcoming steps are dim.

Steps:
1. **Starter cluster** — mono URI input + "Test connection" button that calls the backend ping. Next button is disabled until the test returns `ok: true`. Shows a ◆ confirmation banner on success.
2. **OAuth providers** — toggle checkboxes for Google and GitHub. Expanding a provider reveals its credential fields inside a border-left-accented sub-panel, plus a callout block with real guidance copy (exact console URLs, callback URI format using the entered Public URL). Next requires at least one enabled provider with both fields filled.
3. **Site config** — Public URL + Allowed origins inputs with a callout for local dev values. Next requires a valid URL.
4. **Finish** — a review table (angular `.setup-review` grid, monospaced labels) showing all values with the MongoDB password masked. "Apply configuration" calls `POST /api/setup/configure`, then shows a done state (ShardMark with `drop-shadow` glow, DM Serif heading) and redirects to `/login` after 2.4s.

**Tests:** `frontend/src/__tests__/setup.test.tsx` — 22 Vitest tests covering: 4-step navigation, test-connection gate, connection error display, provider toggle/validation, step 3 validation, configure payload, done state, timer-driven navigation, error display on failure. Frontend suite: **84 tests, 0 failures**.

---

## Task 8.3 — Branding polish

**Files:**
- `frontend/public/logo.svg` — ShardMark SVG at 48×48 (three polygon faces + edge line)
- `frontend/public/favicon.svg` — same mark on `#0D0F12` background at 32×32 for favicon context
- `frontend/index.html` — added `<meta name="description">`, `<meta name="theme-color" content="#0D0F12">`, Open Graph tags, SVG favicon `<link>`
- `README.md` — full rewrite: describes Shard's product identity, the M0 autoscaling model with thresholds, setup wizard flow, env vars table, architecture table, design section. No D-Drive references.
- `frontend/src/__tests__/branding.test.tsx` — 9 render tests verifying ShardMark presence and wordmark placement in Sidebar, Login page, and Setup wizard rail

The Sidebar, Login page, and Setup wizard all consistently use `ShardMark` + `"Shard"` in `var(--font-display)` (DM Serif Display). No additional `theme.css` changes were needed — the token system from Phase 7a was already correct and the Setup wizard uses it throughout.

---

## Test / Build Summary

| Suite | Tests | Result |
|---|---|---|
| Backend Jest | 294 | ✓ all pass |
| Frontend Vitest | 84 | ✓ all pass |
| Backend `tsc --noEmit` | — | ✓ no errors |
| Frontend `tsc --noEmit` | — | ✓ no errors |
| Frontend `vite build` | — | ✓ clean (456ms) |

---

## Blocking concerns

None. Phase 8 is complete. All three tasks are implemented, tested, and committed. The setup wizard is production-ready with real validation, real guidance copy, and a distinctive hand-designed aesthetic consistent with the Phase 7a design system.
