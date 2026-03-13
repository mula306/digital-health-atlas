import express from 'express';
import { getPool, sql } from '../db.js';
import { checkPermission, getAuthUser } from '../middleware/authMiddleware.js';
import { withSharedScope, checkProjectWriteAccess, requireProjectWriteAccess } from '../middleware/orgScope.js';
import { handleError } from '../utils/errorHandler.js';
import { logAudit } from '../utils/auditLogger.js';
import { cache, CACHE_KEYS, invalidateProjectCache } from '../utils/cache.js';
import { buildInClause, addParams } from '../utils/sqlHelpers.js';
import { validateGoalAssignment, loadGoalsForValidation } from '../utils/goalValidation.js';
import { ensureReadGoalAccessForOrg, findGoalAccessGapsForOrg } from '../utils/goalAccess.js';
import { ensureOrganizationExists, isAdminUser, resolveOwnedOrgId } from '../utils/orgOwnership.js';

const router = express.Router();

// ==================== PROJECTS ====================

const parseGoalIdsFromBody = (body) => {
    const sourceGoalIds = Array.isArray(body.goalIds)
        ? body.goalIds
        : (body.goalId !== undefined && body.goalId !== null && body.goalId !== '' ? [body.goalId] : []);

    const normalized = sourceGoalIds
        .map((id) => String(id).trim())
        .filter((id) => id !== '');
    const parsed = normalized.map((id) => Number.parseInt(id, 10));
    const invalid = normalized.filter((_, index) => Number.isNaN(parsed[index]));
    const dedupedParsed = [...new Set(parsed.filter((id) => !Number.isNaN(id)))];

    return {
        raw: normalized,
        parsed: dedupedParsed,
        invalid
    };
};

const findMissingGoalIds = async (pool, goalIds) => {
    if (goalIds.length === 0) return [];

    const { text, params } = buildInClause('goalCheck', goalIds);
    const request = pool.request();
    addParams(request, params);

    const result = await request.query(`SELECT id FROM Goals WHERE id IN (${text})`);
    const existing = new Set(result.recordset.map((row) => Number(row.id)));
    return goalIds.filter((goalId) => !existing.has(Number(goalId)));
};

const getUserOidFromReq = (req) => String(req.user?.oid || '').trim();

const parseTruthyQueryFlag = (value) => {
    if (value === undefined || value === null) return false;
    const normalized = String(value).trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
};

const TASK_STATUSES = new Set(['todo', 'in-progress', 'blocked', 'review', 'done']);
const TASK_PRIORITIES = new Set(['low', 'medium', 'high']);

const normalizeTaskDate = (value) => {
    if (value === undefined) return undefined;
    if (value === null || value === '') return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toISOString().slice(0, 10);
};

const normalizeTaskString = (value, maxLength = 0) => {
    if (value === undefined || value === null) return null;
    const trimmed = String(value).trim();
    if (!trimmed) return null;
    if (maxLength > 0) return trimmed.slice(0, maxLength);
    return trimmed;
};

const BENEFIT_STATUSES = new Set(['planned', 'in-progress', 'realized', 'at-risk', 'not-realized']);

const toNullableDateOnly = (value) => {
    if (value === undefined) return undefined;
    if (value === null || value === '') return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toISOString().slice(0, 10);
};

const toNullableNumber = (value) => {
    if (value === undefined) return undefined;
    if (value === null || value === '') return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return null;
    return Math.round(parsed * 100) / 100;
};

const hasProjectBenefitSchema = async (pool) => {
    const result = await pool.request().query(`
        SELECT
            CASE WHEN OBJECT_ID('ProjectBenefitRealization', 'U') IS NOT NULL THEN 1 ELSE 0 END AS hasBenefitTable,
            CASE WHEN COL_LENGTH('ProjectBenefitRealization', 'status') IS NOT NULL THEN 1 ELSE 0 END AS hasStatus,
            CASE WHEN COL_LENGTH('ProjectBenefitRealization', 'governanceDecision') IS NOT NULL THEN 1 ELSE 0 END AS hasGovernanceDecision
    `);
    const row = result.recordset[0] || {};
    return !!(row.hasBenefitTable && row.hasStatus && row.hasGovernanceDecision);
};

const computeRiskLevel = (score) => {
    if (score >= 75) return 'critical';
    if (score >= 50) return 'high';
    if (score >= 30) return 'medium';
    return 'low';
};

