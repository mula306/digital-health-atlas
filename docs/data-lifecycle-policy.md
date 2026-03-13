# Data Lifecycle Policy

Digital Health Atlas uses a conservative, archive-first lifecycle model so operational screens stay focused on current work while historical records remain available for audit, reporting, and institutional memory.

## Default posture

- `Conservative` retention posture
- Archived records are `hidden by default`
- Core business records are `not physically purged` in this phase
- Physical purge is limited to operational artifacts after export and verification safeguards

## Data classification model

| Classification | Typical data | Handling intent |
|---|---|---|
| `Restricted` | submitter identity, user emails, audit before/after payloads, IP/user-agent, governance rationale, free-text intake and status content | strict RBAC, longest retention, least export surface |
| `Confidential` | projects, goals, KPIs, status reports, benefit tracking, governance records, sharing requests | archive-first, org-scoped access, historical reporting allowed |
| `Internal` | organizations, board settings, workflow config, report pack definitions, tags | admin/ops use, low purge pressure |
| `Operational Ephemera` | executive pack run history, expired shares, expired sharing requests, generated lifecycle reports | short-lived, report/export before purge |

Authoritative policy constants live in [shared/dataLifecyclePolicy.js](C:\Users\mula\OneDrive\Documents\AntiGravity\Digital%20Health%20Atlas\shared\dataLifecyclePolicy.js).

## Lifecycle states

### Projects

- `active`
- `completed`
- `archived`

### Goals

- `active`
- `retired`
- `archived`

### Intake Forms

- `draft`
- `active`
- `retired`
- `archived`

## Retention defaults

| Domain | Default retention behavior |
|---|---|
| Projects | auto-archive after 12 months in `completed`; archive `on-hold` projects after 18 months of inactivity when no governance work remains open |
| Goals | retire after 24 months with no active linked projects; archive 24 months after retirement |
| Intake submissions and governance records | keep at least 7 years; remove from default operational views long before purge is considered |
| Status reports | keep all versions for 24 months; only later superseded historical versions become compaction candidates |
| Executive pack runs | successful runs age out after 18 months; failed runs after 24 months |
| Audit log | keep 36 months hot in the app database, then export before any purge |
| Expired sharing grants and requests | keep 24 months after expiry or revocation |

## Current implementation

### Schema

Lifecycle columns and indexes are part of the canonical schema in [server/scripts/schema.sql](C:\Users\mula\OneDrive\Documents\AntiGravity\Digital%20Health%20Atlas\server\scripts\schema.sql):

- `Projects.lifecycleState`, `completedAt`, `archivedAt`, `archivedByOid`, `archiveReason`, `lastActivityAt`, `retentionClass`
- `Goals.lifecycleState`, `retiredAt`, `archivedAt`, `archivedByOid`, `archiveReason`, `lastActivityAt`, `retentionClass`
- `IntakeForms.lifecycleState`, `retiredAt`, `archivedAt`, `archivedByOid`
- `IntakeSubmissions.resolvedAt`
- `Tasks.updatedAt`

### API and UI behavior

- Project and goal list APIs support `lifecycle=active|archived|all`
- Intake form list API supports `lifecycle=active|archived|all`
- Delete actions for projects and goals now archive instead of hard-delete
- Intake forms with submissions retire instead of deleting historical data
- Archived and retired records are hidden from active UX by default and are read-only until restored
- Executive reporting can opt into archived projects via `includeArchived`

### Activity tracking

The platform now maintains durable activity timestamps outside `AuditLog`:

- project edits, tags, reports, tasks, goal changes, ownership changes, and sharing changes update `Projects.lastActivityAt`
- goal edits, KPI changes, and project-link changes update `Goals.lastActivityAt`
- task edits update `Tasks.updatedAt`

This lets the system eventually shorten hot audit retention without losing stale-work signals.

## Operational scripts

### Lifecycle backfill

Dry run:

```bash
cd server
npm run backfill:lifecycle
```

Apply:

```bash
cd server
npm run backfill:lifecycle:apply
```

What it does:

- backfills `Projects.completedAt`
- backfills `Projects.lastActivityAt`
- backfills `Goals.lastActivityAt`
- backfills `IntakeSubmissions.resolvedAt`
- reports and optionally applies retirement of clearly inactive goals

Default report output:

- `server/reports/lifecycle-backfill-report.json`

### Retention runner

Dry run:

```bash
cd server
npm run retention:dry-run
```

Apply:

```bash
cd server
npm run retention:apply
```

What it does today:

- archives policy-eligible projects
- retires or archives policy-eligible goals
- reports dormant intake forms for review
- reports historical intake/governance records
- reports operational-artifact purge/export candidates without deleting them

Default report output:

- `server/reports/data-retention-report.json`

## Safety rules

- Routine product flows must not physically delete project, goal, intake submission, governance, or audit history
- Restore is the expected path for accidentally archived records
- Operational-artifact purge categories remain report-only until export verification is in place
- Sharing and ownership semantics are preserved when records move into archived states

## Recommended operating sequence for existing environments

1. Run `npm run setup-db`
2. Run `npm run backfill:org-ownership`
3. Review or apply org ownership fixes
4. Run `npm run backfill:lifecycle`
5. Review the lifecycle report
6. Run `npm run retention:dry-run`
7. Review retention candidates before enabling `--apply`
