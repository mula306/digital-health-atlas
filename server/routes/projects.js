import express from 'express';
import { getPool, sql } from '../db.js';
import { checkPermission, getAuthUser } from '../middleware/authMiddleware.js';
import { handleError } from '../utils/errorHandler.js';
import { logAudit } from '../utils/auditLogger.js';
import { cache, CACHE_KEYS, invalidateProjectCache } from '../utils/cache.js';
import { buildInClause, addParams } from '../utils/sqlHelpers.js';

const router = express.Router();

// ==================== PROJECTS ====================

// Get lightweight executive summary of ALL projects
router.get('/exec-summary', checkPermission(['can_view_exec_dashboard', 'can_view_projects']), async (req, res) => {
    try {
        const pool = await getPool();

        // 1. Fetch Projects with Latest Report (Updated for JSON blob)
        const projectsQuery = `
            SELECT 
                p.id, p.title, p.goalId,
                r.id as reportId, r.reportData, r.createdAt as reportDate,
                (CASE WHEN EXISTS (SELECT 1 FROM StatusReports WHERE projectId = p.id) THEN 1 ELSE 0 END) as reportCount
            FROM Projects p
            OUTER APPLY (
                SELECT TOP 1 *
                FROM StatusReports sr
                WHERE sr.projectId = p.id
                ORDER BY sr.createdAt DESC
            ) r
            ORDER BY p.title ASC
        `;
        const projectsResult = await pool.request().query(projectsQuery);

        // 2. Fetch Project Tags
        const tagsResult = await pool.request().query('SELECT projectId, tagId, isPrimary FROM ProjectTags');
        const tagsByProject = {};
        tagsResult.recordset.forEach(t => {
            if (!tagsByProject[t.projectId]) tagsByProject[t.projectId] = [];
            tagsByProject[t.projectId].push({ tagId: t.tagId, isPrimary: t.isPrimary });
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

            return {
                id: p.id.toString(),
                title: p.title,
                goalId: p.goalId ? p.goalId.toString() : null,
                tags: tagsByProject[p.id] || [],
                reportCount: p.reportCount || 0,
                report: reportDetails
            };
        });

        res.json(summary);
    } catch (err) {
        handleError(res, 'fetching exec summary', err);
    }
});

// Get all projects with tasks and status reports (OPTIMIZED with JOINs and pagination)
router.get('/', checkPermission(['can_view_projects', 'can_view_exec_dashboard']), async (req, res) => {
    try {
        // Pagination params
        const page = parseInt(req.query.page) || 1;
        let limit = parseInt(req.query.limit) || 50;
        if (limit > 100) limit = 100; // Clamp limit
        const offset = (page - 1) * limit;
        const search = req.query.search || '';
        const projectIdParam = req.query.projectId;
        const projectId = Number.isNaN(parseInt(projectIdParam, 10)) ? null : parseInt(projectIdParam, 10);
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

        // Check cache first
        const cacheKey = `${CACHE_KEYS.PROJECT_PREFIX}${page}_${limit}_${search}_${projectId || ''}_${goalIds.join('-')}_${tagIds.join('-')}`;
        const cached = cache.get(cacheKey);
        if (cached) {
            return res.json(cached);
        }

        const pool = await getPool();
        const requestParams = {
            offset,
            limit
        };
        const countParams = {};

        // Build WHERE clause for filtering
        const conditions = [];
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

        let tagJoin = '';

        // Safe Goal Filtering
        if (goalIds.length > 0) {
            const { text, params } = buildInClause('goalId', goalIds);
            conditions.push(`p.goalId IN (${text})`);
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

        let whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

        // Helper to run query with params
        const runQuery = async (queryStr, params) => {
            const req = pool.request();
            addParams(req, params);
            return await req.query(queryStr);
        };

        // Get total count for pagination metadata
        const countQuery = `SELECT COUNT(DISTINCT p.id) as total FROM Projects p ${tagJoin} ${whereClause}`;
        const countResult = await runQuery(countQuery, countParams);
        const totalProjects = countResult.recordset[0].total;
        const totalPages = Math.ceil(totalProjects / limit);

        // Single optimized query with JOIN - fetch projects with pagination
        const query = `
            SELECT DISTINCT p.id, p.title, p.description, p.status, p.goalId, p.createdAt
            FROM Projects p
            ${tagJoin}
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

        const projectTagsRequest = pool.request();
        addParams(projectTagsRequest, idParams);

        const [tasksResult, reportsResult, latestReportsResult, projectTagsResult] = await Promise.all([
            // Fetch only necessary task fields active tasks filtering
            // Note: dueDate does not exist in schema, using endDate
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
            `)
        ]);

        // Build maps for efficient lookup
        const completionMap = new Map();
        const reportCountMap = new Map();
        const latestReportMap = new Map();
        const projectTagMap = new Map();

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

        const projects = projectsResult.recordset.map(project => ({
            id: project.id.toString(),
            title: project.title,
            description: project.description,
            status: project.status || 'active',
            goalId: project.goalId ? project.goalId.toString() : null,
            createdAt: project.createdAt,
            completion: completionMap.get(project.id) || 0,
            // Light payload: Include active tasks for dashboard (overdue/in-progress lists)
            tasks: (activeTasksMap.get(project.id) || []),
            // We still need total task count for progress calculation
            taskCount: (projectTasks[project.id] || []).length,
            completedTaskCount: completedCountMap.get(project.id) || 0,
            reportCount: reportCountMap.get(project.id) || 0,
            latestReport: latestReportMap.get(String(project.id)) || null,
            tags: projectTagMap.get(project.id) || []
        }));

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

// Get single project details (Full Data)
router.get('/:id', checkPermission('can_view_projects'), async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const pool = await getPool();

        // Fetch project basic info
        const projectResult = await pool.request()
            .input('id', sql.Int, id)
            .query('SELECT * FROM Projects WHERE id = @id');

        if (projectResult.recordset.length === 0) {
            return res.status(404).json({ error: 'Project not found' });
        }
        const project = projectResult.recordset[0];

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

        res.json({
            id: project.id.toString(),
            title: project.title,
            description: project.description,
            status: project.status,
            goalId: project.goalId ? project.goalId.toString() : null,
            createdAt: project.createdAt,
            completion,
            tasks,
            reportCount: reportsResult.recordset[0].count,
            latestReport
        });
    } catch (err) {
        handleError(res, 'fetching project details', err);
    }
});

