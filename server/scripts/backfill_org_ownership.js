import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool, sql } from '../db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const args = process.argv.slice(2);
const applyChanges = args.includes('--apply');
const outputArgIndex = args.findIndex((arg) => arg === '--output');
const outputPath = outputArgIndex >= 0 && args[outputArgIndex + 1]
    ? path.resolve(process.cwd(), args[outputArgIndex + 1])
    : path.resolve(__dirname, '../reports/org-ownership-backfill-report.json');

const createRequest = (dbOrTx) => (
    dbOrTx instanceof sql.Transaction
        ? new sql.Request(dbOrTx)
        : dbOrTx.request()
);

const toFiniteOrgId = (value) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
};

const ensureOutputDirectory = async (targetPath) => {
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
};

const report = {
    generatedAt: new Date().toISOString(),
    applyChanges,
    summary: {
        projects: { updated: 0, unresolved: 0, warnings: 0 },
        goals: { updated: 0, unresolved: 0, warnings: 0 },
        intakeForms: { updated: 0, unresolved: 0, warnings: 0 },
        intakeSubmissions: { updated: 0, unresolved: 0, warnings: 0 },
        governanceBoards: { updated: 0, unresolved: 0, warnings: 0 }
    },
    updated: {
        projects: [],
        goals: [],
        intakeForms: [],
        intakeSubmissions: [],
        governanceBoards: []
    },
    unresolved: {
        projects: [],
        goals: [],
        intakeForms: [],
        intakeSubmissions: [],
        governanceBoards: []
    },
    warnings: {
        projects: [],
        goals: [],
        intakeForms: [],
        intakeSubmissions: [],
        governanceBoards: []
    }
};

const updateEntityOrg = async ({ dbOrTx, tableName, id, orgId }) => {
    await createRequest(dbOrTx)
        .input('id', sql.Int, id)
        .input('orgId', sql.Int, orgId)
        .query(`UPDATE ${tableName} SET orgId = @orgId WHERE id = @id`);
};

const recordUpdated = (group, entry) => {
    report.summary[group].updated += 1;
    report.updated[group].push(entry);
};

const recordUnresolved = (group, entry) => {
    report.summary[group].unresolved += 1;
    report.unresolved[group].push(entry);
};

const recordWarning = (group, entry) => {
    report.summary[group].warnings += 1;
    report.warnings[group].push(entry);
};

const backfillProjects = async (dbOrTx) => {
    const result = await createRequest(dbOrTx).query(`
        WITH ProjectGoalOrgs AS (
            SELECT
                p.id AS projectId,
                COUNT(DISTINCT g.orgId) AS linkedGoalOrgCount,
                MIN(g.orgId) AS linkedGoalOrgId
            FROM Projects p
            LEFT JOIN ProjectGoals pg ON pg.projectId = p.id
            LEFT JOIN Goals g ON g.id = pg.goalId
            WHERE p.orgId IS NULL
            GROUP BY p.id
        )
        SELECT
            p.id,
            p.title,
            s.orgId AS submissionOrgId,
            pgo.linkedGoalOrgCount,
            pgo.linkedGoalOrgId
        FROM Projects p
        LEFT JOIN IntakeSubmissions s ON s.convertedProjectId = p.id
        LEFT JOIN ProjectGoalOrgs pgo ON pgo.projectId = p.id
        WHERE p.orgId IS NULL
        ORDER BY p.id
    `);

    for (const row of result.recordset) {
        const submissionOrgId = toFiniteOrgId(row.submissionOrgId);
        const linkedGoalOrgId = toFiniteOrgId(row.linkedGoalOrgId);
        const linkedGoalOrgCount = Number(row.linkedGoalOrgCount || 0);
        if (submissionOrgId) {
            if (applyChanges) {
                await updateEntityOrg({ dbOrTx, tableName: 'Projects', id: row.id, orgId: submissionOrgId });
            }
            recordUpdated('projects', { id: row.id, title: row.title, orgId: submissionOrgId, source: 'converted_submission_org' });
            continue;
        }
        if (linkedGoalOrgCount === 1 && linkedGoalOrgId) {
            if (applyChanges) {
                await updateEntityOrg({ dbOrTx, tableName: 'Projects', id: row.id, orgId: linkedGoalOrgId });
            }
            recordUpdated('projects', { id: row.id, title: row.title, orgId: linkedGoalOrgId, source: 'linked_goal_org' });
            continue;
        }
        recordUnresolved('projects', {
            id: row.id,
            title: row.title,
            reason: linkedGoalOrgCount > 1 ? 'multiple_linked_goal_orgs' : 'no_unambiguous_org_source'
        });
    }

    const mismatchResult = await createRequest(dbOrTx).query(`
        SELECT
            p.id,
            p.title,
            p.orgId,
            s.orgId AS submissionOrgId
        FROM Projects p
        INNER JOIN IntakeSubmissions s ON s.convertedProjectId = p.id
        WHERE p.orgId IS NOT NULL
          AND s.orgId IS NOT NULL
          AND p.orgId <> s.orgId
        ORDER BY p.id
    `);
    mismatchResult.recordset.forEach((row) => {
        recordWarning('projects', {
            id: row.id,
            title: row.title,
            currentOrgId: toFiniteOrgId(row.orgId),
            expectedOrgId: toFiniteOrgId(row.submissionOrgId),
            reason: 'converted_project_org_differs_from_submission_org'
        });
    });
};

