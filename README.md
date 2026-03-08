# Digital Health Atlas

Digital Health Atlas is an intake, governance, and portfolio execution platform for digital health initiatives.

## Business Capabilities

### 1. Strategy to execution portfolio management

- Hierarchical goals (organization, division, department, branch) with KPI tracking.
- Projects linked to one or more goals, with hierarchy-aware filtering.
- Project workspace with card and table list modes, watchlist support, and detailed delivery board views.
- Task tracking with assignees, priorities, blockers, and checklist items.
- Benefits realization tracking tied to project outcomes and governance context.

### 2. Guided intake and governance workflow

- Guided 4-step intake flow: `Submission -> Triage -> Governance -> Resolution`.
- Stage readiness/completion badges with stage-level KPI cards.
- Governance routing with structured reason templates (apply/skip governance) and validation.
- Governance queue with server-backed pagination, board/status/decision filters, `My pending votes`, and `Needs chair decision`.
- Voting and decision UX gated by true review state (eligible voter checks, deadline checks, quorum/chair rules, clear blocker text).
- Intake-to-execution conversion blueprints that create kickoff tasks and preserve governance context on project creation.

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
- Project and goal sharing across organizations.
- Sharing request workflow with expiry dates, owner attestation, approve/reject/revoke actions.
- Expiry-aware shared access enforcement for project and goal access.

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
- Fresh installs use canonical schema and do not require wave migrations
- Upgrade path for legacy databases via ordered manifest migrations
- Included feature tables cover governance phases, multi-org sharing, project watchlist, task tracking, wave2, and wave3 additions

### Quality baseline

- Frontend linting: `npm run lint`
- API contract tests: `cd server && npm run test:contracts`
- RBAC catalog lint/check: `cd server && npm run lint:rbac`

### Repository structure

- `src/`: React frontend
- `server/`: Express API
- `server/scripts/`: schema, migrations, setup and seed scripts
- `server/tests/contracts/`: backend contract/schema tests
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
- seeds default RBAC role-permission entries

This command is idempotent and safe to re-run.

### 5. Upgrade existing older database (only if needed)

```bash
cd server
npm run upgrade-db
```

`upgrade-db` applies the ordered migration manifest, including governance phases, multi-org, watchlist/task-tracking, wave2, and wave3 scripts.

### 6. Optional fake data seed

```bash
cd server
npm run seed:faker
```

Optional controls:

- `FAKER_PROJECTS` (default `40`)
- `FAKER_TASKS_MIN`, `FAKER_TASKS_MAX`
- `FAKER_REPORTS_MIN`, `FAKER_REPORTS_MAX`
- `FAKER_TAGS_MIN`, `FAKER_TAGS_MAX`

Performance seed:

```bash
npm run seed:performance
```

### 7. Run the application

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

## Common Commands

### Root

```bash
npm run dev
npm run build
npm run lint
npm run db:up
npm run db:down
```

### Server

```bash
cd server
npm run setup-db
npm run setup-db:full
npm run upgrade-db
npm run migrate:all
npm run seed:permissions
npm run seed:faker
npm run setup-db:with-faker
npm run test:contracts
npm run lint:rbac
```

Wave/feature migration entry points (for targeted rollout only):

```bash
npm run migrate:governance:phase0
npm run migrate:governance:phase1
npm run migrate:governance:phase2
npm run migrate:governance:phase3
npm run migrate:multi-org
npm run migrate:org-sharing-v2
npm run migrate:project-goals
npm run migrate:project-watchlist
npm run migrate:task-tracking:phase1
npm run migrate:wave2
npm run migrate:wave3
```

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
