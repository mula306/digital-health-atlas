import express from 'express';
import { getPool, sql } from '../db.js';
import { checkPermission, getAuthUser } from '../middleware/authMiddleware.js';
import { requireOrg, withSharedScope, checkProjectWriteAccess, requireProjectWriteAccess } from '../middleware/orgScope.js';
import { handleError } from '../utils/errorHandler.js';
import { logAudit } from '../utils/auditLogger.js';
import { cache, CACHE_KEYS, invalidateProjectCache } from '../utils/cache.js';
import { buildInClause, addParams } from '../utils/sqlHelpers.js';
import { validateGoalAssignment, loadGoalsForValidation } from '../utils/goalValidation.js';

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
            WHERE (p.orgId = @orgId OR p.id IN (SELECT projectId FROM ProjectOrgAccess WHERE orgId = @orgId) OR @orgId IS NULL)
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

        // 2c. Fetch task completion stats
        const taskStatsResult = await pool.request().query(`
            SELECT projectId, COUNT(*) AS taskCount, SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS doneCount
            FROM Tasks
            GROUP BY projectId
        `);
        const taskStatsByProject = new Map();
        taskStatsResult.recordset.forEach((row) => {
            taskStatsByProject.set(row.projectId, {
                taskCount: Number(row.taskCount || 0),
                doneCount: Number(row.doneCount || 0)
            });
        });

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

            const taskStats = taskStatsByProject.get(p.id) || { taskCount: 0, doneCount: 0 };
            const completion = taskStats.taskCount > 0
                ? Math.round((taskStats.doneCount / taskStats.taskCount) * 100)
                : 0;

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
            viewerOid
        };
        const countParams = {
            viewerOid
        };

        // Build WHERE clause for filtering
        const conditions = [];
        if (req.orgId) {
            conditions.push('(p.orgId = @orgId OR p.id IN (SELECT projectId FROM ProjectOrgAccess WHERE orgId = @orgId))');
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
                p.createdAt,
                CAST(CASE WHEN pw.projectId IS NULL THEN 0 ELSE 1 END AS BIT) AS isWatched
            FROM Projects p
            ${tagJoin}
            ${statusJoin}
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
            tasksRequest.query(`SELECT projectId, id, title, status, endDate FROM Tasks WHERE projectId IN (${idInClause})`),
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
                    endDate: t.endDate
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
            return {
                id: project.id.toString(),
                title: project.title,
                description: project.description,
                status: project.status || 'active',
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
                  AND (p.orgId = @orgId OR p.id IN (SELECT projectId FROM ProjectOrgAccess WHERE orgId = @orgId) OR @orgId IS NULL)
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

        // Fetch project goals
        const goalsResult = await pool.request()
            .input('projectId', sql.Int, id)
            .query('SELECT goalId FROM ProjectGoals WHERE projectId = @projectId');
        const goalIds = goalsResult.recordset.map(r => r.goalId.toString());

        // Fetch all tasks
        const tasksResult = await pool.request()
            .input('projectId', sql.Int, id)
            .query('SELECT * FROM Tasks WHERE projectId = @projectId');

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
            endDate: t.endDate
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
            goalIds,
            goalId: goalIds[0] || null, // backwards compat
            createdAt: project.createdAt,
            completion,
            tasks,
            reportCount: reportsResult.recordset[0].count,
            latestReport,
            isWatched
        });
    } catch (err) {
        handleError(res, 'fetching project details', err);
    }
});

// Create project
router.post('/', checkPermission('can_create_project'), requireOrg, async (req, res) => {
    try {
        const { title, description, status } = req.body;
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

        const result = await pool.request()
            .input('title', sql.NVarChar, title)
            .input('description', sql.NVarChar(sql.MAX), description)
            .input('status', sql.NVarChar, status || 'active')
            .input('orgId', sql.Int, req.orgId)
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
        logAudit({ action: 'project.create', entityType: 'project', entityId: newId.toString(), entityTitle: title, user: getAuthUser(req), after: { title, description, goalIds: parsedGoalIds }, req });
        res.json({ id: newId.toString(), title, description, goalIds: parsedGoalIds.map(String), goalId: parsedGoalIds[0]?.toString() || null, tasks: [], statusReports: [] });
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
        const id = parseInt(req.params.id);

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

        const prev = await pool.request().input('id', sql.Int, id).query('SELECT title, description, status FROM Projects WHERE id = @id');
        const beforeState = prev.recordset[0];

        // Update project fields
        await pool.request()
            .input('id', sql.Int, id)
            .input('title', sql.NVarChar, title)
            .input('description', sql.NVarChar(sql.MAX), description)
            .input('status', sql.NVarChar, status)
            .query('UPDATE Projects SET title = @title, description = @description, status = @status WHERE id = @id');

        // Replace goal associations
        await pool.request().input('projectId', sql.Int, id)
            .query('DELETE FROM ProjectGoals WHERE projectId = @projectId');

        for (const gId of parsedGoalIds) {
            await pool.request()
                .input('projectId', sql.Int, id)
                .input('goalId', sql.Int, gId)
                .query('INSERT INTO ProjectGoals (projectId, goalId) VALUES (@projectId, @goalId)');
        }

        invalidateProjectCache();
        logAudit({ action: 'project.update', entityType: 'project', entityId: id, entityTitle: title, user: getAuthUser(req), before: beforeState, after: { title, description, status, goalIds: parsedGoalIds }, req });
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
        const { title, status, priority, description, startDate, endDate } = req.body;
        if (!title) {
            return res.status(400).json({ error: 'Missing required field: title' });
        }
        const pool = await getPool();
        const result = await pool.request()
            .input('projectId', sql.Int, parseInt(req.params.projectId))
            .input('title', sql.NVarChar, title)
            .input('status', sql.NVarChar, status || 'todo')
            .input('priority', sql.NVarChar, priority || 'medium')
            .input('description', sql.NVarChar(sql.MAX), description || '')
            .input('startDate', sql.Date, startDate || null)
            .input('endDate', sql.Date, endDate || null)
            .query('INSERT INTO Tasks (projectId, title, status, priority, description, startDate, endDate) OUTPUT INSERTED.id VALUES (@projectId, @title, @status, @priority, @description, @startDate, @endDate)');

        invalidateProjectCache();
        const newId = result.recordset[0].id.toString();
        logAudit({ action: 'task.create', entityType: 'task', entityId: newId, entityTitle: title, user: getAuthUser(req), after: { title, status: status || 'todo', priority: priority || 'medium', startDate, endDate }, metadata: { projectId: req.params.projectId }, req });
        res.json({ id: newId, title, status: status || 'todo', priority: priority || 'medium', startDate, endDate });
    } catch (err) {
        handleError(res, 'creating task', err);
    }
});

// Get status reports for a project
router.get('/:projectId/reports', checkPermission('can_view_projects'), withSharedScope, checkProjectWriteAccess((req) => req.params.projectId), async (req, res) => {
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
router.post('/:projectId/reports', checkPermission('can_create_reports'), withSharedScope, checkProjectWriteAccess((req) => req.params.projectId), requireProjectWriteAccess, async (req, res) => {
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
