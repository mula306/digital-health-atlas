import express from 'express';
import { getPool } from '../db.js';
import { checkPermission } from '../middleware/authMiddleware.js';
import { handleError } from '../utils/errorHandler.js';
import { buildInClause, addParams } from '../utils/sqlHelpers.js';

const router = express.Router();

// Get dashboard statistics (server-side aggregation)
router.get('/stats', checkPermission(['can_view_projects']), async (req, res) => {
    try {
        const pool = await getPool();
        const goalIdsParam = req.query.goalIds || ''; // Comma-separated IDs
        const goalIds = goalIdsParam ? goalIdsParam.split(',').map(id => parseInt(id)).filter(id => !isNaN(id)) : [];
        const tagIdsParam = req.query.tagIds || '';
        const tagIds = tagIdsParam ? tagIdsParam.split(',').map(id => parseInt(id)).filter(id => !isNaN(id)) : [];
        const statusesParam = req.query.statuses || '';
        const statuses = statusesParam
            ? statusesParam.split(',').map(s => String(s).trim().toLowerCase()).filter(Boolean)
            : [];

        let whereConditions = [];
        let queryParams = {};

        // 1. Goal Filtering (Safe IN clause)
        if (goalIds.length > 0) {
            const { text: goalInClause, params: goalParams } = buildInClause('goalId', goalIds);
            whereConditions.push(`p.goalId IN (${goalInClause})`);
            Object.assign(queryParams, goalParams);
        }

        // 2. Tag Filtering (Safe IN clause)
        let tagJoin = '';
        if (tagIds.length > 0) {
            const { text: tagInClause, params: tagParams } = buildInClause('tagId', tagIds);
            tagJoin = `INNER JOIN ProjectTags pt ON p.id = pt.projectId AND pt.tagId IN (${tagInClause})`;
            Object.assign(queryParams, tagParams);
        }

        // 3. Latest Status Filtering (red/yellow/green/unknown)
        let statusJoin = '';
        if (statuses.length > 0) {
            const { text: statusInClause, params: statusParams } = buildInClause('status', statuses);
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
            whereConditions.push(`COALESCE(NULLIF(lsr.overallStatus, ''), 'unknown') IN (${statusInClause})`);
            Object.assign(queryParams, statusParams);
        }

        const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

        // Helper to run query with params
        const runQuery = async (queryStr) => {
            const request = pool.request();
            addParams(request, queryParams);
            return await request.query(queryStr);
        };

        // 1. Counts (Projects, Tasks, Completed Tasks)
        // We join Tasks to Projects to respect the goal filtering
        const statsQuery = `
            SELECT 
                COUNT(DISTINCT p.id) as totalProjects,
                COUNT(DISTINCT t.id) as totalTasks,
                SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) as completedTasks
            FROM Projects p
            ${tagJoin}
            ${statusJoin}
            LEFT JOIN Tasks t ON p.id = t.projectId
            ${whereClause}
        `;
        const statsResult = await runQuery(statsQuery);
        const stats = statsResult.recordset[0];

        // 2. Overdue Tasks (Top 5)
        const overdueQuery = `
            SELECT TOP 5 t.id, t.title, t.endDate, t.projectId, p.title as projectTitle
            FROM Tasks t
            INNER JOIN Projects p ON t.projectId = p.id
            ${tagJoin}
            ${statusJoin}
            ${whereClause ? whereClause + ' AND' : 'WHERE'} 
            t.endDate < CAST(GETDATE() AS DATE) 
            AND t.status != 'done'
            ORDER BY t.endDate ASC
        `;
        const overdueResult = await runQuery(overdueQuery);

        // 3. In Progress Tasks (Top 5)
        const inProgressQuery = `
            SELECT TOP 5 t.id, t.title, t.projectId, p.title as projectTitle
            FROM Tasks t
            INNER JOIN Projects p ON t.projectId = p.id
            ${tagJoin}
            ${statusJoin}
            ${whereClause ? whereClause + ' AND' : 'WHERE'} 
            t.status = 'in-progress'
            ORDER BY t.startDate DESC, t.id DESC
        `;
        const inProgressResult = await runQuery(inProgressQuery);

        // 4. Overdue Count (Separate query for total count)
        const overdueCountQuery = `
            SELECT COUNT(DISTINCT t.id) as count
            FROM Tasks t
            INNER JOIN Projects p ON t.projectId = p.id
            ${tagJoin}
            ${statusJoin}
            ${whereClause ? whereClause + ' AND' : 'WHERE'} 
            t.endDate < CAST(GETDATE() AS DATE) 
            AND t.status != 'done'
        `;
        const overdueCountResult = await runQuery(overdueCountQuery);

        // 5. In Progress Count
        const inProgressCountQuery = `
            SELECT COUNT(DISTINCT t.id) as count
            FROM Tasks t
            INNER JOIN Projects p ON t.projectId = p.id
            ${tagJoin}
            ${statusJoin}
            ${whereClause ? whereClause + ' AND' : 'WHERE'} 
            t.status = 'in-progress'
        `;
        const inProgressCountResult = await runQuery(inProgressCountQuery);

        // 6. Average Project Completion (for overall progress)
        const completionQuery = `
            SELECT AVG(
                CASE WHEN pd.taskCount = 0 THEN 0 
                ELSE (CAST(pd.doneCount AS FLOAT) / pd.taskCount) * 100 
                END
            ) as avgCompletion
            FROM (
                SELECT p.id, 
                    COUNT(t.id) as taskCount, 
                    SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) as doneCount
                FROM Projects p
                ${tagJoin}
                ${statusJoin}
                LEFT JOIN Tasks t ON p.id = t.projectId
                ${whereClause}
                GROUP BY p.id
            ) pd
        `;
        const completionResult = await runQuery(completionQuery);

        res.json({
            totalProjects: stats.totalProjects || 0,
            totalTasks: stats.totalTasks || 0,
            completedTasks: stats.completedTasks || 0,
            overdueTasks: overdueResult.recordset,
            overdueCount: overdueCountResult.recordset[0].count,
            inProgressTasks: inProgressResult.recordset,
            inProgressCount: inProgressCountResult.recordset[0].count,
            avgProjectCompletion: Math.round(completionResult.recordset[0].avgCompletion || 0)
        });

    } catch (err) {
        handleError(res, 'fetching dashboard stats', err);
    }
});

export default router;