const toRiskDate = (value) => {
    if (!value) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const normalizeRiskCount = (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 0;
    return Math.max(0, Math.round(parsed));
};

const buildRiskSignalFromInputs = ({
    taskStats = {},
    reportStatus = 'unknown',
    latestReportAt = null,
    lastTaskActivityAt = null,
    nowMs = Date.now()
}) => {
    const totalTasks = normalizeRiskCount(taskStats.totalTasks);
    const blockedTasks = normalizeRiskCount(taskStats.blockedTasks);
    const overdueTasks = normalizeRiskCount(taskStats.overdueTasks);
    const inFlightTasks = normalizeRiskCount(taskStats.inFlightTasks);
    const overdueRatio = totalTasks > 0 ? overdueTasks / totalTasks : 0;
    const normalizedReportStatus = String(reportStatus || 'unknown').trim().toLowerCase() || 'unknown';

    const latestReportDate = toRiskDate(latestReportAt);
    const lastTaskActivityDate = toRiskDate(lastTaskActivityAt);
    const daysSinceLastReport = latestReportDate
        ? Math.floor((nowMs - latestReportDate.getTime()) / 86400000)
        : null;
    const daysSinceTaskActivity = lastTaskActivityDate
        ? Math.floor((nowMs - lastTaskActivityDate.getTime()) / 86400000)
        : null;

    let score = 0;
    const signals = [];

    if (overdueTasks > 0) {
        const points = Math.min(30, overdueTasks * 6);
        score += points;
        signals.push({
            key: 'overdue_tasks',
            severity: overdueTasks >= 4 ? 'high' : 'medium',
            points,
            message: `${overdueTasks} overdue task${overdueTasks === 1 ? '' : 's'} are at risk of delaying delivery.`
        });
    }

    if (blockedTasks > 0) {
        const points = Math.min(25, blockedTasks * 8);
        score += points;
        signals.push({
            key: 'blocked_tasks',
            severity: blockedTasks >= 2 ? 'high' : 'medium',
            points,
            message: `${blockedTasks} blocked task${blockedTasks === 1 ? '' : 's'} need dependency resolution.`
        });
    }

    if (normalizedReportStatus === 'red') {
        score += 25;
        signals.push({
            key: 'status_report_red',
            severity: 'high',
            points: 25,
            message: 'Latest status report is red.'
        });
    } else if (normalizedReportStatus === 'yellow') {
        score += 12;
        signals.push({
            key: 'status_report_yellow',
            severity: 'medium',
            points: 12,
            message: 'Latest status report is yellow.'
        });
    } else if (normalizedReportStatus === 'unknown') {
        score += 6;
        signals.push({
            key: 'status_report_unknown',
            severity: 'low',
            points: 6,
            message: 'No current status report is available.'
        });
    }

    if (daysSinceLastReport !== null) {
        if (daysSinceLastReport > 21) {
            score += 20;
            signals.push({
                key: 'stale_report_high',
                severity: 'high',
                points: 20,
                message: `Status report is stale (${daysSinceLastReport} days since last update).`
            });
        } else if (daysSinceLastReport > 14) {
            score += 10;
            signals.push({
                key: 'stale_report_medium',
                severity: 'medium',
                points: 10,
                message: `Status report is aging (${daysSinceLastReport} days since last update).`
            });
        }
    }

    if (daysSinceTaskActivity !== null && daysSinceTaskActivity > 14) {
        score += 8;
        signals.push({
            key: 'stale_task_activity',
            severity: 'medium',
            points: 8,
            message: `Task activity appears stalled (${daysSinceTaskActivity} days since last task update).`
        });
    }

    if (overdueRatio >= 0.35 && totalTasks >= 3) {
        score += 10;
        signals.push({
            key: 'overdue_ratio',
            severity: 'medium',
            points: 10,
            message: `${Math.round(overdueRatio * 100)}% of tracked tasks are overdue.`
        });
    }

    score = Math.min(100, Math.round(score));
    const level = computeRiskLevel(score);

    return {
        score,
        level,
        metrics: {
            totalTasks,
            inFlightTasks,
            blockedTasks,
            overdueTasks,
            overdueRatio: Math.round(overdueRatio * 1000) / 1000,
            reportStatus: normalizedReportStatus,
            daysSinceLastReport,
            daysSinceTaskActivity
        },
        signals
    };
};

const buildProjectRiskSignal = async ({ pool, projectId }) => {
    const taskStatsResult = await pool.request()
        .input('projectId', sql.Int, projectId)
        .query(`
            SELECT
                COUNT(*) AS totalTasks,
                SUM(CASE WHEN status = 'blocked' THEN 1 ELSE 0 END) AS blockedTasks,
                SUM(CASE WHEN status <> 'done' AND endDate < CAST(GETDATE() AS DATE) THEN 1 ELSE 0 END) AS overdueTasks,
                SUM(CASE WHEN status IN ('in-progress', 'review') THEN 1 ELSE 0 END) AS inFlightTasks
            FROM Tasks
            WHERE projectId = @projectId
        `);
    const taskStats = taskStatsResult.recordset[0] || {};

    const reportResult = await pool.request()
        .input('projectId', sql.Int, projectId)
        .query(`
            SELECT TOP 1
                createdAt,
                COALESCE(NULLIF(LOWER(JSON_VALUE(reportData, '$.overallStatus')), ''), 'unknown') AS overallStatus
            FROM StatusReports
            WHERE projectId = @projectId
            ORDER BY createdAt DESC, version DESC
        `);
    const latestReport = reportResult.recordset[0] || null;

    const activityResult = await pool.request()
        .input('projectId', sql.NVarChar(20), String(projectId))
        .query(`
            SELECT MAX(createdAt) AS lastTaskActivityAt
            FROM AuditLog
            WHERE entityType = 'task'
              AND JSON_VALUE(metadata, '$.projectId') = @projectId
        `);
    const lastTaskActivityAt = activityResult.recordset[0]?.lastTaskActivityAt || null;

    return buildRiskSignalFromInputs({
        taskStats,
        reportStatus: latestReport?.overallStatus || 'unknown',
        latestReportAt: latestReport?.createdAt || null,
        lastTaskActivityAt
    });
};

const mapBenefitRow = (row) => ({
    id: String(row.id),
    projectId: String(row.projectId),
    title: row.title,
    description: row.description || null,
    linkedKpiId: row.linkedKpiId === null || row.linkedKpiId === undefined ? null : String(row.linkedKpiId),
    linkedKpiName: row.linkedKpiName || null,
    baselineValue: row.baselineValue === null || row.baselineValue === undefined ? null : Number(row.baselineValue),
    targetValue: row.targetValue === null || row.targetValue === undefined ? null : Number(row.targetValue),
    currentValue: row.currentValue === null || row.currentValue === undefined ? null : Number(row.currentValue),
    unit: row.unit || null,
    status: row.status || 'planned',
    dueAt: row.dueAt || null,
    realizedAt: row.realizedAt || null,
    governanceReviewId: row.governanceReviewId === null || row.governanceReviewId === undefined ? null : String(row.governanceReviewId),
    governanceDecision: row.governanceDecision || null,
    notes: row.notes || null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    updatedByOid: row.updatedByOid || null
});

const mapGoalContextStatus = ({ linkedGoalCount, visibleGoalCount }) => {
    if (linkedGoalCount <= 0) return 'no-goals-linked';
    if (visibleGoalCount <= 0) return 'none-visible';
    if (visibleGoalCount < linkedGoalCount) return 'partial';
    return 'complete';
};

const fetchProjectGoalContextMap = async (pool, orgId, projectIds = null) => {
    const normalizedProjectIds = Array.isArray(projectIds)
        ? [...new Set(projectIds
            .map((projectId) => Number.parseInt(projectId, 10))
            .filter((projectId) => !Number.isNaN(projectId)))]
        : [];

    if (Array.isArray(projectIds) && normalizedProjectIds.length === 0) {
        return new Map();
    }

    const request = pool.request();
    const filters = [];

    if (orgId !== null && orgId !== undefined) {
        request.input('orgId', sql.Int, orgId);
    }

    if (normalizedProjectIds.length > 0) {
        const { text, params } = buildInClause('goalContextProjectId', normalizedProjectIds);
        addParams(request, params);
        filters.push(`pgl.projectId IN (${text})`);
    }

    const where = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
    const visibleGoalExpression = orgId === null || orgId === undefined
        ? 'COUNT(DISTINCT pgl.goalId)'
        : `
            COUNT(DISTINCT CASE
                WHEN g.orgId = @orgId OR goa.goalId IS NOT NULL THEN pgl.goalId
                ELSE NULL
            END)
        `;

    const result = await request.query(`
        WITH ProjectGoalLinks AS (
            SELECT pg.projectId, pg.goalId
            FROM ProjectGoals pg
            UNION
            SELECT p.id AS projectId, p.goalId
            FROM Projects p
            WHERE p.goalId IS NOT NULL
        )
        SELECT
            pgl.projectId,
            COUNT(DISTINCT pgl.goalId) AS linkedGoalCount,
            ${visibleGoalExpression} AS visibleGoalCount
        FROM ProjectGoalLinks pgl
        INNER JOIN Goals g ON g.id = pgl.goalId
        ${orgId === null || orgId === undefined ? '' : `
            LEFT JOIN GoalOrgAccess goa
                ON goa.goalId = g.id
               AND goa.orgId = @orgId
               AND (goa.expiresAt IS NULL OR goa.expiresAt > GETDATE())
        `}
        ${where}
        GROUP BY pgl.projectId
    `);

    return new Map(result.recordset.map((row) => [
        Number(row.projectId),
        {
            linkedGoalCount: Number(row.linkedGoalCount || 0),
            visibleGoalCount: Number(row.visibleGoalCount || 0)
        }
    ]));
};

// Get lightweight executive summary of ALL projects
router.get('/exec-summary', checkPermission(['can_view_exec_dashboard', 'can_view_projects']), withSharedScope, async (req, res) => {
    try {
        const pool = await getPool();
        const viewerOid = getUserOidFromReq(req) || '__none__';

        // 1. Fetch Projects with Latest Report (Updated for JSON blob)
        const projectsQuery = `
            SELECT 
                p.id, p.title,
                r.id as reportId, r.reportData, r.createdAt as reportDate,
                (CASE WHEN EXISTS (SELECT 1 FROM StatusReports WHERE projectId = p.id) THEN 1 ELSE 0 END) as reportCount,
                CAST(CASE WHEN pw.projectId IS NULL THEN 0 ELSE 1 END AS BIT) as isWatched
            FROM Projects p
            OUTER APPLY (
                SELECT TOP 1 *
                FROM StatusReports sr
                WHERE sr.projectId = p.id
                ORDER BY sr.createdAt DESC
            ) r
            LEFT JOIN ProjectWatchers pw ON pw.projectId = p.id AND pw.userOid = @viewerOid
            WHERE (
                p.orgId = @orgId
                OR p.id IN (
                    SELECT projectId
                    FROM ProjectOrgAccess
                    WHERE orgId = @orgId
                      AND (expiresAt IS NULL OR expiresAt > GETDATE())
                )
                OR @orgId IS NULL
            )
            ORDER BY p.title ASC
        `;
        const projectsResult = await pool.request()
            .input('orgId', sql.Int, req.orgId)
            .input('viewerOid', sql.NVarChar(100), viewerOid)
            .query(projectsQuery);

        // 2. Fetch Project Tags
        const tagsResult = await pool.request().query('SELECT projectId, tagId, isPrimary FROM ProjectTags');
        const tagsByProject = {};
        tagsResult.recordset.forEach(t => {
            if (!tagsByProject[t.projectId]) tagsByProject[t.projectId] = [];
            tagsByProject[t.projectId].push({ tagId: t.tagId, isPrimary: t.isPrimary });
        });

        // 2b. Fetch Project Goals
        const pgResult = await pool.request().query('SELECT projectId, goalId FROM ProjectGoals');
        const goalsByProject = {};
        pgResult.recordset.forEach(pg => {
            if (!goalsByProject[pg.projectId]) goalsByProject[pg.projectId] = [];
            goalsByProject[pg.projectId].push(pg.goalId.toString());
        });

        const projectIds = projectsResult.recordset
            .map((project) => Number.parseInt(project.id, 10))
            .filter((id) => !Number.isNaN(id));
        const projectIdsAsStrings = projectIds.map((id) => String(id));
        const taskStatsByProject = new Map();
        const taskActivityByProject = new Map();

        if (projectIds.length > 0) {
            const { text: projectIdText, params: projectIdParams } = buildInClause('execProjectId', projectIds);

            // 2c. Fetch task completion + risk stats for only scoped projects
            const taskStatsRequest = pool.request();
            addParams(taskStatsRequest, projectIdParams);
            const taskStatsResult = await taskStatsRequest.query(`
                SELECT
                    projectId,
                    COUNT(*) AS taskCount,
                    SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS doneCount,
                    SUM(CASE WHEN status = 'blocked' THEN 1 ELSE 0 END) AS blockedTasks,
                    SUM(CASE WHEN status <> 'done' AND endDate < CAST(GETDATE() AS DATE) THEN 1 ELSE 0 END) AS overdueTasks,
                    SUM(CASE WHEN status IN ('in-progress', 'review') THEN 1 ELSE 0 END) AS inFlightTasks
                FROM Tasks
                WHERE projectId IN (${projectIdText})
                GROUP BY projectId
            `);

            taskStatsResult.recordset.forEach((row) => {
                taskStatsByProject.set(row.projectId, {
                    taskCount: normalizeRiskCount(row.taskCount),
                    doneCount: normalizeRiskCount(row.doneCount),
                    blockedTasks: normalizeRiskCount(row.blockedTasks),
                    overdueTasks: normalizeRiskCount(row.overdueTasks),
                    inFlightTasks: normalizeRiskCount(row.inFlightTasks)
                });
            });

            // 2d. Fetch latest task activity timestamp by project for risk staleness signal
            const { text: taskActivityProjectIdText, params: taskActivityProjectIdParams } = buildInClause('execProjectIdStr', projectIdsAsStrings);
            const taskActivityRequest = pool.request();
            addParams(taskActivityRequest, taskActivityProjectIdParams);
            const taskActivityResult = await taskActivityRequest.query(`
                SELECT
                    JSON_VALUE(metadata, '$.projectId') AS projectId,
                    MAX(createdAt) AS lastTaskActivityAt
                FROM AuditLog
                WHERE entityType = 'task'
                  AND JSON_VALUE(metadata, '$.projectId') IN (${taskActivityProjectIdText})
                GROUP BY JSON_VALUE(metadata, '$.projectId')
            `);

            taskActivityResult.recordset.forEach((row) => {
                const normalizedProjectId = String(row.projectId || '').trim();
                if (!normalizedProjectId) return;
                taskActivityByProject.set(normalizedProjectId, row.lastTaskActivityAt || null);
            });
        }

        // 3. Map Data and Parse JSON
        const summary = projectsResult.recordset.map(p => {
            let reportDetails = null;
            if (p.reportId) {
                try {
                    const parsedData = p.reportData ? JSON.parse(p.reportData) : {};
                    reportDetails = {
                        id: p.reportId,
                        overallStatus: parsedData.overallStatus,
                        executiveSummary: parsedData.executiveSummary,
                        updatedAt: p.reportDate,
                        accomplishments: parsedData.accomplishments,
                        roadblocks: parsedData.roadblocks,
                        nextSteps: parsedData.nextSteps,
                        risks: parsedData.risks
                    };
                } catch (e) {
                    console.error(`Error parsing report JSON for project ${p.id}:`, e);
                }
            }

            const taskStats = taskStatsByProject.get(p.id) || {
                taskCount: 0,
                doneCount: 0,
                blockedTasks: 0,
                overdueTasks: 0,
                inFlightTasks: 0
            };
            const completion = taskStats.taskCount > 0
                ? Math.round((taskStats.doneCount / taskStats.taskCount) * 100)
                : 0;
            const riskSignal = buildRiskSignalFromInputs({
                taskStats: {
                    totalTasks: taskStats.taskCount,
                    blockedTasks: taskStats.blockedTasks,
                    overdueTasks: taskStats.overdueTasks,
                    inFlightTasks: taskStats.inFlightTasks
                },
                reportStatus: reportDetails?.overallStatus || 'unknown',
                latestReportAt: p.reportDate || null,
                lastTaskActivityAt: taskActivityByProject.get(String(p.id)) || null
            });

            return {
                id: p.id.toString(),
                title: p.title,
                goalIds: goalsByProject[p.id] || [],
                goalId: (goalsByProject[p.id] || [])[0] || null, // backwards compat
                tags: tagsByProject[p.id] || [],
                taskCount: taskStats.taskCount,
                completedTaskCount: taskStats.doneCount,
                completion,
                reportCount: p.reportCount || 0,
                report: reportDetails,
                riskSignal,
                isWatched: !!p.isWatched
            };
        });

        res.json(summary);
    } catch (err) {
        handleError(res, 'fetching exec summary', err);
    }
});

// Get all projects with tasks and status reports (OPTIMIZED with JOINs and pagination)
router.get('/', checkPermission(['can_view_projects', 'can_view_exec_dashboard']), withSharedScope, async (req, res) => {
    try {
        // Pagination params
        const page = parseInt(req.query.page) || 1;
        let limit = parseInt(req.query.limit) || 50;
        if (limit > 100) limit = 100; // Clamp limit
        const offset = (page - 1) * limit;
        const search = req.query.search || '';
        const projectIdParam = req.query.projectId;
        const projectId = Number.isNaN(parseInt(projectIdParam, 10)) ? null : parseInt(projectIdParam, 10);
        const statusesParam = req.query.statuses || '';
        const statuses = statusesParam
            ? statusesParam.split(',').map(s => String(s).trim().toLowerCase()).filter(Boolean)
            : [];
        // Support both single goalId and comma-separated goalIds
        const goalId = req.query.goalId || null;
        const goalIdsParam = req.query.goalIds || '';
        const goalIds = goalIdsParam
            ? goalIdsParam.split(',').map(id => parseInt(id)).filter(id => !isNaN(id))
            : (goalId ? [parseInt(goalId)] : []);
        const tagIdsParam = req.query.tagIds || '';
        const tagIds = tagIdsParam
            ? tagIdsParam.split(',').map(id => parseInt(id)).filter(id => !isNaN(id))
            : [];
        const watchedOnly = parseTruthyQueryFlag(req.query.watchedOnly);
        const viewerOid = getUserOidFromReq(req) || '__none__';

        // Check cache first
        const cacheKey = `${CACHE_KEYS.PROJECT_PREFIX}${req.orgId ?? 'all'}_${viewerOid}_${watchedOnly ? 'watched' : 'all'}_${page}_${limit}_${search}_${projectId || ''}_${statuses.join('-')}_${goalIds.join('-')}_${tagIds.join('-')}`;
        const cached = cache.get(cacheKey);
        if (cached) {
            return res.json(cached);
        }

        const pool = await getPool();
        const requestParams = {
            offset,
            limit,
            viewerOid,
            orgId: req.orgId ?? null
        };
        const countParams = {
            viewerOid,
            orgId: req.orgId ?? null
        };

        // Build WHERE clause for filtering
        const conditions = [];
        if (req.orgId) {
            conditions.push(`(
                p.orgId = @orgId
                OR p.id IN (
                    SELECT projectId
                    FROM ProjectOrgAccess
                    WHERE orgId = @orgId
                      AND (expiresAt IS NULL OR expiresAt > GETDATE())
                )
            )`);
            requestParams.orgId = req.orgId;
            countParams.orgId = req.orgId;
        }
        if (projectId !== null) {
            conditions.push('p.id = @projectId');
            requestParams.projectId = projectId;
            countParams.projectId = projectId;
        }
        if (search) {
            conditions.push(`(p.title LIKE @search OR p.description LIKE @search)`);
            requestParams.search = `%${search}%`;
            countParams.search = `%${search}%`;
        }
        if (watchedOnly) {
            conditions.push(`EXISTS (SELECT 1 FROM ProjectWatchers pwf WHERE pwf.projectId = p.id AND pwf.userOid = @viewerOid)`);
        }

        let tagJoin = '';
        let statusJoin = '';

        // Safe Goal Filtering (via ProjectGoals join table)
        if (goalIds.length > 0) {
            const { text, params } = buildInClause('goalId', goalIds);
            conditions.push(`p.id IN (SELECT projectId FROM ProjectGoals WHERE goalId IN (${text}))`);
            Object.assign(requestParams, params);
            Object.assign(countParams, params);
        }

        // Safe Tag Filtering
        if (tagIds.length > 0) {
            const { text, params } = buildInClause('tagId', tagIds);
            tagJoin = `INNER JOIN ProjectTags pt ON p.id = pt.projectId AND pt.tagId IN (${text})`;
            Object.assign(requestParams, params);
            Object.assign(countParams, params);
        }

        // Filter by latest status report overallStatus (red/yellow/green/unknown)
        if (statuses.length > 0) {
            const { text, params } = buildInClause('status', statuses);
            statusJoin = `
                LEFT JOIN (
                    SELECT sr.projectId, LOWER(JSON_VALUE(sr.reportData, '$.overallStatus')) AS overallStatus
                    FROM StatusReports sr
                    INNER JOIN (
                        SELECT projectId, MAX(version) AS maxVersion
                        FROM StatusReports
                        GROUP BY projectId
                    ) latest ON latest.projectId = sr.projectId AND latest.maxVersion = sr.version
                ) lsr ON lsr.projectId = p.id
            `;
            conditions.push(`COALESCE(NULLIF(lsr.overallStatus, ''), 'unknown') IN (${text})`);
            Object.assign(requestParams, params);
            Object.assign(countParams, params);
        }

        let whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

        // Helper to run query with params
        const runQuery = async (queryStr, params) => {
            const req = pool.request();
            addParams(req, params);
            return await req.query(queryStr);
        };

        // Get total count for pagination metadata
        const countQuery = `SELECT COUNT(DISTINCT p.id) as total FROM Projects p ${tagJoin} ${statusJoin} ${whereClause}`;
        const countResult = await runQuery(countQuery, countParams);
        const totalProjects = countResult.recordset[0].total;
        const totalPages = Math.ceil(totalProjects / limit);

        // Single optimized query with JOIN - fetch projects with pagination
        const query = `
            SELECT DISTINCT
                p.id,
                p.title,
                p.description,
                p.status,
                p.orgId,
                p.createdAt,
                CASE
                    WHEN @orgId IS NULL OR p.orgId = @orgId THEN 'owner'
                    WHEN poa.accessLevel = 'write' THEN 'write'
                    WHEN poa.accessLevel = 'read' THEN 'read'
                    ELSE 'none'
                END AS accessLevel,
                CAST(CASE
                    WHEN @orgId IS NULL OR p.orgId = @orgId OR poa.accessLevel = 'write' THEN 1
                    ELSE 0
                END AS BIT) AS hasWriteAccess,
                CAST(CASE WHEN pw.projectId IS NULL THEN 0 ELSE 1 END AS BIT) AS isWatched
            FROM Projects p
            ${tagJoin}
            ${statusJoin}
            LEFT JOIN ProjectOrgAccess poa
                ON poa.projectId = p.id
               AND poa.orgId = @orgId
               AND (poa.expiresAt IS NULL OR poa.expiresAt > GETDATE())
            LEFT JOIN ProjectWatchers pw ON pw.projectId = p.id AND pw.userOid = @viewerOid
            ${whereClause}
            ORDER BY p.id
            OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
        `;
        const projectsResult = await runQuery(query, requestParams);

        // Get project IDs for this page
        const projectIds = projectsResult.recordset.map(p => p.id);

        if (projectIds.length === 0) {
            const emptyResult = {
                projects: [],
                pagination: { page, limit, total: totalProjects, totalPages, hasMore: false }
            };
            cache.set(cacheKey, emptyResult);
            return res.json(emptyResult);
        }

        // Fetch tasks and report COUNTS only (optimized)
        // Build parameterized IN clause for project IDs
        const { text: idInClause, params: idParams } = buildInClause('projId', projectIds);

        // Parallel requests setup
        const tasksRequest = pool.request();
        addParams(tasksRequest, idParams);

        const reportsRequest = pool.request();
        addParams(reportsRequest, idParams);

        const latestReportsRequest = pool.request();
        addParams(latestReportsRequest, idParams);

        const projectGoalsRequest = pool.request();
        addParams(projectGoalsRequest, idParams);

        const projectTagsRequest = pool.request();
        addParams(projectTagsRequest, idParams);

        const [tasksResult, reportsResult, latestReportsResult, projectTagsResult, projectGoalsResult] = await Promise.all([
            // Fetch only necessary task fields active tasks filtering
            tasksRequest.query(`SELECT projectId, id, title, status, endDate, assigneeOid FROM Tasks WHERE projectId IN (${idInClause})`),
            reportsRequest.query(`SELECT projectId, COUNT(*) as count FROM StatusReports WHERE projectId IN (${idInClause}) GROUP BY projectId`),
            // Fetch latest report for each project efficiently
            latestReportsRequest.query(`
                SELECT r.projectId, r.reportData, r.version, r.createdAt, r.createdBy
                FROM StatusReports r
                INNER JOIN (
                    SELECT projectId, MAX(version) as maxVersion
                    FROM StatusReports
                    WHERE projectId IN (${idInClause})
                    GROUP BY projectId
                ) latest ON r.projectId = latest.projectId AND r.version = latest.maxVersion
            `),
            // Fetch project tags
            projectTagsRequest.query(`
                SELECT pt.projectId, pt.tagId, pt.isPrimary, t.name, t.slug, t.color, t.groupId, t.status AS tagStatus
                FROM ProjectTags pt
                INNER JOIN Tags t ON pt.tagId = t.id
                WHERE pt.projectId IN (${idInClause})
            `),
            // Fetch project goals
            projectGoalsRequest.query(`SELECT projectId, goalId FROM ProjectGoals WHERE projectId IN (${idInClause})`)
        ]);
        const projectGoalContextMap = await fetchProjectGoalContextMap(pool, req.orgId ?? null, projectIds);

        // Build maps for efficient lookup
        const completionMap = new Map();
        const reportCountMap = new Map();
        const latestReportMap = new Map();
        const projectTagMap = new Map();
        const projectGoalMap = new Map();

        // Build project goals map
        projectGoalsResult.recordset.forEach(pg => {
            if (!projectGoalMap.has(pg.projectId)) projectGoalMap.set(pg.projectId, []);
            projectGoalMap.get(pg.projectId).push(pg.goalId.toString());
        });

        // Build project tags map
        projectTagsResult.recordset.forEach(pt => {
            if (!projectTagMap.has(pt.projectId)) projectTagMap.set(pt.projectId, []);
            projectTagMap.get(pt.projectId).push({
                tagId: pt.tagId.toString(),
                name: pt.name,
                slug: pt.slug,
                color: pt.color,
                groupId: pt.groupId.toString(),
                isPrimary: pt.isPrimary,
                tagStatus: pt.tagStatus
            });
        });

        // Calculate completion per project
        const projectTasks = {};
        tasksResult.recordset.forEach(t => {
            if (!projectTasks[t.projectId]) projectTasks[t.projectId] = [];
            projectTasks[t.projectId].push(t);
        });

        // Better way: separate map for counts and active tasks
        const completedCountMap = new Map();
        const activeTasksMap = new Map();

        projectIds.forEach(pid => {
            const tasks = projectTasks[pid] || [];

            if (tasks.length === 0) {
                completionMap.set(pid, 0);
            } else {
                const doneCount = tasks.filter(t => t.status === 'done').length;
                completionMap.set(pid, Math.round((doneCount / tasks.length) * 100));
            }

            const doneCount = tasks.filter(t => t.status === 'done').length;
            completedCountMap.set(pid, doneCount);

            // Filter for active tasks (not done) to send to client for Dashboard lists
            const activeTasks = tasks
                .filter(t => t.status !== 'done')
                .map(t => ({
                    id: t.id,
                    title: t.title,
                    status: t.status,
                    endDate: t.endDate,
                    assigneeOid: t.assigneeOid || null
                }));
            activeTasksMap.set(pid, activeTasks);
        });

        reportsResult.recordset.forEach(r => {
            reportCountMap.set(r.projectId, r.count);
        });

        latestReportsResult.recordset.forEach(r => {
            try {
                const data = JSON.parse(r.reportData || '{}');
                // Use default if overallStatus missing but mapped
                if (!data.overallStatus) data.overallStatus = 'unknown';

                latestReportMap.set(String(r.projectId), {
                    id: `latest-${r.projectId}`, // Virtual ID
                    version: r.version,
                    createdAt: r.createdAt,
                    createdBy: r.createdBy,
                    ...data
                });
            } catch (e) {
                console.error('Error parsing report data:', e);
            }
        });

        const projects = projectsResult.recordset.map(project => {
            const gIds = projectGoalMap.get(project.id) || [];
            const goalContext = projectGoalContextMap.get(project.id) || {
                linkedGoalCount: 0,
                visibleGoalCount: 0
            };
            return {
                id: project.id.toString(),
                title: project.title,
                description: project.description,
                status: project.status || 'active',
                orgId: project.orgId === null || project.orgId === undefined ? null : String(project.orgId),
                goalIds: gIds,
                goalId: gIds[0] || null, // backwards compat
                createdAt: project.createdAt,
                completion: completionMap.get(project.id) || 0,
                tasks: (activeTasksMap.get(project.id) || []),
                taskCount: (projectTasks[project.id] || []).length,
                completedTaskCount: completedCountMap.get(project.id) || 0,
                reportCount: reportCountMap.get(project.id) || 0,
                latestReport: latestReportMap.get(String(project.id)) || null,
                tags: projectTagMap.get(project.id) || [],
                accessLevel: project.accessLevel || 'owner',
                hasWriteAccess: !!project.hasWriteAccess,
                linkedGoalCount: goalContext.linkedGoalCount,
                visibleGoalCount: goalContext.visibleGoalCount,
                goalContextStatus: mapGoalContextStatus(goalContext),
                goalContextMissing: goalContext.linkedGoalCount > 0 && goalContext.visibleGoalCount === 0,
                isWatched: !!project.isWatched
            };
        });

        const result = {
            projects,
            pagination: {
                page,
                limit,
                total: totalProjects,
                totalPages,
                hasMore: page < totalPages
            }
        };

        // Cache the result
        cache.set(cacheKey, result);
        res.json(result);
    } catch (err) {
        handleError(res, 'fetching projects', err);
    }
});

// Get current user's watched projects (within org/shared scope)
router.get('/watchlist', checkPermission(['can_view_projects', 'can_view_exec_dashboard']), withSharedScope, async (req, res) => {
    try {
        const viewerOid = getUserOidFromReq(req);
        if (!viewerOid) {
            return res.json([]);
        }

        const pool = await getPool();
        const result = await pool.request()
            .input('viewerOid', sql.NVarChar(100), viewerOid)
            .input('orgId', sql.Int, req.orgId)
            .query(`
                SELECT p.id, p.title, p.description, p.status, p.createdAt
                FROM ProjectWatchers pw
                INNER JOIN Projects p ON p.id = pw.projectId
                WHERE pw.userOid = @viewerOid
                  AND (
                    p.orgId = @orgId
                    OR p.id IN (
                        SELECT projectId
                        FROM ProjectOrgAccess
                        WHERE orgId = @orgId
                          AND (expiresAt IS NULL OR expiresAt > GETDATE())
                    )
                    OR @orgId IS NULL
                  )
                ORDER BY p.title ASC
            `);

        const projects = result.recordset.map((project) => ({
            id: String(project.id),
            title: project.title,
            description: project.description,
            status: project.status || 'active',
            createdAt: project.createdAt,
            isWatched: true
        }));

        res.json(projects);
    } catch (err) {
        handleError(res, 'fetching watchlist', err);
    }
});

// Add project to current user's watchlist
router.post('/:id/watch', checkPermission(['can_view_projects', 'can_view_exec_dashboard']), withSharedScope, checkProjectWriteAccess(), async (req, res) => {
    try {
        const projectId = parseInt(req.params.id, 10);
        if (Number.isNaN(projectId)) {
            return res.status(400).json({ error: 'Invalid project id' });
        }

        const viewerOid = getUserOidFromReq(req);
        if (!viewerOid) {
            return res.status(400).json({ error: 'Unable to resolve authenticated user id' });
        }

        const pool = await getPool();
        await pool.request()
            .input('projectId', sql.Int, projectId)
            .input('viewerOid', sql.NVarChar(100), viewerOid)
            .query(`
                IF NOT EXISTS (
                    SELECT 1
                    FROM ProjectWatchers
                    WHERE projectId = @projectId AND userOid = @viewerOid
                )
                BEGIN
                    INSERT INTO ProjectWatchers (projectId, userOid)
                    VALUES (@projectId, @viewerOid)
                END
            `);

        invalidateProjectCache();
        logAudit({
            action: 'project.watch_add',
            entityType: 'project',
            entityId: String(projectId),
            user: getAuthUser(req),
            metadata: { userOid: viewerOid },
            req
        });
        res.json({ success: true, isWatched: true });
    } catch (err) {
        handleError(res, 'adding project watch', err);
    }
});

// Remove project from current user's watchlist
router.delete('/:id/watch', checkPermission(['can_view_projects', 'can_view_exec_dashboard']), withSharedScope, checkProjectWriteAccess(), async (req, res) => {
    try {
        const projectId = parseInt(req.params.id, 10);
        if (Number.isNaN(projectId)) {
            return res.status(400).json({ error: 'Invalid project id' });
        }

        const viewerOid = getUserOidFromReq(req);
        if (!viewerOid) {
            return res.status(400).json({ error: 'Unable to resolve authenticated user id' });
        }

        const pool = await getPool();
        await pool.request()
            .input('projectId', sql.Int, projectId)
            .input('viewerOid', sql.NVarChar(100), viewerOid)
            .query(`
                DELETE FROM ProjectWatchers
                WHERE projectId = @projectId AND userOid = @viewerOid
            `);

        invalidateProjectCache();
        logAudit({
            action: 'project.watch_remove',
            entityType: 'project',
            entityId: String(projectId),
            user: getAuthUser(req),
            metadata: { userOid: viewerOid },
            req
        });
        res.json({ success: true, isWatched: false });
    } catch (err) {
        handleError(res, 'removing project watch', err);
    }
});

// Get single project details (Full Data)
router.get('/:id', checkPermission('can_view_projects'), withSharedScope, checkProjectWriteAccess(), async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const viewerOid = getUserOidFromReq(req);
        const pool = await getPool();

        // Fetch project basic info
        const projectResult = await pool.request()
            .input('id', sql.Int, id)
            .query('SELECT * FROM Projects WHERE id = @id');

        if (projectResult.recordset.length === 0) {
            return res.status(404).json({ error: 'Project not found' });
        }
        const project = projectResult.recordset[0];
        const goalContextMap = await fetchProjectGoalContextMap(pool, req.orgId ?? null, [id]);
        const goalContext = goalContextMap.get(id) || {
            linkedGoalCount: 0,
            visibleGoalCount: 0
        };

        // Fetch project goals
        const goalsResult = await pool.request()
            .input('projectId', sql.Int, id)
            .query('SELECT goalId FROM ProjectGoals WHERE projectId = @projectId');
        const goalIds = goalsResult.recordset.map(r => r.goalId.toString());

        // Fetch all tasks with assignee/checklist metadata
        const tasksResult = await pool.request()
            .input('projectId', sql.Int, id)
            .query(`
                SELECT
                    t.*,
                    u.name AS assigneeName,
                    checklist.totalItems AS checklistTotal,
                    checklist.doneItems AS checklistDone
                FROM Tasks t
                LEFT JOIN Users u ON u.oid = t.assigneeOid
                OUTER APPLY (
                    SELECT
                        COUNT(*) AS totalItems,
                        SUM(CASE WHEN i.isDone = 1 THEN 1 ELSE 0 END) AS doneItems
                    FROM TaskChecklistItems i
                    WHERE i.taskId = t.id
                ) checklist
                WHERE t.projectId = @projectId
            `);

        // Fetch report count
        const reportsResult = await pool.request()
            .input('projectId', sql.Int, id)
            .query('SELECT COUNT(*) as count FROM StatusReports WHERE projectId = @projectId');

        // Fetch latest report
        const latestReportResult = await pool.request()
            .input('projectId', sql.Int, id)
            .query('SELECT TOP 1 * FROM StatusReports WHERE projectId = @projectId ORDER BY version DESC');

        let latestReport = null;
        if (latestReportResult.recordset.length > 0) {
            const r = latestReportResult.recordset[0];
            try {
                const data = JSON.parse(r.reportData || '{}');
                latestReport = {
                    id: r.id.toString(),
                    version: r.version,
                    createdAt: r.createdAt,
                    createdBy: r.createdBy,
                    ...data
                };
            } catch (e) {
                console.error("Failed to parse report data", e);
            }
        }

        // Calculate completion
        const tasks = tasksResult.recordset.map(t => ({
            id: t.id.toString(),
            title: t.title,
            status: t.status,
            priority: t.priority,
            description: t.description,
            startDate: t.startDate,
            endDate: t.endDate,
            assigneeOid: t.assigneeOid || null,
            assigneeName: t.assigneeName || null,
            blockerNote: t.blockerNote || null,
            checklistTotal: Number(t.checklistTotal || 0),
            checklistDone: Number(t.checklistDone || 0)
        }));

        const doneCount = tasks.filter(t => t.status === 'done').length;
        const completion = tasks.length > 0 ? Math.round((doneCount / tasks.length) * 100) : 0;

        let isWatched = false;
        if (viewerOid) {
            const watchResult = await pool.request()
                .input('projectId', sql.Int, id)
                .input('viewerOid', sql.NVarChar(100), viewerOid)
                .query(`
                    SELECT TOP 1 1 AS isWatched
                    FROM ProjectWatchers
                    WHERE projectId = @projectId AND userOid = @viewerOid
                `);
            isWatched = watchResult.recordset.length > 0;
        }

        res.json({
            id: project.id.toString(),
            title: project.title,
            description: project.description,
            status: project.status,
            orgId: project.orgId === null || project.orgId === undefined ? null : String(project.orgId),
            goalIds,
            goalId: goalIds[0] || null, // backwards compat
            createdAt: project.createdAt,
            completion,
            tasks,
            reportCount: reportsResult.recordset[0].count,
            latestReport,
            accessLevel: req.projectAccess || 'owner',
            hasWriteAccess: !!req.hasWriteAccess,
            linkedGoalCount: goalContext.linkedGoalCount,
            visibleGoalCount: goalContext.visibleGoalCount,
            goalContextStatus: mapGoalContextStatus(goalContext),
            goalContextMissing: goalContext.linkedGoalCount > 0 && goalContext.visibleGoalCount === 0,
            isWatched
        });
    } catch (err) {
        handleError(res, 'fetching project details', err);
    }
});