// Create project
router.post('/', checkPermission('can_create_project'), async (req, res) => {
    try {
        const { title, description, goalId, status } = req.body;
        const pool = await getPool();
        const result = await pool.request()
            .input('title', sql.NVarChar, title)
            .input('description', sql.NVarChar(sql.MAX), description)
            .input('status', sql.NVarChar, status || 'active')
            .input('goalId', sql.Int, goalId ? parseInt(goalId) : null)
            .query('INSERT INTO Projects (title, description, status, goalId) OUTPUT INSERTED.id VALUES (@title, @description, @status, @goalId)');

        invalidateProjectCache();
        const newId = result.recordset[0].id.toString();
        logAudit({ action: 'project.create', entityType: 'project', entityId: newId, entityTitle: title, user: getAuthUser(req), after: { title, description, goalId }, req });
        res.json({ id: newId, title, description, goalId, tasks: [], statusReports: [] });
    } catch (err) {
        handleError(res, 'creating project', err);
    }
});

// Update project
router.put('/:id', checkPermission('can_edit_project'), async (req, res) => {
    try {
        const { title, description, status, goalId } = req.body;
        if (!title) {
            return res.status(400).json({ error: 'Missing required field: title' });
        }
        const id = parseInt(req.params.id);
        const pool = await getPool();
        const prev = await pool.request().input('id', sql.Int, id).query('SELECT title, description, status, goalId FROM Projects WHERE id = @id');
        const beforeState = prev.recordset[0];
        await pool.request()
            .input('id', sql.Int, id)
            .input('title', sql.NVarChar, title)
            .input('description', sql.NVarChar(sql.MAX), description)
            .input('status', sql.NVarChar, status)
            .input('goalId', sql.Int, goalId ? parseInt(goalId) : null)
            .query('UPDATE Projects SET title = @title, description = @description, status = @status, goalId = @goalId WHERE id = @id');

        invalidateProjectCache();
        logAudit({ action: 'project.update', entityType: 'project', entityId: id, entityTitle: title, user: getAuthUser(req), before: beforeState, after: { title, description, status, goalId }, req });
        res.json({ success: true });
    } catch (err) {
        handleError(res, 'updating project', err);
    }
});

// Delete project
router.delete('/:id', checkPermission('can_delete_project'), async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const pool = await getPool();
        const prev = await pool.request().input('id', sql.Int, id).query('SELECT title, status, goalId FROM Projects WHERE id = @id');
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
router.put('/:id/tags', checkPermission('can_edit_project'), async (req, res) => {
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
router.post('/:projectId/tasks', checkPermission('can_edit_project'), async (req, res) => {
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
router.get('/:projectId/reports', checkPermission('can_view_projects'), async (req, res) => {
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
router.post('/:projectId/reports', checkPermission('can_create_reports'), async (req, res) => {
    try {
        const { reportData, createdBy, restoredFrom } = req.body;

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
router.get('/:id/activity', checkPermission('can_view_projects'), async (req, res) => {
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
