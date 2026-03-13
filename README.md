# Digital Health Atlas

Digital Health Atlas is an intake, governance, and portfolio execution platform for digital health initiatives.

## Business Capabilities

### 1. Strategy to execution portfolio management

- Hierarchical goals (`Enterprise -> Portfolio -> Service -> Team`) with KPI tracking.
- Projects linked to one or more goals, with hierarchy-aware filtering.
- Project workspace with card and table list modes, watchlist support, and detailed delivery board views.
- Task tracking with assignees, priorities, blockers, and checklist items.
- Benefits realization tracking tied to project outcomes and governance context.

### 2. Guided intake and governance workflow

- Guided 4-step intake flow: `Submission -> Triage -> Governance -> Resolution`.
- Stage readiness/completion badges with stage-level KPI cards.
- Intake forms normalize to three required system fields on every form:
  - `Your Name` (auto-populated from the logged-in requester)
  - `Project Name` (authoritative source for project title during conversion)
  - `Description` (authoritative source for converted project description)
- Governance routing with structured reason templates (apply/skip governance) and validation.
- Governance queue with server-backed pagination, board/status/decision filters, `My pending votes`, and `Needs chair decision`.
- Voting and decision UX gated by true review state (eligible voter checks, deadline checks, quorum/chair rules, clear blocker text).
- Server-side intake-to-execution conversion that creates kickoff tasks, preserves governance context, and assigns converted project ownership to the submission organization.

### 3. Governance administration and operations

- Admin Governance uses a guided 4-step config process: `Settings -> Boards -> Members -> Criteria`.
- Completion checks and "ready/not ready" indicators across governance setup.
- Unsaved-change protection when switching board/version tabs.
- Board-level governance policy overrides (quorum percent/min count, quorum requirement, vote window).
- Board-level capacity settings (weekly capacity hours, WIP limit, default submission effort).
- Criteria versioning with draft/publish flow and weight validation.
- Governance Session Mode for meeting operations (agenda creation, live tracker, session start/close).
- Capacity-aware governance scenario indicators in queue views.

### 4. Executive reporting and risk visibility

- Executive Summary table grouped by hierarchy and enhanced filtering.
- Predictive risk signal surfaced per project with sortable risk columns and filter controls.
- Executive Pack management:
  - Manual or scheduled runs.
  - Exception-only mode.
  - Goal/tag/status/watchlist filters.
  - Optional organization scope.
  - Run history and scheduler status.
- Report preview and export/print workflows for executive communication.

### 5. Multi-organization collaboration and sharing governance

- Organization administration aligned to a step-based workflow (`Organizations`, `Members`, `Sharing`).
- Org-centric ownership for goals, projects, intake forms, intake submissions, and governance boards.
- Project and goal sharing across organizations with recipient-org focused admin UX.
- Sharing request workflow with expiry dates, owner attestation, approve/reject/revoke actions.
- Expiry-aware shared access enforcement for project and goal access.
- Admin ownership transfer for projects without changing the underlying sharing model.

### 6. Personal productivity (My Work Hub)

- Single "My Work" inbox for:
  - Watched projects.
  - Assigned open tasks.
  - My intake requests.
  - My pending governance votes.
- Deep-link navigation from My Work cards directly into target project/intake/governance items.

### 7. Access control and onboarding

- Entra ID login with automatic user provisioning on first sign-in.
- Role claims synced to local user profile at login.
- Central RBAC catalog used by backend and admin UI to keep visibility and authorization aligned.
- Seeded roles:
  - `Viewer`
  - `Editor`
  - `IntakeManager`
  - `IntakeSubmit`
  - `ExecView`
  - `GovernanceMember`
  - `GovernanceChair`
  - `GovernanceAdmin`

## Technology Overview

### Frontend

- React 19 + Vite
- MSAL (`@azure/msal-browser`, `@azure/msal-react`) for Entra authentication
- Route/state persistence via URL query params and local storage
- Shared UI patterns (`FilterBar`, modal workflows, responsive layouts)
- Saskatchewan-aligned theme tokens with light/dark mode support

### Backend

- Node.js + Express (`server/`)
- SQL Server via `mssql`
- JWT auth via `passport-jwt` + `jwks-rsa` against Entra tenant keys
- Security middleware: `helmet`, `cors`, `express-rate-limit`, `compression`
- Built-in executive pack scheduler loop

### Data model and schema

- Canonical schema: `server/scripts/schema.sql`
- Fresh installs use canonical schema only; migration scripts are not required
- Included feature tables cover the goal cascade taxonomy rename, org-centric ownership, server-side intake conversion, governance phases, multi-org sharing, project watchlist, task tracking, and later wave additions
- `IntakeForms.fields` is a JSON contract, not a separate relational table. It now carries optional `systemKey` and `locked` metadata for required system fields.
- `Projects.goalId` remains for backwards compatibility, while `ProjectGoals` is the canonical multi-goal association table used by modern project and conversion flows.