// Benefits realization + predictive risk summary
router.get('/:id/benefits-risk', checkPermission('can_view_projects'), withSharedScope, checkProjectWriteAccess(), async (req, res) => {
    try {
        const projectId = Number.parseInt(req.params.id, 10);
        if (Number.isNaN(projectId)) {
            return res.status(400).json({ error: 'Invalid project id' });
        }

        const pool = await getPool();
        const schemaReady = await hasProjectBenefitSchema(pool);
        const riskSignal = await buildProjectRiskSignal({ pool, projectId });

        let benefits = [];
        if (schemaReady) {
            const benefitResult = await pool.request()
                .input('projectId', sql.Int, projectId)
                .query(`
                    SELECT
                        b.*,
                        k.name AS linkedKpiName
                    FROM ProjectBenefitRealization b
                    LEFT JOIN KPIs k ON k.id = b.linkedKpiId
                    WHERE b.projectId = @projectId
                    ORDER BY
                        CASE b.status
                            WHEN 'at-risk' THEN 0
                            WHEN 'in-progress' THEN 1
                            WHEN 'planned' THEN 2
                            WHEN 'realized' THEN 3
                            ELSE 4
                        END,
                        CASE WHEN b.dueAt IS NULL THEN 1 ELSE 0 END,
                        b.dueAt ASC,
                        b.id DESC
                `);
            benefits = benefitResult.recordset.map(mapBenefitRow);
        }

        let governanceRationale = null;
        try {
            const governanceResult = await pool.request()
                .input('projectId', sql.Int, projectId)
                .query(`
                    SELECT TOP 1
                        s.id AS submissionId,
                        s.governanceDecision,
                        s.governanceReason,
                        gr.id AS reviewId,
                        gr.decisionReason AS reviewDecisionReason,
                        gr.decidedAt
                    FROM IntakeSubmissions s
                    LEFT JOIN GovernanceReview gr
                        ON gr.submissionId = s.id
                       AND gr.status = 'decided'
                    WHERE s.convertedProjectId = @projectId
                    ORDER BY
                        CASE WHEN gr.decidedAt IS NULL THEN 1 ELSE 0 END,
                        gr.decidedAt DESC,
                        s.submittedAt DESC
                `);
            const row = governanceResult.recordset[0];
            if (row) {
                governanceRationale = {
                    submissionId: String(row.submissionId),
                    governanceDecision: row.governanceDecision || null,
                    governanceReason: row.reviewDecisionReason || row.governanceReason || null,
                    reviewId: row.reviewId === null || row.reviewId === undefined ? null : String(row.reviewId),
                    decidedAt: row.decidedAt || null
                };
            }
        } catch {
            governanceRationale = null;
        }

        return res.json({
            schemaReady,
            benefits,
            riskSignal,
            governanceRationale
        });
    } catch (err) {
        handleError(res, 'fetching project benefits and risk summary', err);
    }
});

