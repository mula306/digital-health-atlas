# Digital Health Atlas

Digital Health Atlas is a portfolio and governance platform for digital health initiatives.

## Business Functions

### Portfolio planning and delivery tracking

- Manage strategic goals in a hierarchy.
- Link projects to goals and track status over time.
- Track project execution with tasks, priorities, timelines, and progress.
- Capture and version status reports for leadership review.

### Intake and governance workflow

- Collect new requests through configurable intake forms.
- Route submissions through governance boards and review stages.
- Capture voting, decisions, decision rationale, and review outcomes.
- Support board policies such as quorum and voting windows.

### Organization and access management

- Support multi-organization ownership and cross-organization sharing.
- Assign users to organizations and role-based permissions.
- Manage governance membership, board participation, and admin controls.

### Reporting and auditability

- Provide dashboards and operational views across delivery and governance.
- Preserve history for key changes and governance decisions.
- Track audit events for administrative and workflow actions.

## Technology Overview

### Frontend

- React 19 + Vite
- MSAL (`@azure/msal-browser`, `@azure/msal-react`) for Azure AD / Entra sign-in
- CSS-based component styling with route-level feature pages

### Backend

- Node.js + Express API (`server/`)
- SQL Server via `mssql`
- JWT validation with Azure AD / Entra keys (`passport-jwt`, `jwks-rsa`)
- Security middleware (`helmet`, `cors`, `express-rate-limit`, `compression`)

### Data and schema

- SQL Server database bootstrapped from `server/scripts/schema.sql`
- Upgrade path for older databases via migration scripts
- Optional faker-based sample data seeding for local/dev environments

### Repo structure

- `src/`: frontend app
- `server/`: backend API
- `server/scripts/`: schema, migrations, setup and seed scripts
- `docker-compose.sqlserver.yml`: local SQL Server container definition

## Setup and Run

### Prerequisites

- Node.js 18+
- Docker Desktop (with `docker compose`)
- Azure AD / Entra app registration for API + SPA

### New Machine Setup (Recommended)

### 1. Clone and install dependencies

```bash
git clone <repo-url>
cd digital-health-atlas
npm install
cd server && npm install && cd ..
```

### 2. Create environment files

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

Minimum required values:

- `server/.env`: `DB_USER`, `DB_PASSWORD`, `DB_SERVER`, `DB_PORT`, `DB_NAME`, `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`
- `.env`: `VITE_AZURE_CLIENT_ID`, `VITE_AZURE_TENANT_ID`, `VITE_AZURE_API_SCOPE`

### 3. Start SQL Server in Docker

Set a strong SA password (must satisfy SQL Server complexity rules), then start the container.

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

Update `server/.env` so `DB_PASSWORD` matches `MSSQL_SA_PASSWORD`.

### 4. Create the database (fresh install)

```bash
cd server
npm run setup-db
```

`setup-db` does all of the following:

- Waits for SQL Server readiness with retries
- Creates the database if missing
- Applies canonical `schema.sql`

This command is idempotent and safe to re-run.

### 5. Upgrade an older existing database (if needed)

Use this only when upgrading an existing database created from older versions:

```bash
cd server
npm run upgrade-db
```

### 6. Seed fake data (optional)

After database setup, populate sample data with Faker:

```bash
cd server
npm run seed:faker
```

Optional volume controls:

- `FAKER_PROJECTS` (default `40`)
- `FAKER_TASKS_MIN` / `FAKER_TASKS_MAX`
- `FAKER_REPORTS_MIN` / `FAKER_REPORTS_MAX`
- `FAKER_TAGS_MIN` / `FAKER_TAGS_MAX`

For stress testing only:

```bash
npm run seed:performance
```

### 7. Run the app

Terminal 1:

```bash
cd server
npm run dev
```

Terminal 2:

```bash
npm run dev
```

Frontend runs on `https://localhost:5173` and proxies `/api` to backend `http://localhost:3001`.

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

## Helpful Backend Commands

```bash
cd server
npm run setup-db
npm run upgrade-db
npm run setup-db:with-faker
npm run seed:faker
npm run migrate:governance:phase3
npm run migrate:multi-org
npm run migrate:org-sharing-v2
npm run migrate:project-goals
```
