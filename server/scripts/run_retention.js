import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool, sql } from '../db.js';
import { RETENTION_WINDOWS } from '../../shared/dataLifecyclePolicy.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const args = process.argv.slice(2);
const applyChanges = args.includes('--apply');
const outputArgIndex = args.findIndex((arg) => arg === '--output');
const outputPath = outputArgIndex >= 0 && args[outputArgIndex + 1]
    ? path.resolve(process.cwd(), args[outputArgIndex + 1])
    : path.resolve(__dirname, '../reports/data-retention-report.json');

const createRequest = (dbOrTx) => (
    dbOrTx instanceof sql.Transaction
        ? new sql.Request(dbOrTx)
        : dbOrTx.request()
);

const ensureOutputDirectory = async (targetPath) => {
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
};

const ensureLifecycleSchemaReady = async (dbOrTx) => {
    const result = await createRequest(dbOrTx).query(`
        SELECT
            COL_LENGTH('Projects', 'lifecycleState') AS projectLifecycleState,
            COL_LENGTH('Projects', 'lastActivityAt') AS projectLastActivityAt,
            COL_LENGTH('Goals', 'lifecycleState') AS goalLifecycleState,
            COL_LENGTH('Goals', 'retiredAt') AS goalRetiredAt,
            COL_LENGTH('IntakeForms', 'lifecycleState') AS intakeFormLifecycleState,
            COL_LENGTH('IntakeSubmissions', 'resolvedAt') AS submissionResolvedAt
    `);
    const row = result.recordset[0] || {};
    const missing = [];
    if (!row.projectLifecycleState) missing.push('Projects.lifecycleState');
    if (!row.projectLastActivityAt) missing.push('Projects.lastActivityAt');
    if (!row.goalLifecycleState) missing.push('Goals.lifecycleState');
    if (!row.goalRetiredAt) missing.push('Goals.retiredAt');
    if (!row.intakeFormLifecycleState) missing.push('IntakeForms.lifecycleState');
    if (!row.submissionResolvedAt) missing.push('IntakeSubmissions.resolvedAt');
    if (missing.length > 0) {
        throw new Error(`Lifecycle schema is not installed on the current database. Missing columns: ${missing.join(', ')}. Run "npm run setup-db" before the retention runner.`);
    }
};

