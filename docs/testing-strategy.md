# Testing Strategy

This repository uses a layered test pyramid:

- Backend contract tests (`server/tests/contracts`)
- Backend integration tests (`server/tests/integration`)
- Backend security tests (`server/tests/security`)
- Backend unit tests (`server/tests/unit`)
- Frontend unit/integration tests (`src/tests`)
- End-to-end smoke/critical tests (`e2e`)

## Deterministic Test Auth

- Backend mock auth: `TEST_AUTH_MODE=mock`
- Frontend mock auth: `VITE_TEST_AUTH_MODE=mock`
- Persona header: `x-test-user`
- Shared persona catalog: `server/utils/testAuthPersonas.js`

## Deterministic Test Data

- Database setup always starts from canonical `server/scripts/schema.sql`
- Test fixtures script: `server/scripts/seed_test_fixtures.js`
- Core fixture IDs and seeded records: `server/tests/fixtures/seed_test_dataset.js`

## Commands

- Backend phase A: `npm --prefix server run test:phase-a`
- Backend phase B: `npm --prefix server run test:phase-b`
- Backend full: `npm --prefix server run test:all`
- Frontend: `npm run test:ui`
- Frontend coverage: `npm run test:ui:coverage`
- Frontend quarantine: `npm run test:ui:quarantine`
- E2E smoke: `npm run test:e2e:smoke`
- E2E critical: `npm run test:e2e:critical`
- E2E quarantine: `npm run test:e2e:quarantine`

## CI Gate Phases

- Phase A (blocking): lint + backend contracts/integration + smoke e2e
- Phase B (advisory by default): backend security/unit + frontend unit/integration
- Phase C (advisory by default): frontend coverage thresholds + critical e2e

Promote advisory phases to blocking with repository variables:

- `ENFORCE_PHASE_B=true`
- `ENFORCE_PHASE_C=true`

## Phase C Standards

- Frontend coverage thresholds are enforced in `vitest.config.js`
- Initial minimums: `40%` lines, `35%` statements, `25%` functions, `30%` branches
- Raise these thresholds as new suites land so the gate ratchets upward over time
- Root Phase C command: `npm run test:phase-c`

## Flaky-Test Quarantine

- Quarantined frontend tests use file names ending in `.quarantined.test.jsx` or `.quarantined.test.js`
- Quarantined Playwright tests should include `@quarantined` in the test title
- Default CI/blocking runs exclude quarantined tests
- Quarantined suites run separately with:
  - `npm run test:ui:quarantine`
  - `npm run test:e2e:quarantine`
