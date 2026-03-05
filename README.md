# Digital Health Atlas

A project portfolio management and governance platform built with React + Vite (frontend) and Express + SQL Server (backend), authenticated via Azure AD / Entra ID.

## Prerequisites

- **Node.js** 18+
- **Docker Desktop** (for SQL Server) — or a remote SQL Server instance
- **Azure AD App Registration** with an exposed API scope

## Quick Start

### 1. Clone & install

```bash
git clone <repo-url> && cd digital-health-atlas

# Frontend
npm install

# Backend
cd server && npm install && cd ..
```

### 2. Configure environment variables

Copy the example files and fill in your values:

```bash
# Frontend (project root)
cp .env.example .env

# Backend
cp server/.env.example server/.env
```

| File | Variable | Description |
|---|---|---|
| `server/.env` | `DB_USER` | SQL Server login (e.g. `sa`) |
| `server/.env` | `DB_PASSWORD` | SQL Server password |
| `server/.env` | `DB_SERVER` | Host (default `127.0.0.1`) |
| `server/.env` | `DB_NAME` | Database name (default `DHAtlas`) |
| `server/.env` | `AZURE_TENANT_ID` | Azure AD tenant ID |
| `server/.env` | `AZURE_CLIENT_ID` | Azure AD app client ID |
| `.env` | `VITE_AZURE_CLIENT_ID` | Same client ID (for frontend) |
| `.env` | `VITE_AZURE_TENANT_ID` | Same tenant ID (for frontend) |
| `.env` | `VITE_AZURE_API_SCOPE` | API scope, e.g. `api://<client-id>/access_as_user` |

### 3. Start SQL Server

```bash
docker run -e "ACCEPT_EULA=Y" \
           -e "SA_PASSWORD=YourStrongPassword123!" \
           -p 1433:1433 \
           -d mcr.microsoft.com/mssql/server:2022-latest
```

### 4. Create the database

```bash
cd server
npm run setup-db
```

This runs `schema.sql` which creates the `DHAtlas` database, all tables, indexes, constraints, and seed data. It is idempotent — safe to run multiple times.

### 5. Run the app

```bash
# Terminal 1 — API (port 3001)
cd server && npm run dev

# Terminal 2 — Frontend (https://localhost:5173)
npm run dev
```

The frontend proxy forwards `/api` requests to the backend automatically.

## Project Structure

```
├── src/                    # React frontend
│   ├── authConfig.js       # MSAL / Azure AD config
│   ├── components/         # UI components
│   └── context/            # React context providers
├── server/                 # Express API backend
│   ├── db.js               # SQL Server connection pool
│   ├── auth.js             # Passport JWT + Azure AD
│   ├── routes/             # API route handlers
│   ├── scripts/            # DB schema & migrations
│   └── utils/              # Shared utilities
├── .env.example            # Frontend env template
└── server/.env.example     # Backend env template
```

## Database Migrations

Governance features were added in phases. If upgrading an older database:

```bash
cd server
npm run migrate:governance:phase0
npm run migrate:governance:phase1
npm run migrate:governance:phase2
```

> **Note:** `schema.sql` already includes all governance tables, so on a fresh install these migrations are not needed.