// Add benefit realization item
router.post('/:id/benefits', checkPermission('can_edit_project'), withSharedScope, checkProjectWriteAccess(), requireProjectWriteAccess, async (req, res) => {
    try {
        const projectId = Number.parseInt(req.params.id, 10);
        if (Number.isNaN(projectId)) {
            return res.status(400).json({ error: 'Invalid project id' });
        }

        const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
        if (!title) {
            return res.status(400).json({ error: 'title is required' });
        }

        const status = String(req.body?.status || 'planned').trim().toLowerCase();
        if (!BENEFIT_STATUSES.has(status)) {
            return res.status(400).json({ error: `Invalid status. Allowed: ${Array.from(BENEFIT_STATUSES).join(', ')}` });
        }

        const baselineValue = toNullableNumber(req.body?.baselineValue);
        const targetValue = toNullableNumber(req.body?.targetValue);
        const currentValue = toNullableNumber(req.body?.currentValue);
        const dueAt = toNullableDateOnly(req.body?.dueAt);
        const realizedAt = toNullableDateOnly(req.body?.realizedAt);
        const linkedKpiIdRaw = req.body?.linkedKpiId;
        const governanceReviewIdRaw = req.body?.governanceReviewId;

        if (req.body?.baselineValue !== undefined && req.body?.baselineValue !== null && req.body?.baselineValue !== '' && baselineValue === null) {
            return res.status(400).json({ error: 'baselineValue must be numeric' });
        }
        if (req.body?.targetValue !== undefined && req.body?.targetValue !== null && req.body?.targetValue !== '' && targetValue === null) {
            return res.status(400).json({ error: 'targetValue must be numeric' });
        }
        if (req.body?.currentValue !== undefined && req.body?.currentValue !== null && req.body?.currentValue !== '' && currentValue === null) {
            return res.status(400).json({ error: 'currentValue must be numeric' });
        }
        if (req.body?.dueAt !== undefined && req.body?.dueAt && !dueAt) {
            return res.status(400).json({ error: 'dueAt must be a valid date' });
        }
        if (req.body?.realizedAt !== undefined && req.body?.realizedAt && !realizedAt) {
            return res.status(400).json({ error: 'realizedAt must be a valid date' });
        }

        const linkedKpiId = linkedKpiIdRaw === undefined || linkedKpiIdRaw === null || linkedKpiIdRaw === ''
            ? null
            : Number.parseInt(linkedKpiIdRaw, 10);
        if (linkedKpiIdRaw !== undefined && linkedKpiIdRaw !== null && linkedKpiIdRaw !== '' && Number.isNaN(linkedKpiId)) {
            return res.status(400).json({ error: 'linkedKpiId must be numeric' });
        }

        const governanceReviewId = governanceReviewIdRaw === undefined || governanceReviewIdRaw === null || governanceReviewIdRaw === ''
            ? null
            : Number.parseInt(governanceReviewIdRaw, 10);
        if (governanceReviewIdRaw !== undefined && governanceReviewIdRaw !== null && governanceReviewIdRaw !== '' && Number.isNaN(governanceReviewId)) {
            return res.status(400).json({ error: 'governanceReviewId must be numeric' });
        }

        const governanceDecision = req.body?.governanceDecision === undefined || req.body?.governanceDecision === null || req.body?.governanceDecision === ''
            ? null
            : String(req.body.governanceDecision).trim().toLowerCase();
        if (governanceDecision && !['approved-now', 'approved-backlog', 'needs-info', 'rejected'].includes(governanceDecision)) {
            return res.status(400).json({ error: 'governanceDecision must be one of approved-now, approved-backlog, needs-info, rejected' });
        }

        const pool = await getPool();
        const schemaReady = await hasProjectBenefitSchema(pool);
        if (!schemaReady) {
            return res.status(409).json({ error: 'Project benefit schema is not installed. Run `npm run setup-db:full` in `server`.' });
        }

        const user = getAuthUser(req);
        const insert = await pool.request()
            .input('projectId', sql.Int, projectId)
            .input('title', sql.NVarChar(255), title)
            .input('description', sql.NVarChar(sql.MAX), req.body?.description || null)
            .input('linkedKpiId', sql.Int, linkedKpiId)
            .input('baselineValue', sql.Decimal(18, 2), baselineValue)
            .input('targetValue', sql.Decimal(18, 2), targetValue)
            .input('currentValue', sql.Decimal(18, 2), currentValue)
            .input('unit', sql.NVarChar(50), req.body?.unit || null)
            .input('status', sql.NVarChar(20), status)
            .input('dueAt', sql.Date, dueAt)
            .input('realizedAt', sql.Date, realizedAt)
            .input('governanceReviewId', sql.Int, governanceReviewId)
            .input('governanceDecision', sql.NVarChar(30), governanceDecision)
            .input('notes', sql.NVarChar(sql.MAX), req.body?.notes || null)
            .input('updatedByOid', sql.NVarChar(100), user?.oid || null)
            .query(`
                INSERT INTO ProjectBenefitRealization (
                    projectId, title, description, linkedKpiId, baselineValue, targetValue, currentValue, unit,
                    status, dueAt, realizedAt, governanceReviewId, governanceDecision, notes, updatedByOid
                )
                OUTPUT INSERTED.*
                VALUES (
                    @projectId, @title, @description, @linkedKpiId, @baselineValue, @targetValue, @currentValue, @unit,
                    @status, @dueAt, @realizedAt, @governanceReviewId, @governanceDecision, @notes, @updatedByOid
                )
            `);

        invalidateProjectCache();
        logAudit({
            action: 'project_benefit.create',
            entityType: 'project_benefit',
            entityId: String(insert.recordset[0].id),
            entityTitle: title,
            user,
            metadata: { projectId },
            after: { status, targetValue, currentValue, dueAt, governanceDecision },
            req
        });

        const row = insert.recordset[0];
        return res.json(mapBenefitRow({
            ...row,
            linkedKpiName: null
        }));
    } catch (err) {
        handleError(res, 'creating project benefit', err);
    }
});