### Ownership and sharing model

- Each goal, project, intake form, intake submission, and governance board has one home organization.
- Non-admin created goals/projects/forms inherit the creator's org; admin-created org-bound records require an explicit `orgId`.
- Converted intake projects inherit the submission org, not the converter's org.
- Project visibility follows `Projects.orgId` plus `ProjectOrgAccess`.
- Goal and KPI visibility follows `Goals.orgId` plus `GoalOrgAccess`.
- Sharing a project may auto-share linked goals as read-only context when needed.
- Sharing a goal does not implicitly share linked projects.
- Existing upgraded databases with legacy null ownership can be audited and backfilled with:
  - `cd server && npm run backfill:org-ownership`
  - `cd server && npm run backfill:org-ownership:apply`

### Quality baseline

- Frontend linting: `npm run lint`
- Backend contracts/integration/security/unit suites:
  - `cd server && npm run test:phase-a`
  - `cd server && npm run test:phase-b`
  - `cd server && npm run test:all`
- Frontend unit/integration suites: `npm run test:ui`
- Frontend coverage gate: `npm run test:ui:coverage`
- Playwright smoke/critical suites:
  - `npm run test:e2e:smoke`
  - `npm run test:e2e:critical`
  - `npm run test:e2e:quarantine`
- RBAC catalog lint/check: `cd server && npm run lint:rbac`

### Lint tooling note

- The repository currently uses `eslint 10` with `@eslint/js 10`.
- As of `March 13, 2026`, the stable `eslint-plugin-react-hooks` line does not yet publish an `eslint 10` peer range, so this repo temporarily pins `eslint-plugin-react-hooks` to `7.1.0-canary-c80a0750-20260312`.
- This is a lint-only dependency tradeoff; it does not affect runtime behavior or production builds.
- `eslint-plugin-react` is intentionally not used in the current ruleset. The project relies on the automatic JSX runtime plus `react-hooks`, `react-refresh`, and `unused-imports` checks instead.
- When a stable `eslint-plugin-react-hooks` release supports `eslint 10`, replace the canary and validate with `npm run lint` and `npm run test:phase-c`.

### Repository structure

- `src/`: React frontend
- `server/`: Express API
- `server/scripts/`: schema, setup and seed scripts
- `server/tests/`: backend unit, integration, security, and contract tests
- `src/tests/`: frontend unit and integration tests
- `e2e/`: Playwright smoke and critical tests
- `docker-compose.sqlserver.yml`: local SQL Server container

## Setup

### Prerequisites

- Node.js 18+
- Docker Desktop (`docker compose`)
- Entra app registrations for SPA and API

### 1. Install dependencies

```bash
git clone <repo-url>
cd digital-health-atlas
npm install
cd server && npm install && cd ..
```

### 2. Configure environment files

PowerShell:

```powershell
Copy-Item .env.example .env
Copy-Item server/.env.example server/.env
```

Bash:

```bash
cp .env.example .env
cp server/.env.example server/.env
```

Required values:

- `server/.env`: `DB_USER`, `DB_PASSWORD`, `DB_SERVER`, `DB_PORT`, `DB_NAME`, `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`
- `.env`: `VITE_AZURE_CLIENT_ID`, `VITE_AZURE_TENANT_ID`, `VITE_AZURE_API_SCOPE`

Notes:

- Normal application startup uses Entra ID by default on both frontend and backend.
- Leave all `*_TEST_AUTH_MODE` settings commented out unless you intentionally want local mock auth for deterministic testing.
- `npm run setup-db` and `npm run setup-db:full` read `DB_*` values on every invocation.
- Locally, the expected source is `server/.env` unless you deliberately override with shell environment variables.
- If Docker SQL is recreated with a different `MSSQL_SA_PASSWORD`, update `server/.env` `DB_PASSWORD` to match before rerunning setup.

Test-only values (optional):

- `.env`: uncomment `VITE_TEST_AUTH_MODE=mock` and `VITE_TEST_USER=admin`
- `server/.env`: uncomment `TEST_AUTH_MODE=mock`
- Restart the frontend and backend dev servers after switching auth modes.

### 3. Start SQL Server container

PowerShell:

```powershell
$env:MSSQL_SA_PASSWORD='YourStrongPassword123!'
docker compose -f docker-compose.sqlserver.yml up -d
```

Bash:

```bash
export MSSQL_SA_PASSWORD='YourStrongPassword123!'
docker compose -f docker-compose.sqlserver.yml up -d
```

Set `server/.env` `DB_PASSWORD` to match `MSSQL_SA_PASSWORD`.

### 4. Initialize database (fresh install)