const toDate = (value) => {
    if (!value) return null;
    const parsed = value instanceof Date ? value : new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const toIso = (value) => {
    const parsed = toDate(value);
    return parsed ? parsed.toISOString() : null;
};

const monthsAgo = (months) => {
    const date = new Date();
    date.setMonth(date.getMonth() - months);
    return date;
};

const yearsAgo = (years) => {
    const date = new Date();
    date.setFullYear(date.getFullYear() - years);
    return date;
};

const projectCompletedCutoff = monthsAgo(RETENTION_WINDOWS.projectArchiveCompletedMonths);
const projectOnHoldCutoff = monthsAgo(RETENTION_WINDOWS.projectArchiveOnHoldMonths);
const goalRetireCutoff = monthsAgo(RETENTION_WINDOWS.goalRetireMonths);
const goalArchiveCutoff = monthsAgo(RETENTION_WINDOWS.goalArchiveMonths);
const statusReportCutoff = monthsAgo(RETENTION_WINDOWS.statusReportFullRetentionMonths);
const executiveSuccessCutoff = monthsAgo(RETENTION_WINDOWS.executiveRunSuccessMonths);
const executiveFailureCutoff = monthsAgo(RETENTION_WINDOWS.executiveRunFailureMonths);
const auditHotCutoff = monthsAgo(RETENTION_WINDOWS.auditHotRetentionMonths);
const sharingCutoff = monthsAgo(RETENTION_WINDOWS.sharingHistoryMonths);
const intakeHistoryCutoff = yearsAgo(RETENTION_WINDOWS.intakeHistoryYears);

const report = {
    generatedAt: new Date().toISOString(),
    applyChanges,
    policy: {
        retentionWindows: RETENTION_WINDOWS
    },
    summary: {
        projects: { candidates: 0, archived: 0 },
        goals: { retireCandidates: 0, retired: 0, archiveCandidates: 0, archived: 0 },
        intakeForms: { reviewCandidates: 0, retired: 0 },
        intakeHistory: { candidates: 0 },
        governanceHistory: { candidates: 0 },
        operationalArtifacts: {
            statusReportCompactionCandidates: 0,
            executivePackRunPurgeCandidates: 0,
            auditExportCandidates: 0,
            expiredProjectShares: 0,
            expiredGoalShares: 0,
            expiredSharingRequests: 0
        }
    },
    candidates: {
        projectsToArchive: [],
        goalsToRetire: [],
        goalsToArchive: [],
        intakeFormsForReview: [],
        intakeHistory: [],
        governanceHistory: [],
        statusReportCompaction: [],
        executivePackRuns: [],
        auditExport: [],
        expiredProjectShares: [],
        expiredGoalShares: [],
        expiredSharingRequests: []
    },
    applied: {
        projectsArchived: [],
        goalsRetired: [],
        goalsArchived: []
    },
    notes: [
        'Apply mode only changes core lifecycle states for projects and goals.',
        'Operational-artifact purge categories remain report-only until cold-export verification is introduced.',
        'Dormant intake forms are surfaced for review but are not auto-retired until a business age threshold is formally approved.'
    ]
};

const archiveProject = async ({ dbOrTx, id, archivedAt, archiveReason }) => {
    await createRequest(dbOrTx)
        .input('id', sql.Int, id)
        .input('archivedAt', sql.DateTime2, archivedAt)
        .input('archivedByOid', sql.NVarChar(100), 'system:retention-runner')
        .input('archiveReason', sql.NVarChar(500), archiveReason)
        .query(`
            UPDATE Projects
            SET lifecycleState = 'archived',
                archivedAt = @archivedAt,
                archivedByOid = @archivedByOid,
                archiveReason = @archiveReason,
                lastActivityAt = CASE
                    WHEN lastActivityAt IS NULL OR lastActivityAt < @archivedAt THEN @archivedAt
                    ELSE lastActivityAt
                END
            WHERE id = @id
        `);
};

const retireGoal = async ({ dbOrTx, id, retiredAt, archiveReason }) => {
    const request = createRequest(dbOrTx);
    request.input('id', sql.Int, id);
    request.input('lifecycleState', sql.NVarChar(20), 'retired');
    request.input('retiredAt', sql.DateTime2, retiredAt);
    request.input('archiveReason', sql.NVarChar(500), archiveReason);
    await request.query(`
        UPDATE Goals
        SET lifecycleState = @lifecycleState,
            retiredAt = @retiredAt,
            archivedAt = NULL,
            archivedByOid = NULL,
            archiveReason = @archiveReason,
            lastActivityAt = CASE
                WHEN lastActivityAt IS NULL OR lastActivityAt < @retiredAt THEN @retiredAt
                ELSE lastActivityAt
            END
        WHERE id = @id
    `);
};

const archiveGoal = async ({ dbOrTx, id, archivedAt, archiveReason }) => {
    await createRequest(dbOrTx)
        .input('id', sql.Int, id)
        .input('archivedAt', sql.DateTime2, archivedAt)
        .input('archivedByOid', sql.NVarChar(100), 'system:retention-runner')
        .input('archiveReason', sql.NVarChar(500), archiveReason)
        .query(`
            UPDATE Goals
            SET lifecycleState = 'archived',
                archivedAt = @archivedAt,
                archivedByOid = @archivedByOid,
                archiveReason = @archiveReason,
                lastActivityAt = CASE
                    WHEN lastActivityAt IS NULL OR lastActivityAt < @archivedAt THEN @archivedAt
                    ELSE lastActivityAt
                END
            WHERE id = @id
        `);
};

const collectProjectCandidates = async (dbOrTx) => {
    const result = await createRequest(dbOrTx).query(`
        SELECT
            p.id,
            p.title,
            p.status,
            p.lifecycleState,
            COALESCE(p.completedAt, p.lastActivityAt, p.createdAt) AS lifecycleAnchorAt,
            governanceStats.openGovernanceCount
        FROM Projects p
        OUTER APPLY (
            SELECT COUNT(*) AS openGovernanceCount
            FROM IntakeSubmissions s
            INNER JOIN GovernanceReview gr ON gr.submissionId = s.id
            WHERE s.convertedProjectId = p.id
              AND gr.status IN ('in-review')
        ) governanceStats
        WHERE p.lifecycleState IN ('active', 'completed')
        ORDER BY p.id
    `);

    const appliedAt = new Date();
    for (const row of result.recordset) {
        const lifecycleAnchorAt = toDate(row.lifecycleAnchorAt);
        const normalizedStatus = String(row.status || '').trim().toLowerCase();
        const normalizedLifecycle = String(row.lifecycleState || '').trim().toLowerCase();
        const isCompletedCandidate = normalizedLifecycle === 'completed'
            && lifecycleAnchorAt
            && lifecycleAnchorAt.getTime() < projectCompletedCutoff.getTime();
        const isOnHoldCandidate = normalizedStatus === 'on-hold'
            && normalizedLifecycle === 'active'
            && lifecycleAnchorAt
            && lifecycleAnchorAt.getTime() < projectOnHoldCutoff.getTime()
            && Number(row.openGovernanceCount || 0) === 0;
        if (!isCompletedCandidate && !isOnHoldCandidate) {
            continue;
        }

        const entry = {
            id: row.id,
            title: row.title,
            status: row.status,
            lifecycleState: row.lifecycleState,
            lifecycleAnchorAt: toIso(lifecycleAnchorAt),
            openGovernanceCount: Number(row.openGovernanceCount || 0),
            archiveReason: isCompletedCandidate
                ? 'Retention runner archived completed project after inactivity threshold'
                : 'Retention runner archived dormant on-hold project after inactivity threshold'
        };

        report.summary.projects.candidates += 1;
        report.candidates.projectsToArchive.push(entry);

        if (applyChanges) {
            await archiveProject({
                dbOrTx,
                id: row.id,
                archivedAt: appliedAt,
                archiveReason: entry.archiveReason
            });
            report.summary.projects.archived += 1;
            report.applied.projectsArchived.push({
                ...entry,
                archivedAt: toIso(appliedAt)
            });
        }
    }
};

const collectGoalCandidates = async (dbOrTx) => {
    const result = await createRequest(dbOrTx).query(`
        SELECT
            g.id,
            g.title,
            g.lifecycleState,
            g.retiredAt,
            COALESCE(g.lastActivityAt, g.retiredAt, g.archivedAt, g.createdAt) AS lifecycleAnchorAt,
            projectStats.activeLinkedProjectCount
        FROM Goals g
        OUTER APPLY (
            SELECT SUM(CASE WHEN linkedProjects.lifecycleState IN ('active', 'completed') THEN 1 ELSE 0 END) AS activeLinkedProjectCount
            FROM (
                SELECT p.id, p.lifecycleState
                FROM Projects p
                WHERE p.goalId = g.id
                UNION
                SELECT p.id, p.lifecycleState
                FROM ProjectGoals pg
                INNER JOIN Projects p ON p.id = pg.projectId
                WHERE pg.goalId = g.id
            ) linkedProjects
        ) projectStats
        WHERE g.lifecycleState IN ('active', 'retired')
        ORDER BY g.id
    `);

    const appliedAt = new Date();
    for (const row of result.recordset) {
        const lifecycleAnchorAt = toDate(row.lifecycleAnchorAt);
        const activeLinkedProjectCount = Number(row.activeLinkedProjectCount || 0);
        const normalizedLifecycle = String(row.lifecycleState || '').trim().toLowerCase();

        const shouldRetire = normalizedLifecycle === 'active'
            && activeLinkedProjectCount === 0
            && lifecycleAnchorAt
            && lifecycleAnchorAt.getTime() < goalRetireCutoff.getTime();
        const shouldArchive = normalizedLifecycle === 'retired'
            && toDate(row.retiredAt)
            && toDate(row.retiredAt).getTime() < goalArchiveCutoff.getTime();

        if (shouldRetire) {
            const entry = {
                id: row.id,
                title: row.title,
                activeLinkedProjectCount,
                lifecycleAnchorAt: toIso(lifecycleAnchorAt),
                archiveReason: 'Retention runner retired inactive goal after inactivity threshold'
            };
            report.summary.goals.retireCandidates += 1;
            report.candidates.goalsToRetire.push(entry);

            if (applyChanges) {
                await retireGoal({
                    dbOrTx,
                    id: row.id,
                    retiredAt: appliedAt,
                    archiveReason: entry.archiveReason
                });
                report.summary.goals.retired += 1;
                report.applied.goalsRetired.push({
                    ...entry,
                    retiredAt: toIso(appliedAt)
                });
            }
        }

        if (shouldArchive) {
            const entry = {
                id: row.id,
                title: row.title,
                retiredAt: toIso(row.retiredAt),
                archiveReason: 'Retention runner archived long-retired goal after archive threshold'
            };
            report.summary.goals.archiveCandidates += 1;
            report.candidates.goalsToArchive.push(entry);

            if (applyChanges) {
                await archiveGoal({
                    dbOrTx,
                    id: row.id,
                    archivedAt: appliedAt,
                    archiveReason: entry.archiveReason
                });
                report.summary.goals.archived += 1;
                report.applied.goalsArchived.push({
                    ...entry,
                    archivedAt: toIso(appliedAt)
                });
            }
        }
    }
};

const collectIntakeFormReviewCandidates = async (dbOrTx) => {
    const result = await createRequest(dbOrTx).query(`
        SELECT
            f.id,
            f.name,
            f.lifecycleState,
            f.createdAt,
            submissionStats.submissionCount
        FROM IntakeForms f
        OUTER APPLY (
            SELECT COUNT(*) AS submissionCount
            FROM IntakeSubmissions s
            WHERE s.formId = f.id
        ) submissionStats
        WHERE f.lifecycleState IN ('draft', 'active')
        ORDER BY f.id
    `);

    const reviewCutoff = monthsAgo(12);
    for (const row of result.recordset) {
        const createdAt = toDate(row.createdAt);
        if (Number(row.submissionCount || 0) > 0) continue;
        if (!createdAt || createdAt.getTime() >= reviewCutoff.getTime()) continue;
        report.summary.intakeForms.reviewCandidates += 1;
        report.candidates.intakeFormsForReview.push({
            id: row.id,
            name: row.name,
            lifecycleState: row.lifecycleState,
            createdAt: toIso(createdAt),
            submissionCount: 0,
            note: 'Reported only. Dormant form auto-retire is held until a business threshold is formally approved.'
        });
    }
};

const collectHistoricalCandidates = async (dbOrTx) => {
    const submissionsResult = await createRequest(dbOrTx)
        .input('intakeHistoryCutoff', sql.DateTime2, intakeHistoryCutoff)
        .query(`
            SELECT TOP 100
                id,
                status,
                governanceDecision,
                resolvedAt
            FROM IntakeSubmissions
            WHERE resolvedAt IS NOT NULL
              AND resolvedAt < @intakeHistoryCutoff
            ORDER BY resolvedAt ASC, id ASC
        `);
    report.summary.intakeHistory.candidates = submissionsResult.recordset.length;
    report.candidates.intakeHistory = submissionsResult.recordset.map((row) => ({
        id: row.id,
        status: row.status,
        governanceDecision: row.governanceDecision || null,
        resolvedAt: toIso(row.resolvedAt)
    }));

    const governanceResult = await createRequest(dbOrTx)
        .input('intakeHistoryCutoff', sql.DateTime2, intakeHistoryCutoff)
        .query(`
            SELECT TOP 100
                id,
                submissionId,
                status,
                decision,
                decidedAt
            FROM GovernanceReview
            WHERE decidedAt IS NOT NULL
              AND decidedAt < @intakeHistoryCutoff
            ORDER BY decidedAt ASC, id ASC
        `);
    report.summary.governanceHistory.candidates = governanceResult.recordset.length;
    report.candidates.governanceHistory = governanceResult.recordset.map((row) => ({
        id: row.id,
        submissionId: row.submissionId,
        status: row.status,
        decision: row.decision || null,
        decidedAt: toIso(row.decidedAt)
    }));
};

const collectOperationalArtifactCandidates = async (dbOrTx) => {
    const statusReportResult = await createRequest(dbOrTx)
        .input('statusReportCutoff', sql.DateTime2, statusReportCutoff)
        .query(`
            WITH ReportBase AS (
                SELECT
                    sr.id,
                    sr.projectId,
                    sr.createdAt,
                    COALESCE(NULLIF(LOWER(JSON_VALUE(sr.reportData, '$.overallStatus')), ''), 'unknown') AS overallStatus,
                    DATEPART(YEAR, sr.createdAt) AS reportYear,
                    DATEPART(QUARTER, sr.createdAt) AS reportQuarter
                FROM StatusReports sr
                INNER JOIN Projects p ON p.id = sr.projectId
                WHERE sr.createdAt < @statusReportCutoff
                  AND p.lifecycleState = 'archived'
            ),
            Ranked AS (
                SELECT
                    *,
                    ROW_NUMBER() OVER (PARTITION BY projectId ORDER BY createdAt DESC, id DESC) AS latestRank,
                    ROW_NUMBER() OVER (PARTITION BY projectId, reportYear, reportQuarter ORDER BY createdAt DESC, id DESC) AS quarterRank
                FROM ReportBase
            )
            SELECT TOP 200
                id,
                projectId,
                createdAt,
                overallStatus
            FROM Ranked
            WHERE latestRank > 1
              AND quarterRank > 1
              AND overallStatus NOT IN ('red', 'critical')
            ORDER BY createdAt ASC, id ASC
        `);
    report.summary.operationalArtifacts.statusReportCompactionCandidates = statusReportResult.recordset.length;
    report.candidates.statusReportCompaction = statusReportResult.recordset.map((row) => ({
        id: row.id,
        projectId: row.projectId,
        createdAt: toIso(row.createdAt),
        overallStatus: row.overallStatus
    }));

    const executiveRunResult = await createRequest(dbOrTx)
        .input('executiveSuccessCutoff', sql.DateTime2, executiveSuccessCutoff)
        .input('executiveFailureCutoff', sql.DateTime2, executiveFailureCutoff)
        .query(`
            SELECT TOP 200
                id,
                packId,
                status,
                completedAt,
                startedAt
            FROM ExecutiveReportPackRun
            WHERE (status = 'completed' AND COALESCE(completedAt, startedAt) < @executiveSuccessCutoff)
               OR (status = 'failed' AND COALESCE(completedAt, startedAt) < @executiveFailureCutoff)
            ORDER BY COALESCE(completedAt, startedAt) ASC, id ASC
        `);
    report.summary.operationalArtifacts.executivePackRunPurgeCandidates = executiveRunResult.recordset.length;
    report.candidates.executivePackRuns = executiveRunResult.recordset.map((row) => ({
        id: row.id,
        packId: row.packId,
        status: row.status,
        finishedAt: toIso(row.completedAt || row.startedAt)
    }));

    const auditResult = await createRequest(dbOrTx)
        .input('auditHotCutoff', sql.DateTime2, auditHotCutoff)
        .query(`
            SELECT TOP 200
                id,
                entityType,
                entityId,
                createdAt
            FROM AuditLog
            WHERE createdAt < @auditHotCutoff
            ORDER BY createdAt ASC, id ASC
        `);
    report.summary.operationalArtifacts.auditExportCandidates = auditResult.recordset.length;
    report.candidates.auditExport = auditResult.recordset.map((row) => ({
        id: String(row.id),
        entityType: row.entityType,
        entityId: row.entityId || null,
        createdAt: toIso(row.createdAt)
    }));

    const projectShareResult = await createRequest(dbOrTx)
        .input('sharingCutoff', sql.DateTime2, sharingCutoff)
        .query(`
            SELECT TOP 200
                projectId,
                orgId,
                expiresAt
            FROM ProjectOrgAccess
            WHERE expiresAt IS NOT NULL
              AND expiresAt < @sharingCutoff
            ORDER BY expiresAt ASC, projectId ASC
        `);
    report.summary.operationalArtifacts.expiredProjectShares = projectShareResult.recordset.length;
    report.candidates.expiredProjectShares = projectShareResult.recordset.map((row) => ({
        projectId: row.projectId,
        orgId: row.orgId,
        expiresAt: toIso(row.expiresAt)
    }));

    const goalShareResult = await createRequest(dbOrTx)
        .input('sharingCutoff', sql.DateTime2, sharingCutoff)
        .query(`
            SELECT TOP 200
                goalId,
                orgId,
                expiresAt
            FROM GoalOrgAccess
            WHERE expiresAt IS NOT NULL
              AND expiresAt < @sharingCutoff
            ORDER BY expiresAt ASC, goalId ASC
        `);
    report.summary.operationalArtifacts.expiredGoalShares = goalShareResult.recordset.length;
    report.candidates.expiredGoalShares = goalShareResult.recordset.map((row) => ({
        goalId: row.goalId,
        orgId: row.orgId,
        expiresAt: toIso(row.expiresAt)
    }));

    const sharingRequestResult = await createRequest(dbOrTx)
        .input('sharingCutoff', sql.DateTime2, sharingCutoff)
        .query(`
            SELECT TOP 200
                id,
                entityType,
                entityId,
                status,
                COALESCE(updatedAt, decidedAt, createdAt) AS activityAt
            FROM OrgSharingRequest
            WHERE status IN ('approved', 'rejected', 'revoked', 'expired')
              AND COALESCE(updatedAt, decidedAt, createdAt) < @sharingCutoff
            ORDER BY COALESCE(updatedAt, decidedAt, createdAt) ASC, id ASC
        `);
    report.summary.operationalArtifacts.expiredSharingRequests = sharingRequestResult.recordset.length;
    report.candidates.expiredSharingRequests = sharingRequestResult.recordset.map((row) => ({
        id: row.id,
        entityType: row.entityType,
        entityId: row.entityId,
        status: row.status,
        activityAt: toIso(row.activityAt)
    }));
};

const main = async () => {
    const pool = await getPool();
    const tx = applyChanges ? new sql.Transaction(pool) : null;

    try {
        if (tx) {
            await tx.begin();
        }

        const dbOrTx = tx || pool;
        await ensureLifecycleSchemaReady(dbOrTx);
        await collectProjectCandidates(dbOrTx);
        await collectGoalCandidates(dbOrTx);
        await collectIntakeFormReviewCandidates(dbOrTx);
        await collectHistoricalCandidates(dbOrTx);
        await collectOperationalArtifactCandidates(dbOrTx);

        if (tx) {
            await tx.commit();
        }

        await ensureOutputDirectory(outputPath);
        await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

        console.log(JSON.stringify({
            success: true,
            applyChanges,
            outputPath,
            summary: report.summary
        }, null, 2));
    } catch (error) {
        if (tx) {
            await tx.rollback();
        }
        console.error(JSON.stringify({
            success: false,
            applyChanges,
            error: error?.message || 'Unknown error'
        }, null, 2));
        process.exitCode = 1;
    }
};

await main();