const backfillGoals = async (dbOrTx) => {
    const result = await createRequest(dbOrTx).query(`
        SELECT
            g.id,
            g.title,
            parent.orgId AS parentOrgId
        FROM Goals g
        LEFT JOIN Goals parent ON parent.id = g.parentId
        WHERE g.orgId IS NULL
        ORDER BY g.id
    `);

    for (const row of result.recordset) {
        const parentOrgId = toFiniteOrgId(row.parentOrgId);
        if (parentOrgId) {
            if (applyChanges) {
                await updateEntityOrg({ dbOrTx, tableName: 'Goals', id: row.id, orgId: parentOrgId });
            }
            recordUpdated('goals', { id: row.id, title: row.title, orgId: parentOrgId, source: 'parent_goal_org' });
            continue;
        }
        recordUnresolved('goals', {
            id: row.id,
            title: row.title,
            reason: 'no_parent_goal_org'
        });
    }

    const mismatchResult = await createRequest(dbOrTx).query(`
        SELECT
            g.id,
            g.title,
            g.orgId,
            parent.orgId AS parentOrgId
        FROM Goals g
        INNER JOIN Goals parent ON parent.id = g.parentId
        WHERE g.orgId IS NOT NULL
          AND parent.orgId IS NOT NULL
          AND g.orgId <> parent.orgId
        ORDER BY g.id
    `);
    mismatchResult.recordset.forEach((row) => {
        recordWarning('goals', {
            id: row.id,
            title: row.title,
            currentOrgId: toFiniteOrgId(row.orgId),
            expectedOrgId: toFiniteOrgId(row.parentOrgId),
            reason: 'child_goal_org_differs_from_parent_goal_org'
        });
    });
};

const backfillIntakeForms = async (dbOrTx) => {
    const result = await createRequest(dbOrTx).query(`
        SELECT
            f.id,
            f.name,
            goal.orgId AS defaultGoalOrgId,
            board.orgId AS boardOrgId
        FROM IntakeForms f
        LEFT JOIN Goals goal ON goal.id = f.defaultGoalId
        LEFT JOIN GovernanceBoard board ON board.id = f.governanceBoardId
        WHERE f.orgId IS NULL
        ORDER BY f.id
    `);

    for (const row of result.recordset) {
        const defaultGoalOrgId = toFiniteOrgId(row.defaultGoalOrgId);
        const boardOrgId = toFiniteOrgId(row.boardOrgId);
        if (defaultGoalOrgId && boardOrgId && defaultGoalOrgId !== boardOrgId) {
            recordUnresolved('intakeForms', {
                id: row.id,
                name: row.name,
                reason: 'default_goal_org_conflicts_with_board_org',
                defaultGoalOrgId,
                boardOrgId
            });
            continue;
        }
        const resolvedOrgId = defaultGoalOrgId || boardOrgId;
        if (resolvedOrgId) {
            if (applyChanges) {
                await updateEntityOrg({ dbOrTx, tableName: 'IntakeForms', id: row.id, orgId: resolvedOrgId });
            }
            recordUpdated('intakeForms', {
                id: row.id,
                name: row.name,
                orgId: resolvedOrgId,
                source: defaultGoalOrgId ? 'default_goal_org' : 'governance_board_org'
            });
            continue;
        }
        recordUnresolved('intakeForms', {
            id: row.id,
            name: row.name,
            reason: 'no_default_goal_or_board_org'
        });
    }

    const mismatchResult = await createRequest(dbOrTx).query(`
        SELECT
            f.id,
            f.name,
            f.orgId,
            goal.orgId AS defaultGoalOrgId,
            board.orgId AS boardOrgId
        FROM IntakeForms f
        LEFT JOIN Goals goal ON goal.id = f.defaultGoalId
        LEFT JOIN GovernanceBoard board ON board.id = f.governanceBoardId
        WHERE f.orgId IS NOT NULL
          AND (
            (goal.orgId IS NOT NULL AND f.orgId <> goal.orgId)
            OR (board.orgId IS NOT NULL AND f.orgId <> board.orgId)
          )
        ORDER BY f.id
    `);
    mismatchResult.recordset.forEach((row) => {
        recordWarning('intakeForms', {
            id: row.id,
            name: row.name,
            currentOrgId: toFiniteOrgId(row.orgId),
            defaultGoalOrgId: toFiniteOrgId(row.defaultGoalOrgId),
            boardOrgId: toFiniteOrgId(row.boardOrgId),
            reason: 'form_org_differs_from_default_goal_or_board_org'
        });
    });
};