// Update benefit realization item
router.put('/:id/benefits/:benefitId', checkPermission('can_edit_project'), withSharedScope, checkProjectWriteAccess(), requireProjectWriteAccess, async (req, res) => {
    try {
        const projectId = Number.parseInt(req.params.id, 10);
        const benefitId = Number.parseInt(req.params.benefitId, 10);
        if (Number.isNaN(projectId) || Number.isNaN(benefitId)) {
            return res.status(400).json({ error: 'Invalid project or benefit id' });
        }

        const pool = await getPool();
        const schemaReady = await hasProjectBenefitSchema(pool);
        if (!schemaReady) {
            return res.status(409).json({ error: 'Project benefit schema is not installed. Run `npm run setup-db:full` in `server`.' });
        }

        const existing = await pool.request()
            .input('benefitId', sql.Int, benefitId)
            .input('projectId', sql.Int, projectId)
            .query(`
                SELECT *
                FROM ProjectBenefitRealization
                WHERE id = @benefitId AND projectId = @projectId
            `);
        if (!existing.recordset.length) {
            return res.status(404).json({ error: 'Benefit item not found' });
        }

        const updates = [];
        const request = pool.request()
            .input('benefitId', sql.Int, benefitId)
            .input('projectId', sql.Int, projectId);

        if (req.body?.title !== undefined) {
            const title = String(req.body.title || '').trim();
            if (!title) {
                return res.status(400).json({ error: 'title cannot be empty' });
            }
            request.input('title', sql.NVarChar(255), title);
            updates.push('title = @title');
        }
        if (req.body?.description !== undefined) {
            request.input('description', sql.NVarChar(sql.MAX), req.body.description || null);
            updates.push('description = @description');
        }
        if (req.body?.status !== undefined) {
            const status = String(req.body.status || '').trim().toLowerCase();
            if (!BENEFIT_STATUSES.has(status)) {
                return res.status(400).json({ error: `Invalid status. Allowed: ${Array.from(BENEFIT_STATUSES).join(', ')}` });
            }
            request.input('status', sql.NVarChar(20), status);
            updates.push('status = @status');
        }

        const applyNumericField = (fieldName, sqlName) => {
            if (req.body?.[fieldName] === undefined) return null;
            const parsed = toNullableNumber(req.body[fieldName]);
            if (req.body[fieldName] !== null && req.body[fieldName] !== '' && parsed === null) {
                throw new Error(`${fieldName} must be numeric`);
            }
            request.input(sqlName, sql.Decimal(18, 2), parsed);
            updates.push(`${fieldName} = @${sqlName}`);
            return null;
        };

        const applyDateField = (fieldName, sqlName) => {
            if (req.body?.[fieldName] === undefined) return null;
            const parsed = toNullableDateOnly(req.body[fieldName]);
            if (req.body[fieldName] && !parsed) {
                throw new Error(`${fieldName} must be a valid date`);
            }
            request.input(sqlName, sql.Date, parsed);
            updates.push(`${fieldName} = @${sqlName}`);
            return null;
        };

        try {
            applyNumericField('baselineValue', 'baselineValue');
            applyNumericField('targetValue', 'targetValue');
            applyNumericField('currentValue', 'currentValue');
            applyDateField('dueAt', 'dueAt');
            applyDateField('realizedAt', 'realizedAt');
        } catch (validationErr) {
            return res.status(400).json({ error: validationErr.message });
        }

        if (req.body?.linkedKpiId !== undefined) {
            const linkedKpiId = req.body.linkedKpiId === null || req.body.linkedKpiId === ''
                ? null
                : Number.parseInt(req.body.linkedKpiId, 10);
            if (req.body.linkedKpiId !== null && req.body.linkedKpiId !== '' && Number.isNaN(linkedKpiId)) {
                return res.status(400).json({ error: 'linkedKpiId must be numeric' });
            }
            request.input('linkedKpiId', sql.Int, linkedKpiId);
            updates.push('linkedKpiId = @linkedKpiId');
        }

        if (req.body?.governanceReviewId !== undefined) {
            const governanceReviewId = req.body.governanceReviewId === null || req.body.governanceReviewId === ''
                ? null
                : Number.parseInt(req.body.governanceReviewId, 10);
            if (req.body.governanceReviewId !== null && req.body.governanceReviewId !== '' && Number.isNaN(governanceReviewId)) {
                return res.status(400).json({ error: 'governanceReviewId must be numeric' });
            }
            request.input('governanceReviewId', sql.Int, governanceReviewId);
            updates.push('governanceReviewId = @governanceReviewId');
        }

        if (req.body?.governanceDecision !== undefined) {
            const governanceDecision = req.body.governanceDecision === null || req.body.governanceDecision === ''
                ? null
                : String(req.body.governanceDecision).trim().toLowerCase();
            if (governanceDecision && !['approved-now', 'approved-backlog', 'needs-info', 'rejected'].includes(governanceDecision)) {
                return res.status(400).json({ error: 'governanceDecision must be one of approved-now, approved-backlog, needs-info, rejected' });
            }
            request.input('governanceDecision', sql.NVarChar(30), governanceDecision);
            updates.push('governanceDecision = @governanceDecision');
        }

        if (req.body?.notes !== undefined) {
            request.input('notes', sql.NVarChar(sql.MAX), req.body.notes || null);
            updates.push('notes = @notes');
        }
        if (req.body?.unit !== undefined) {
            request.input('unit', sql.NVarChar(50), req.body.unit || null);
            updates.push('unit = @unit');
        }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'No changes provided' });
        }

        const user = getAuthUser(req);
        request.input('updatedByOid', sql.NVarChar(100), user?.oid || null);
        updates.push('updatedByOid = @updatedByOid');
        updates.push('updatedAt = GETDATE()');

        await request.query(`
            UPDATE ProjectBenefitRealization
            SET ${updates.join(', ')}
            WHERE id = @benefitId AND projectId = @projectId
        `);

        const updated = await pool.request()
            .input('benefitId', sql.Int, benefitId)
            .input('projectId', sql.Int, projectId)
            .query(`
                SELECT b.*, k.name AS linkedKpiName
                FROM ProjectBenefitRealization b
                LEFT JOIN KPIs k ON k.id = b.linkedKpiId
                WHERE b.id = @benefitId AND b.projectId = @projectId
            `);

        invalidateProjectCache();
        logAudit({
            action: 'project_benefit.update',
            entityType: 'project_benefit',
            entityId: String(benefitId),
            entityTitle: updated.recordset[0]?.title || existing.recordset[0]?.title || 'Benefit',
            user,
            metadata: { projectId },
            req
        });

        return res.json(mapBenefitRow(updated.recordset[0]));
    } catch (err) {
        handleError(res, 'updating project benefit', err);
    }
});