```bash
cd server
npm run setup-db:full
```

`setup-db:full`:

- waits for SQL readiness
- creates database if missing
- applies canonical `schema.sql`
- converts legacy goal type values in-place (org/div/dept/branch -> enterprise/portfolio/service/team) when rerun against an existing database
- seeds default RBAC role-permission entries

Operational note:

- The setup scripts are stateless and start a fresh Node process each run, so they re-read `server/.env` each time by design.
- That is expected behavior, not a one-time bootstrap cache.
- If this is an upgraded environment with older null `orgId` ownership data, run the backfill script after setup so the app can enforce org-scoped workflows consistently:
  - `cd server && npm run backfill:org-ownership`
  - review the generated report
  - `cd server && npm run backfill:org-ownership:apply` when you are comfortable applying the unambiguous fixes

This command is idempotent and safe to re-run.

### 5. Optional fake data seed

```bash
cd server
npm run seed:faker
```

Faker seed notes:

- ensures at least two active organizations exist
- creates a distinct `Enterprise -> Portfolio -> Service -> Team` goal cascade per org
- associates seeded projects to the org that owns the linked goal
- avoids assigning seeded projects to the top `Enterprise` level

Optional controls:

- `FAKER_PROJECTS` (default `40`)
- `FAKER_TASKS_MIN`, `FAKER_TASKS_MAX`
- `FAKER_REPORTS_MIN`, `FAKER_REPORTS_MAX`
- `FAKER_TAGS_MIN`, `FAKER_TAGS_MAX`

Performance seed:

```bash
npm run seed:performance
```

### 6. Run the application

Terminal 1:

```bash
cd server
npm run dev
```

Terminal 2:

```bash
npm run dev
```

URLs:

- Frontend: `https://localhost:5173`
- Backend API: `http://localhost:3001`

Auth mode note:

- `npm run dev` and `cd server && npm run dev` expect Entra ID configuration and do not enable mock auth by default.
- Mock auth is only used when you explicitly uncomment the env settings above or run test-specific scripts such as `cd server && npm run dev:test`.

## Common Commands

### Root

```bash
npm run dev
npm run build
npm run lint
npm run test:ui
npm run test:ui:coverage
npm run test:ui:quarantine
npm run test:e2e:smoke
npm run test:e2e:critical
npm run test:e2e:quarantine
npm run test:phase-a
npm run test:phase-b
npm run test:phase-c
npm run db:up
npm run db:down
```

### Server

```bash
cd server
npm run setup-db
npm run setup-db:full
npm run backfill:org-ownership
npm run backfill:org-ownership:apply
npm run seed:permissions
npm run seed:test-fixtures
npm run seed:faker
npm run setup-db:with-faker
npm run test:phase-a
npm run test:phase-b
npm run test:contracts
npm run test:integration
npm run test:security
npm run test:unit
npm run test:all
npm run lint:rbac
```

## Test Auth Contract

When `TEST_AUTH_MODE=mock` (backend) and `VITE_TEST_AUTH_MODE=mock` (frontend):

- API requests use `x-test-user` personas for deterministic auth.
- Supported personas:
  - `admin`
  - `viewer`
  - `editor`
  - `intake_manager`
  - `governance_member`
  - `governance_chair`
  - `org2_editor`
- Mock mode is blocked in production.
- Automated Playwright and CI runs intentionally force mock auth so test personas stay deterministic; that does not change the default runtime setup for local development.

## CI Gate Phases

GitHub Actions workflow: `.github/workflows/ci.yml`
Detailed test architecture and runbook: `docs/testing-strategy.md`

- Phase A (blocking): lint + backend contracts/integration + Playwright smoke.
- Phase B (advisory by default): frontend tests + backend security/unit.
  - Set repository variable `ENFORCE_PHASE_B=true` to make Phase B blocking.
- Phase C (advisory by default): Playwright critical.
  - Frontend coverage thresholds are enforced during Phase C.
  - Initial frontend thresholds: `40%` lines, `35%` statements, `25%` functions, `30%` branches.
  - Set repository variable `ENFORCE_PHASE_C=true` to make Phase C blocking.

## Quarantine Policy

- Frontend flaky tests should use a `.quarantined.test.jsx` or `.quarantined.test.js` suffix.
- Playwright flaky tests should include `@quarantined` in the test title.
- Blocking runs exclude quarantined tests by default.
- Run quarantined suites separately with:
  - `npm run test:ui:quarantine`
  - `npm run test:e2e:quarantine`

## SQL Server Container Management

Start:

```bash
docker compose -f docker-compose.sqlserver.yml up -d
```

Stop:

```bash
docker compose -f docker-compose.sqlserver.yml down
```

Stop and remove DB volume (destructive):

```bash
docker compose -f docker-compose.sqlserver.yml down -v
```