const backfillIntakeSubmissions = async (dbOrTx) => {
    const result = await createRequest(dbOrTx).query(`
        SELECT
            s.id,
            s.formId,
            s.submitterId,
            s.submitterName,
            submitter.orgId AS submitterOrgId,
            form.orgId AS formOrgId
        FROM IntakeSubmissions s
        LEFT JOIN Users submitter ON submitter.oid = s.submitterId
        LEFT JOIN IntakeForms form ON form.id = s.formId
        WHERE s.orgId IS NULL
        ORDER BY s.id
    `);

    for (const row of result.recordset) {
        const submitterOrgId = toFiniteOrgId(row.submitterOrgId);
        const formOrgId = toFiniteOrgId(row.formOrgId);
        const resolvedOrgId = submitterOrgId || formOrgId;
        if (resolvedOrgId) {
            if (applyChanges) {
                await updateEntityOrg({ dbOrTx, tableName: 'IntakeSubmissions', id: row.id, orgId: resolvedOrgId });
            }
            recordUpdated('intakeSubmissions', {
                id: row.id,
                formId: row.formId,
                submitterId: row.submitterId,
                submitterName: row.submitterName || null,
                orgId: resolvedOrgId,
                source: submitterOrgId ? 'submitter_user_org' : 'form_org'
            });
            continue;
        }
        recordUnresolved('intakeSubmissions', {
            id: row.id,
            formId: row.formId,
            submitterId: row.submitterId,
            submitterName: row.submitterName || null,
            reason: 'no_submitter_or_form_org'
        });
    }

    const mismatchResult = await createRequest(dbOrTx).query(`
        SELECT
            s.id,
            s.formId,
            s.orgId,
            submitter.orgId AS submitterOrgId,
            form.orgId AS formOrgId
        FROM IntakeSubmissions s
        LEFT JOIN Users submitter ON submitter.oid = s.submitterId
        LEFT JOIN IntakeForms form ON form.id = s.formId
        WHERE s.orgId IS NOT NULL
          AND (
            (submitter.orgId IS NOT NULL AND s.orgId <> submitter.orgId)
            OR (form.orgId IS NOT NULL AND s.orgId <> form.orgId)
          )
        ORDER BY s.id
    `);
    mismatchResult.recordset.forEach((row) => {
        recordWarning('intakeSubmissions', {
            id: row.id,
            formId: row.formId,
            currentOrgId: toFiniteOrgId(row.orgId),
            submitterOrgId: toFiniteOrgId(row.submitterOrgId),
            formOrgId: toFiniteOrgId(row.formOrgId),
            reason: 'submission_org_differs_from_submitter_or_form_org'
        });
    });
};

const backfillGovernanceBoards = async (dbOrTx) => {
    const result = await createRequest(dbOrTx).query(`
        SELECT id, name, createdByOid
        FROM GovernanceBoard
        WHERE orgId IS NULL
        ORDER BY id
    `);

    for (const row of result.recordset) {
        recordUnresolved('governanceBoards', {
            id: row.id,
            name: row.name,
            createdByOid: row.createdByOid || null,
            reason: 'manual_resolution_required'
        });
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
        await backfillProjects(dbOrTx);
        await backfillGoals(dbOrTx);
        await backfillIntakeForms(dbOrTx);
        await backfillIntakeSubmissions(dbOrTx);
        await backfillGovernanceBoards(dbOrTx);

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
    } catch (err) {
        if (tx) {
            await tx.rollback();
        }
        console.error(JSON.stringify({
            success: false,
            applyChanges,
            error: err?.message || 'Unknown error'
        }, null, 2));
        process.exitCode = 1;
    }
};

await main();