// Delete benefit realization item
router.delete('/:id/benefits/:benefitId', checkPermission('can_edit_project'), withSharedScope, checkProjectWriteAccess(), requireProjectWriteAccess, async (req, res) => {
    try {
        const projectId = Number.parseInt(req.params.id, 10);
        const benefitId = Number.parseInt(req.params.benefitId, 10);
        if (Number.isNaN(projectId) || Number.isNaN(benefitId)) {
            return res.status(400).json({ error: 'Invalid project or benefit id' });
        }

        const pool = await getPool();
        const schemaReady = await hasProjectBenefitSchema(pool);
        if (!schemaReady) {
            return res.status(409).json({ error: 'Project benefit schema is not installed. Run `npm run setup-db:full` in `server`.' });
        }

        const existing = await pool.request()
            .input('benefitId', sql.Int, benefitId)
            .input('projectId', sql.Int, projectId)
            .query(`
                SELECT id, title
                FROM ProjectBenefitRealization
                WHERE id = @benefitId AND projectId = @projectId
            `);
        if (!existing.recordset.length) {
            return res.status(404).json({ error: 'Benefit item not found' });
        }

        await pool.request()
            .input('benefitId', sql.Int, benefitId)
            .input('projectId', sql.Int, projectId)
            .query('DELETE FROM ProjectBenefitRealization WHERE id = @benefitId AND projectId = @projectId');

        invalidateProjectCache();
        logAudit({
            action: 'project_benefit.delete',
            entityType: 'project_benefit',
            entityId: String(benefitId),
            entityTitle: existing.recordset[0]?.title || 'Benefit',
            user: getAuthUser(req),
            metadata: { projectId },
            req
        });

        return res.json({ success: true });
    } catch (err) {
        handleError(res, 'deleting project benefit', err);
    }
});

// Create project
router.post('/', checkPermission('can_create_project'), async (req, res) => {
    try {
        const { title, description, status } = req.body;
        const normalizedTitle = typeof title === 'string' ? title.trim() : '';
        if (!normalizedTitle) {
            return res.status(400).json({ error: 'title is required' });
        }
        const { parsed: parsedGoalIds, invalid: invalidGoalIds } = parseGoalIdsFromBody(req.body);

        if (invalidGoalIds.length > 0) {
            return res.status(400).json({
                error: `Invalid goal id(s): ${invalidGoalIds.join(', ')}`
            });
        }

        const pool = await getPool();
        let ownerOrgId;
        try {
            ownerOrgId = resolveOwnedOrgId({
                user: req.user,
                requestedOrgId: req.body?.orgId,
                missingUserOrgMessage: 'No organization assigned. Contact your administrator to create projects.',
                adminOrgRequiredMessage: 'orgId is required for admin-created projects'
            });
            await ensureOrganizationExists(pool, ownerOrgId);
        } catch (orgErr) {
            const message = orgErr?.message || 'Unable to resolve project organization';
            const statusCode = message.toLowerCase().includes('no organization assigned') ? 403 : 400;
            return res.status(statusCode).json({ error: message });
        }

        const missingGoalIds = await findMissingGoalIds(pool, parsedGoalIds);
        if (missingGoalIds.length > 0) {
            return res.status(400).json({
                error: `Goal id(s) not found: ${missingGoalIds.join(', ')}`
            });
        }

        // Validate hierarchy
        if (parsedGoalIds.length > 1) {
            const allGoals = await loadGoalsForValidation();
            const validation = validateGoalAssignment(allGoals, parsedGoalIds);
            if (!validation.valid) {
                return res.status(400).json({ error: validation.error });
            }
        }

        const goalAccessGaps = await findGoalAccessGapsForOrg({
            dbOrTx: pool,
            goalIds: parsedGoalIds,
            orgId: ownerOrgId
        });
        if (goalAccessGaps.length > 0) {
            const goalTitles = goalAccessGaps.map((goal) => goal.title);
            return res.status(409).json({
                error: `Selected goals are not visible to the project organization: ${goalTitles.join(', ')}`
            });
        }

        const result = await pool.request()
            .input('title', sql.NVarChar, normalizedTitle)
            .input('description', sql.NVarChar(sql.MAX), description)
            .input('status', sql.NVarChar, status || 'active')
            .input('orgId', sql.Int, ownerOrgId)
            .query('INSERT INTO Projects (title, description, status, orgId) OUTPUT INSERTED.id VALUES (@title, @description, @status, @orgId)');

        const newId = result.recordset[0].id;

        // Insert goal associations
        for (const gId of parsedGoalIds) {
            await pool.request()
                .input('projectId', sql.Int, newId)
                .input('goalId', sql.Int, gId)
                .query('INSERT INTO ProjectGoals (projectId, goalId) VALUES (@projectId, @goalId)');
        }

        invalidateProjectCache();
        logAudit({ action: 'project.create', entityType: 'project', entityId: newId.toString(), entityTitle: normalizedTitle, user: getAuthUser(req), after: { title: normalizedTitle, description, status: status || 'active', orgId: ownerOrgId, goalIds: parsedGoalIds }, req });
        res.json({
            id: newId.toString(),
            title: normalizedTitle,
            description,
            status: status || 'active',
            orgId: String(ownerOrgId),
            goalIds: parsedGoalIds.map(String),
            goalId: parsedGoalIds[0]?.toString() || null,
            linkedGoalCount: parsedGoalIds.length,
            visibleGoalCount: parsedGoalIds.length,
            goalContextStatus: mapGoalContextStatus({ linkedGoalCount: parsedGoalIds.length, visibleGoalCount: parsedGoalIds.length }),
            goalContextMissing: false,
            accessLevel: 'owner',
            hasWriteAccess: true,
            tasks: [],
            statusReports: []
        });
    } catch (err) {
        handleError(res, 'creating project', err);
    }
});

