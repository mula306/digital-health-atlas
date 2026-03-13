import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool, sql } from '../db.js';
import { GOAL_LIFECYCLE_STATES, RETENTION_WINDOWS } from '../../shared/dataLifecyclePolicy.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const args = process.argv.slice(2);
const applyChanges = args.includes('--apply');
const outputArgIndex = args.findIndex((arg) => arg === '--output');
const outputPath = outputArgIndex >= 0 && args[outputArgIndex + 1]
    ? path.resolve(process.cwd(), args[outputArgIndex + 1])
    : path.resolve(__dirname, '../reports/lifecycle-backfill-report.json');

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
            COL_LENGTH('Projects', 'completedAt') AS projectCompletedAt,
            COL_LENGTH('Projects', 'lastActivityAt') AS projectLastActivityAt,
            COL_LENGTH('Goals', 'lastActivityAt') AS goalLastActivityAt,
            COL_LENGTH('Goals', 'retiredAt') AS goalRetiredAt,
            COL_LENGTH('IntakeSubmissions', 'resolvedAt') AS submissionResolvedAt
    `);
    const row = result.recordset[0] || {};
    const missing = [];
    if (!row.projectCompletedAt) missing.push('Projects.completedAt');
    if (!row.projectLastActivityAt) missing.push('Projects.lastActivityAt');
    if (!row.goalLastActivityAt) missing.push('Goals.lastActivityAt');
    if (!row.goalRetiredAt) missing.push('Goals.retiredAt');
    if (!row.submissionResolvedAt) missing.push('IntakeSubmissions.resolvedAt');
    if (missing.length > 0) {
        throw new Error(`Lifecycle schema is not installed on the current database. Missing columns: ${missing.join(', ')}. Run "npm run setup-db" before lifecycle backfill.`);
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

const sameInstant = (left, right) => {
    const leftDate = toDate(left);
    const rightDate = toDate(right);
    if (!leftDate && !rightDate) return true;
    if (!leftDate || !rightDate) return false;
    return leftDate.getTime() === rightDate.getTime();
};

const latestDate = (...values) => {
    const candidates = values
        .map((value) => toDate(value))
        .filter(Boolean);
    if (candidates.length === 0) return null;
    return new Date(Math.max(...candidates.map((value) => value.getTime())));
};

const buildMonthsAgo = (months) => {
    const date = new Date();
    date.setMonth(date.getMonth() - months);
    return date;
};

const goalRetireCutoff = buildMonthsAgo(RETENTION_WINDOWS.goalRetireMonths);

const report = {
    generatedAt: new Date().toISOString(),
    applyChanges,
    thresholds: {
        goalRetireMonths: RETENTION_WINDOWS.goalRetireMonths
    },
    summary: {
        projects: { updated: 0, warnings: 0 },
        goals: { updated: 0, retired: 0, warnings: 0 },
        intakeSubmissions: { updated: 0, warnings: 0 }
    },
    updated: {
        projects: [],
        goals: [],
        intakeSubmissions: []
    },
    lifecycleChanges: {
        goalsRetired: []
    },
    warnings: {
        projects: [],
        goals: [],
        intakeSubmissions: []
    },
    notes: [
        'Backfill uses the best available timestamps already present in the database.',
        'Historical KPI activity is inferred indirectly through goal/project activity because legacy KPI rows do not have their own timestamps.',
        'Goal retirement backfill only applies when a goal has no active linked projects and its best-known activity is older than the configured threshold.'
    ]
};

const updateProjectLifecycleFields = async ({ dbOrTx, id, completedAt, lastActivityAt }) => {
    await createRequest(dbOrTx)
        .input('id', sql.Int, id)
        .input('completedAt', sql.DateTime2, completedAt)
        .input('lastActivityAt', sql.DateTime2, lastActivityAt)
        .query(`
            UPDATE Projects
            SET completedAt = COALESCE(@completedAt, completedAt),
                lastActivityAt = @lastActivityAt
            WHERE id = @id
        `);
};

const updateGoalLifecycleFields = async ({ dbOrTx, id, lastActivityAt }) => {
    await createRequest(dbOrTx)
        .input('id', sql.Int, id)
        .input('lastActivityAt', sql.DateTime2, lastActivityAt)
        .query(`
            UPDATE Goals
            SET lastActivityAt = @lastActivityAt
            WHERE id = @id
        `);
};

const retireGoal = async ({ dbOrTx, id, retiredAt, archiveReason }) => {
    const request = createRequest(dbOrTx);
    request.input('id', sql.Int, id);
    request.input('lifecycleState', sql.NVarChar(20), GOAL_LIFECYCLE_STATES.RETIRED);
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

const updateSubmissionResolvedAt = async ({ dbOrTx, id, resolvedAt }) => {
    await createRequest(dbOrTx)
        .input('id', sql.Int, id)
        .input('resolvedAt', sql.DateTime2, resolvedAt)
        .query(`
            UPDATE IntakeSubmissions
            SET resolvedAt = @resolvedAt
            WHERE id = @id
        `);
};

const recordWarning = (group, entry) => {
    report.summary[group].warnings += 1;
    report.warnings[group].push(entry);
};

const backfillProjects = async (dbOrTx) => {
    const result = await createRequest(dbOrTx).query(`
        SELECT
            p.id,
            p.title,
            p.status,
            p.lifecycleState,
            p.createdAt,
            p.completedAt,
            p.archivedAt,
            p.lastActivityAt,
            reportStats.latestReportAt,
            taskStats.latestTaskAt,
            benefitStats.latestBenefitAt,
            auditStats.latestAuditAt
        FROM Projects p
        OUTER APPLY (
            SELECT MAX(sr.createdAt) AS latestReportAt
            FROM StatusReports sr
            WHERE sr.projectId = p.id
        ) reportStats
        OUTER APPLY (
            SELECT MAX(t.updatedAt) AS latestTaskAt
            FROM Tasks t
            WHERE t.projectId = p.id
        ) taskStats
        OUTER APPLY (
            SELECT MAX(br.updatedAt) AS latestBenefitAt
            FROM ProjectBenefitRealization br
            WHERE br.projectId = p.id
        ) benefitStats
        OUTER APPLY (
            SELECT MAX(a.createdAt) AS latestAuditAt
            FROM AuditLog a
            WHERE (a.entityType = 'project' AND a.entityId = CAST(p.id AS NVARCHAR(20)))
               OR (a.entityType IN ('task', 'report', 'project_benefit')
                   AND JSON_VALUE(a.metadata, '$.projectId') = CAST(p.id AS NVARCHAR(20)))
        ) auditStats
        ORDER BY p.id
    `);

    for (const row of result.recordset) {
        const completedAt = String(row.status || '').trim().toLowerCase() === 'completed'
            ? latestDate(
                row.completedAt,
                row.latestReportAt,
                row.latestTaskAt,
                row.latestBenefitAt,
                row.lastActivityAt,
                row.latestAuditAt,
                row.createdAt
            )
            : toDate(row.completedAt);
        const lastActivityAt = latestDate(
            row.archivedAt,
            completedAt,
            row.lastActivityAt,
            row.latestReportAt,
            row.latestTaskAt,
            row.latestBenefitAt,
            row.latestAuditAt,
            row.createdAt
        );

        if (!lastActivityAt) {
            recordWarning('projects', {
                id: row.id,
                title: row.title,
                reason: 'no_activity_signal_available'
            });
            continue;
        }

        const needsCompletedAt = String(row.status || '').trim().toLowerCase() === 'completed'
            && !sameInstant(row.completedAt, completedAt);
        const needsLastActivityAt = !sameInstant(row.lastActivityAt, lastActivityAt);
        if (!needsCompletedAt && !needsLastActivityAt) {
            continue;
        }

        if (applyChanges) {
            await updateProjectLifecycleFields({
                dbOrTx,
                id: row.id,
                completedAt,
                lastActivityAt
            });
        }

        report.summary.projects.updated += 1;
        report.updated.projects.push({
            id: row.id,
            title: row.title,
            status: row.status,
            completedAt: toIso(completedAt),
            lastActivityAt: toIso(lastActivityAt),
            sources: {
                report: toIso(row.latestReportAt),
                task: toIso(row.latestTaskAt),
                benefit: toIso(row.latestBenefitAt),
                audit: toIso(row.latestAuditAt),
                createdAt: toIso(row.createdAt)
            }
        });

        if (!row.latestReportAt && !row.latestTaskAt && !row.latestBenefitAt && !row.latestAuditAt) {
            recordWarning('projects', {
                id: row.id,
                title: row.title,
                reason: 'fell_back_to_created_or_existing_timestamps_only'
            });
        }
    }
};

const backfillGoals = async (dbOrTx) => {
    const result = await createRequest(dbOrTx).query(`
        SELECT
            g.id,
            g.title,
            g.lifecycleState,
            g.createdAt,
            g.retiredAt,
            g.archivedAt,
            g.lastActivityAt,
            goalAudit.latestGoalAuditAt,
            projectStats.latestLinkedProjectActivityAt,
            projectStats.activeLinkedProjectCount
        FROM Goals g
        OUTER APPLY (
            SELECT MAX(a.createdAt) AS latestGoalAuditAt
            FROM AuditLog a
            WHERE a.entityType = 'goal'
              AND a.entityId = CAST(g.id AS NVARCHAR(20))
        ) goalAudit
        OUTER APPLY (
            SELECT
                MAX(linkedProjects.lastActivityAt) AS latestLinkedProjectActivityAt,
                SUM(CASE WHEN linkedProjects.lifecycleState IN ('active', 'completed') THEN 1 ELSE 0 END) AS activeLinkedProjectCount
            FROM (
                SELECT p.id, p.lastActivityAt, p.lifecycleState
                FROM Projects p
                WHERE p.goalId = g.id
                UNION
                SELECT p.id, p.lastActivityAt, p.lifecycleState
                FROM ProjectGoals pg
                INNER JOIN Projects p ON p.id = pg.projectId
                WHERE pg.goalId = g.id
            ) linkedProjects
        ) projectStats
        ORDER BY g.id
    `);

    const retirementAppliedAt = new Date();

    for (const row of result.recordset) {
        const lastActivityAt = latestDate(
            row.archivedAt,
            row.retiredAt,
            row.lastActivityAt,
            row.latestGoalAuditAt,
            row.latestLinkedProjectActivityAt,
            row.createdAt
        );
        const activeLinkedProjectCount = Number(row.activeLinkedProjectCount || 0);
        const isRetirementCandidate =
            String(row.lifecycleState || '').trim().toLowerCase() === GOAL_LIFECYCLE_STATES.ACTIVE
            && activeLinkedProjectCount === 0
            && lastActivityAt
            && lastActivityAt.getTime() < goalRetireCutoff.getTime();

        const needsLastActivityAt = !sameInstant(row.lastActivityAt, lastActivityAt);

        if (needsLastActivityAt && lastActivityAt && applyChanges) {
            await updateGoalLifecycleFields({
                dbOrTx,
                id: row.id,
                lastActivityAt
            });
        }

        if (needsLastActivityAt && lastActivityAt) {
            report.summary.goals.updated += 1;
            report.updated.goals.push({
                id: row.id,
                title: row.title,
                lifecycleState: row.lifecycleState,
                lastActivityAt: toIso(lastActivityAt),
                sources: {
                    linkedProjectActivity: toIso(row.latestLinkedProjectActivityAt),
                    goalAudit: toIso(row.latestGoalAuditAt),
                    createdAt: toIso(row.createdAt)
                }
            });
        }

        if (isRetirementCandidate) {
            if (applyChanges) {
                await retireGoal({
                    dbOrTx,
                    id: row.id,
                    retiredAt: retirementAppliedAt,
                    archiveReason: 'Lifecycle backfill retired inactive goal'
                });
            }
            report.summary.goals.retired += 1;
            report.lifecycleChanges.goalsRetired.push({
                id: row.id,
                title: row.title,
                activeLinkedProjectCount,
                lastActivityAt: toIso(lastActivityAt),
                appliedRetiredAt: toIso(retirementAppliedAt)
            });
        }

        if (!row.latestLinkedProjectActivityAt && !row.latestGoalAuditAt) {
            recordWarning('goals', {
                id: row.id,
                title: row.title,
                reason: 'limited_goal_activity_history_available'
            });
        }
    }
};

const backfillIntakeSubmissionResolution = async (dbOrTx) => {
    const result = await createRequest(dbOrTx).query(`
        SELECT
            s.id,
            s.status,
            s.governanceDecision,
            s.submittedAt,
            s.resolvedAt,
            s.convertedProjectId,
            convertedProject.createdAt AS convertedProjectCreatedAt,
            reviewStats.decidedAt AS governanceDecidedAt
        FROM IntakeSubmissions s
        LEFT JOIN Projects convertedProject ON convertedProject.id = s.convertedProjectId
        OUTER APPLY (
            SELECT MAX(gr.decidedAt) AS decidedAt
            FROM GovernanceReview gr
            WHERE gr.submissionId = s.id
        ) reviewStats
        WHERE s.resolvedAt IS NULL
        ORDER BY s.id
    `);

    for (const row of result.recordset) {
        const normalizedStatus = String(row.status || '').trim().toLowerCase();
        const normalizedDecision = String(row.governanceDecision || '').trim().toLowerCase();
        const isResolvedWorkflowState =
            !!row.convertedProjectId
            || ['approved', 'rejected'].includes(normalizedStatus)
            || ['approved-backlog', 'rejected'].includes(normalizedDecision);
        if (!isResolvedWorkflowState) {
            continue;
        }

        const resolvedAt = latestDate(
            row.convertedProjectCreatedAt,
            row.governanceDecidedAt,
            row.submittedAt
        );

        if (!resolvedAt) {
            recordWarning('intakeSubmissions', {
                id: row.id,
                reason: 'no_resolution_timestamp_source_available'
            });
            continue;
        }

        if (applyChanges) {
            await updateSubmissionResolvedAt({
                dbOrTx,
                id: row.id,
                resolvedAt
            });
        }

        report.summary.intakeSubmissions.updated += 1;
        report.updated.intakeSubmissions.push({
            id: row.id,
            status: row.status,
            governanceDecision: row.governanceDecision || null,
            convertedProjectId: row.convertedProjectId || null,
            resolvedAt: toIso(resolvedAt),
            sources: {
                convertedProjectCreatedAt: toIso(row.convertedProjectCreatedAt),
                governanceDecidedAt: toIso(row.governanceDecidedAt),
                submittedAt: toIso(row.submittedAt)
            }
        });

        if (!row.convertedProjectCreatedAt && !row.governanceDecidedAt) {
            recordWarning('intakeSubmissions', {
                id: row.id,
                reason: 'resolved_at_inferred_from_submitted_at'
            });
        }
    }
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
        await backfillProjects(dbOrTx);
        await backfillGoals(dbOrTx);
        await backfillIntakeSubmissionResolution(dbOrTx);

        if (tx) {
            await tx.commit();
        }

        await ensureOutputDirectory(outputPath);
        await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

        console.log(JSON.stringify({
            success: true,
            applyChanges,
            outputPath,
            summary: report.summary,
            lifecycleChanges: {
                goalsRetired: report.summary.goals.retired
            }
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