// Update project
router.put('/:id', checkPermission('can_edit_project'), withSharedScope, checkProjectWriteAccess(), requireProjectWriteAccess, async (req, res) => {
    try {
        const { title, description, status } = req.body;
        if (!title) {
            return res.status(400).json({ error: 'Missing required field: title' });
        }
        const id = parseInt(req.params.id, 10);
        if (Number.isNaN(id)) {
            return res.status(400).json({ error: 'Invalid project id' });
        }

        const { parsed: parsedGoalIds, invalid: invalidGoalIds } = parseGoalIdsFromBody(req.body);
        if (invalidGoalIds.length > 0) {
            return res.status(400).json({
                error: `Invalid goal id(s): ${invalidGoalIds.join(', ')}`
            });
        }

        const pool = await getPool();
        const missingGoalIds = await findMissingGoalIds(pool, parsedGoalIds);
        if (missingGoalIds.length > 0) {
            return res.status(400).json({
                error: `Goal id(s) not found: ${missingGoalIds.join(', ')}`
            });
        }

        // Validate hierarchy
        if (parsedGoalIds.length > 1) {
            const allGoals = await loadGoalsForValidation();
            const validation = validateGoalAssignment(allGoals, parsedGoalIds);
            if (!validation.valid) {
                return res.status(400).json({ error: validation.error });
            }
        }

        const prev = await pool.request().input('id', sql.Int, id).query('SELECT title, description, status, orgId FROM Projects WHERE id = @id');
        if (prev.recordset.length === 0) {
            return res.status(404).json({ error: 'Project not found' });
        }
        const beforeState = prev.recordset[0];
        const beforeOrgId = beforeState.orgId === null || beforeState.orgId === undefined
            ? null
            : Number(beforeState.orgId);
        const hasOrgIdInput = Object.prototype.hasOwnProperty.call(req.body || {}, 'orgId');
        let projectOrgId = beforeOrgId;

        if (hasOrgIdInput) {
            if (!isAdminUser(req.user)) {
                return res.status(403).json({ error: 'Only admins can change a project organization' });
            }
            try {
                projectOrgId = resolveOwnedOrgId({
                    user: req.user,
                    requestedOrgId: req.body?.orgId,
                    missingUserOrgMessage: 'No organization assigned. Contact your administrator to update project ownership.',
                    adminOrgRequiredMessage: 'orgId is required when updating a project without an owner organization'
                });
                await ensureOrganizationExists(pool, projectOrgId);
            } catch (orgErr) {
                return res.status(400).json({ error: orgErr?.message || 'Unable to resolve project organization' });
            }
        }

        if (projectOrgId === null || projectOrgId === undefined) {
            return res.status(409).json({
                error: 'Project organization is not assigned. Run the org ownership backfill or provide orgId as an admin.'
            });
        }

        const ownershipChanged = hasOrgIdInput && beforeOrgId !== projectOrgId;
        let ensuredGoalContext = {
            linkedGoalCount: 0,
            insertedGoalCount: 0,
            refreshedExpiredGoalCount: 0
        };

        if (ownershipChanged && parsedGoalIds.length > 0) {
            ensuredGoalContext = await ensureReadGoalAccessForOrg({
                dbOrTx: pool,
                goalIds: parsedGoalIds,
                orgId: projectOrgId,
                grantedByOid: req.user?.oid || null
            });
        }

        const goalAccessGaps = await findGoalAccessGapsForOrg({
            dbOrTx: pool,
            goalIds: parsedGoalIds,
            orgId: projectOrgId
        });
        if (goalAccessGaps.length > 0) {
            const goalTitles = goalAccessGaps.map((goal) => goal.title);
            return res.status(409).json({
                error: `Selected goals are not visible to the project organization: ${goalTitles.join(', ')}`
            });
        }

        // Update project fields
        const projectUpdateRequest = pool.request()
            .input('id', sql.Int, id)
            .input('title', sql.NVarChar, title)
            .input('description', sql.NVarChar(sql.MAX), description)
            .input('status', sql.NVarChar, status);

        if (hasOrgIdInput) {
            projectUpdateRequest.input('orgId', sql.Int, projectOrgId);
        }

        await projectUpdateRequest.query(`
            UPDATE Projects
            SET title = @title,
                description = @description,
                status = @status
                ${hasOrgIdInput ? ', orgId = @orgId' : ''}
            WHERE id = @id
        `);

        if (ownershipChanged) {
            await pool.request()
                .input('projectId', sql.Int, id)
                .input('orgId', sql.Int, projectOrgId)
                .query(`
                    DELETE FROM ProjectOrgAccess
                    WHERE projectId = @projectId
                      AND orgId = @orgId
                `);
        }

        // Replace goal associations (ownership-aware for shared users)
        const isSharedUser = !isAdminUser(req.user) && req.orgId !== undefined && req.orgId !== null && Number(req.orgId) !== Number(projectOrgId);

        if (isSharedUser) {
            // Shared users: only replace goals belonging to their own org, preserve owner-org goals
            const existingGoals = await pool.request()
                .input('projectId', sql.Int, id)
                .query(`
                    SELECT pg.goalId, g.orgId
                    FROM ProjectGoals pg
                    INNER JOIN Goals g ON g.id = pg.goalId
                    WHERE pg.projectId = @projectId
                `);

            // Owner-org goals that must be preserved
            const ownerOrgGoalIds = existingGoals.recordset
                .filter(row => Number(row.orgId) === Number(projectOrgId))
                .map(row => Number(row.goalId));

            // Delete only the shared user's org goals (non-owner goals)
            const userOrgGoalIds = existingGoals.recordset
                .filter(row => Number(row.orgId) !== Number(projectOrgId))
                .map(row => Number(row.goalId));

            for (const gId of userOrgGoalIds) {
                await pool.request()
                    .input('projectId', sql.Int, id)
                    .input('goalId', sql.Int, gId)
                    .query('DELETE FROM ProjectGoals WHERE projectId = @projectId AND goalId = @goalId');
            }

            // Insert goals from request that are NOT already owner-org goals
            for (const gId of parsedGoalIds) {
                if (!ownerOrgGoalIds.includes(gId)) {
                    await pool.request()
                        .input('projectId', sql.Int, id)
                        .input('goalId', sql.Int, gId)
                        .query('INSERT INTO ProjectGoals (projectId, goalId) VALUES (@projectId, @goalId)');
                }
            }
        } else {
            // Owner-org users and admins: full replace
            await pool.request().input('projectId', sql.Int, id)
                .query('DELETE FROM ProjectGoals WHERE projectId = @projectId');

            for (const gId of parsedGoalIds) {
                await pool.request()
                    .input('projectId', sql.Int, id)
                    .input('goalId', sql.Int, gId)
                    .query('INSERT INTO ProjectGoals (projectId, goalId) VALUES (@projectId, @goalId)');
            }
        }

        invalidateProjectCache();
        logAudit({
            action: ownershipChanged ? 'project.transfer_ownership' : 'project.update',
            entityType: 'project',
            entityId: id,
            entityTitle: title,
            user: getAuthUser(req),
            before: beforeState,
            after: {
                title,
                description,
                status,
                orgId: projectOrgId,
                goalIds: parsedGoalIds,
                ensuredGoalContext
            },
            req
        });
        res.json({ success: true });
    } catch (err) {
        handleError(res, 'updating project', err);
    }
});

// Delete project
router.delete('/:id', checkPermission('can_delete_project'), withSharedScope, checkProjectWriteAccess(), requireProjectWriteAccess, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const pool = await getPool();
        const prev = await pool.request().input('id', sql.Int, id).query('SELECT title, status FROM Projects WHERE id = @id');
        await pool.request()
            .input('id', sql.Int, id)
            .query('DELETE FROM Projects WHERE id = @id');

        invalidateProjectCache();
        logAudit({ action: 'project.delete', entityType: 'project', entityId: id, entityTitle: prev.recordset[0]?.title, user: getAuthUser(req), before: prev.recordset[0], req });
        res.json({ success: true });
    } catch (err) {
        handleError(res, 'deleting project', err);
    }
});

// Set tags for a project
router.put('/:id/tags', checkPermission('can_edit_project'), withSharedScope, checkProjectWriteAccess(), requireProjectWriteAccess, async (req, res) => {
    try {
        const projectId = parseInt(req.params.id);
        const { tags } = req.body; // Array of { tagId, isPrimary }

        if (!Array.isArray(tags)) return res.status(400).json({ error: 'tags must be an array' });
        if (tags.length > 8) return res.status(400).json({ error: 'Maximum 8 tags per project' });

        const pool = await getPool();

        // Fetch tag group info for validation
        const tagGroupsResult = await pool.request().query('SELECT * FROM TagGroups');
        const tagsResult = await pool.request().query('SELECT id, groupId, status FROM Tags');

        const tagGroupMap = {};
        tagGroupsResult.recordset.forEach(g => { tagGroupMap[g.id] = g; });

        const tagMap = {};
        tagsResult.recordset.forEach(t => { tagMap[t.id] = t; });

        // Validate each tag
        for (const entry of tags) {
            const tag = tagMap[parseInt(entry.tagId)];
            if (!tag) return res.status(400).json({ error: `Tag ${entry.tagId} not found` });
            if (tag.status === 'deprecated') return res.status(400).json({ error: `Tag "${entry.tagId}" is deprecated and cannot be assigned` });
        }

        // Validate primary tags
        const primaryByGroup = {};
        for (const entry of tags) {
            const tag = tagMap[parseInt(entry.tagId)];
            const group = tagGroupMap[tag.groupId];
            if (entry.isPrimary) {
                if (primaryByGroup[tag.groupId]) {
                    return res.status(400).json({ error: `Group "${group.name}" can have only one primary tag` });
                }
                primaryByGroup[tag.groupId] = true;
            }
        }

        // Transaction
        const transaction = pool.transaction();
        await transaction.begin();
        try {
            await transaction.request()
                .input('projectId', sql.Int, projectId)
                .query('DELETE FROM ProjectTags WHERE projectId = @projectId');

            for (let i = 0; i < tags.length; i++) {
                await transaction.request()
                    .input(`projectId${i}`, sql.Int, projectId)
                    .input(`tagId${i}`, sql.Int, parseInt(tags[i].tagId))
                    .input(`isPrimary${i}`, sql.Bit, tags[i].isPrimary ? 1 : 0)
                    .query(`INSERT INTO ProjectTags (projectId, tagId, isPrimary) VALUES (@projectId${i}, @tagId${i}, @isPrimary${i})`);
            }

            await transaction.commit();
        } catch (txErr) {
            await transaction.rollback();
            throw txErr;
        }

        invalidateProjectCache();
        logAudit({ action: 'project.tags_update', entityType: 'project', entityId: projectId, entityTitle: `${tags.length} tags`, user: getAuthUser(req), after: { tags }, req });
        res.json({ success: true });
    } catch (err) {
        handleError(res, 'updating project tags', err);
    }
});

// Add task to project
router.post('/:projectId/tasks', checkPermission('can_edit_project'), withSharedScope, checkProjectWriteAccess((req) => req.params.projectId), requireProjectWriteAccess, async (req, res) => {
    try {
        const { title, status, priority, description, startDate, endDate, assigneeOid, blockerNote } = req.body;
        const normalizedTitle = typeof title === 'string' ? title.trim() : '';
        if (!normalizedTitle) {
            return res.status(400).json({ error: 'Missing required field: title' });
        }

        const normalizedStatus = String(status || 'todo').trim().toLowerCase();
        if (!TASK_STATUSES.has(normalizedStatus)) {
            return res.status(400).json({ error: `Invalid task status. Allowed: ${Array.from(TASK_STATUSES).join(', ')}` });
        }

        const normalizedPriority = String(priority || 'medium').trim().toLowerCase();
        if (!TASK_PRIORITIES.has(normalizedPriority)) {
            return res.status(400).json({ error: `Invalid task priority. Allowed: ${Array.from(TASK_PRIORITIES).join(', ')}` });
        }

        const normalizedStartDate = normalizeTaskDate(startDate);
        const normalizedEndDate = normalizeTaskDate(endDate);

        if (startDate && !normalizedStartDate) {
            return res.status(400).json({ error: 'Invalid startDate. Use YYYY-MM-DD or ISO date format.' });
        }
        if (endDate && !normalizedEndDate) {
            return res.status(400).json({ error: 'Invalid endDate. Use YYYY-MM-DD or ISO date format.' });
        }
        if (normalizedStartDate && normalizedEndDate && normalizedEndDate < normalizedStartDate) {
            return res.status(400).json({ error: 'endDate cannot be earlier than startDate.' });
        }

        const pool = await getPool();
        const normalizedAssigneeOid = normalizeTaskString(assigneeOid, 100);
        let assigneeName = null;
        if (normalizedAssigneeOid) {
            const assigneeResult = await pool.request()
                .input('oid', sql.NVarChar(100), normalizedAssigneeOid)
                .query('SELECT TOP 1 oid, name, orgId FROM Users WHERE oid = @oid');
            if (!assigneeResult.recordset.length) {
                return res.status(400).json({ error: 'Assignee not found.' });
            }
            const assignee = assigneeResult.recordset[0];
            if (req.orgId && assignee.orgId && assignee.orgId !== req.orgId) {
                return res.status(400).json({ error: 'Assignee must belong to your organization.' });
            }
            assigneeName = assignee.name || null;
        }

        const normalizedDescription = description === undefined || description === null ? '' : String(description);
        const normalizedBlockerNote = normalizeTaskString(blockerNote, 1000);
        const persistedBlockerNote = normalizedStatus === 'blocked' ? normalizedBlockerNote : null;

        const result = await pool.request()
            .input('projectId', sql.Int, parseInt(req.params.projectId))
            .input('title', sql.NVarChar, normalizedTitle)
            .input('status', sql.NVarChar, normalizedStatus)
            .input('priority', sql.NVarChar, normalizedPriority)
            .input('description', sql.NVarChar(sql.MAX), normalizedDescription)
            .input('startDate', sql.Date, normalizedStartDate)
            .input('endDate', sql.Date, normalizedEndDate)
            .input('assigneeOid', sql.NVarChar(100), normalizedAssigneeOid)
            .input('blockerNote', sql.NVarChar(1000), persistedBlockerNote)
            .query(`
                INSERT INTO Tasks (projectId, title, status, priority, description, startDate, endDate, assigneeOid, blockerNote)
                OUTPUT INSERTED.id
                VALUES (@projectId, @title, @status, @priority, @description, @startDate, @endDate, @assigneeOid, @blockerNote)
            `);

        invalidateProjectCache();
        const newId = result.recordset[0].id.toString();
        logAudit({
            action: 'task.create',
            entityType: 'task',
            entityId: newId,
            entityTitle: normalizedTitle,
            user: getAuthUser(req),
            after: {
                title: normalizedTitle,
                status: normalizedStatus,
                priority: normalizedPriority,
                startDate: normalizedStartDate,
                endDate: normalizedEndDate,
                assigneeOid: normalizedAssigneeOid,
                blockerNote: persistedBlockerNote
            },
            metadata: { projectId: req.params.projectId },
            req
        });
        res.json({
            id: newId,
            title: normalizedTitle,
            status: normalizedStatus,
            priority: normalizedPriority,
            description: normalizedDescription,
            startDate: normalizedStartDate,
            endDate: normalizedEndDate,
            assigneeOid: normalizedAssigneeOid,
            assigneeName,
            blockerNote: persistedBlockerNote,
            checklistTotal: 0,
            checklistDone: 0
        });
    } catch (err) {
        handleError(res, 'creating task', err);
    }
});

// Get status reports for a project
router.get('/:projectId/reports', checkPermission(['can_view_projects', 'can_view_exec_dashboard']), withSharedScope, checkProjectWriteAccess((req) => req.params.projectId), async (req, res) => {
    try {
        const projectId = parseInt(req.params.projectId);
        const pool = await getPool();
        const result = await pool.request()
            .input('projectId', sql.Int, projectId)
            .query('SELECT * FROM StatusReports WHERE projectId = @projectId ORDER BY version DESC');

        const reports = result.recordset.map(r => ({
            id: r.id.toString(),
            version: r.version,
            createdBy: r.createdBy,
            createdAt: r.createdAt,
            restoredFrom: r.restoredFrom,
            ...JSON.parse(r.reportData || '{}')
        }));

        res.json(reports);
    } catch (err) {
        handleError(res, 'fetching status reports', err);
    }
});

// Add status report to project
router.post('/:projectId/reports', checkPermission('can_create_status_reports'), withSharedScope, checkProjectWriteAccess((req) => req.params.projectId), requireProjectWriteAccess, async (req, res) => {
    try {
        const { reportData, restoredFrom } = req.body;
        const authUser = getAuthUser(req);
        const createdBy = authUser?.name || authUser?.email || authUser?.oid || 'Unknown User';

        if (!req.params.projectId || !reportData) {
            return res.status(400).json({ error: 'Missing required fields: projectId, reportData' });
        }

        const pool = await getPool();

        // Get next version number
        const versionResult = await pool.request()
            .input('projectId', sql.Int, parseInt(req.params.projectId))
            .query('SELECT ISNULL(MAX(version), 0) + 1 as nextVersion FROM StatusReports WHERE projectId = @projectId');

        const nextVersion = versionResult.recordset[0].nextVersion;

        const result = await pool.request()
            .input('projectId', sql.Int, parseInt(req.params.projectId))
            .input('version', sql.Int, nextVersion)
            .input('reportData', sql.NVarChar, JSON.stringify(reportData))
            .input('createdBy', sql.NVarChar, createdBy)
            .input('restoredFrom', sql.Int, restoredFrom || null)
            .query('INSERT INTO StatusReports (projectId, version, reportData, createdBy, restoredFrom) OUTPUT INSERTED.id, INSERTED.createdAt VALUES (@projectId, @version, @reportData, @createdBy, @restoredFrom)');

        invalidateProjectCache();
        const newReportId = result.recordset[0].id.toString();
        logAudit({ action: 'report.create', entityType: 'report', entityId: newReportId, entityTitle: `v${nextVersion}`, user: getAuthUser(req), after: { version: nextVersion, createdBy, restoredFrom }, metadata: { projectId: req.params.projectId }, req });
        res.json({
            id: result.recordset[0].id.toString(),
            version: nextVersion,
            createdBy,
            createdAt: result.recordset[0].createdAt,
            restoredFrom,
            ...reportData
        });
    } catch (err) {
        handleError(res, 'creating status report', err);
    }
});

// Get project-scoped activity feed
router.get('/:id/activity', checkPermission('can_view_projects'), withSharedScope, checkProjectWriteAccess(), async (req, res) => {
    try {
        const projectId = req.params.id;
        const page = parseInt(req.query.page) || 1;
        let limit = parseInt(req.query.limit) || 30;
        if (limit > 100) limit = 100;
        const offset = (page - 1) * limit;

        const pool = await getPool();

        // Fetch activity for the project itself + its tasks + its reports + its tags
        const countResult = await pool.request()
            .input('projectId', sql.NVarChar(20), projectId)
            .query(`
                SELECT COUNT(*) as total FROM AuditLog
                WHERE (entityType = 'project' AND entityId = @projectId)
                   OR (entityType IN ('task', 'report') AND JSON_VALUE(metadata, '$.projectId') = @projectId)
                   OR (entityType = 'project' AND entityId = @projectId AND action = 'project.tags_update')
            `);

        const total = countResult.recordset[0].total;

        const dataResult = await pool.request()
            .input('projectId', sql.NVarChar(20), projectId)
            .input('offset', sql.Int, offset)
            .input('limit', sql.Int, limit)
            .query(`
                SELECT id, action, entityType, entityId, entityTitle, userName, createdAt
                FROM AuditLog
                WHERE (entityType = 'project' AND entityId = @projectId)
                   OR (entityType IN ('task', 'report') AND JSON_VALUE(metadata, '$.projectId') = @projectId)
                ORDER BY createdAt DESC
                OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
            `);

        res.json({
            entries: dataResult.recordset.map(r => ({
                id: r.id.toString(),
                action: r.action,
                entityType: r.entityType,
                entityId: r.entityId,
                entityTitle: r.entityTitle,
                userName: r.userName,
                createdAt: r.createdAt
            })),
            pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
        });
    } catch (err) {
        handleError(res, 'fetching project activity', err);
    }
});

export default router;
