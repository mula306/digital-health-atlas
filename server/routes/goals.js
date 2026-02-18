import express from 'express';
import { getPool, sql } from '../db.js';
import { checkPermission, getAuthUser } from '../middleware/authMiddleware.js';
import { handleError } from '../utils/errorHandler.js';
import { logAudit } from '../utils/auditLogger.js';
import { buildInClause, addParams } from '../utils/sqlHelpers.js';

const router = express.Router();

// Get all goals with KPIs and project stats
router.get('/', checkPermission(['can_view_goals', 'can_view_exec_dashboard']), async (req, res) => {
    try {
        console.log('Fetching goals...');
        const pool = await getPool();
        console.log('Pool acquired. Querying Goals...');
        const goalsResult = await pool.request().query('SELECT * FROM Goals ORDER BY id');
        console.log(`Goals fetched: ${goalsResult.recordset.length}`);

        console.log('Querying KPIs...');
        const kpisResult = await pool.request().query('SELECT * FROM KPIs');
        console.log(`KPIs fetched: ${kpisResult.recordset.length}`);

        const tagIdsParam = req.query.tagIds || '';
        const tagIds = tagIdsParam ? tagIdsParam.split(',').map(id => parseInt(id)).filter(id => !isNaN(id)) : [];

        // Fetch project stats for each goal
        let tagJoin = '';
        let queryParams = {};

        if (tagIds.length > 0) {
            const { text, params } = buildInClause('tagId', tagIds);
            tagJoin = `INNER JOIN ProjectTags pt ON p.id = pt.projectId AND pt.tagId IN (${text})`;
            Object.assign(queryParams, params);
        }

        const statsQuery = `
            SELECT 
                p.goalId,
                COUNT(p.id) as projectCount,
                SUM(
                    CASE WHEN tCounts.total > 0 
                    THEN (CAST(tCounts.done AS DECIMAL(10,2)) / tCounts.total) * 100 
                    ELSE 0 END
                ) as totalCompletion
            FROM Projects p
            ${tagJoin}
            OUTER APPLY (
                SELECT 
                    COUNT(*) as total,
                    SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) as done
                FROM Tasks t
                WHERE t.projectId = p.id
            ) tCounts
            WHERE p.goalId IS NOT NULL
            GROUP BY p.goalId
        `;

        const request = pool.request();
        addParams(request, queryParams);
        console.log('Executing stats query...');
        const statsResult = await request.query(statsQuery);
        console.log(`Stats fetched: ${statsResult.recordset.length}`);

        const statsByGoal = {};
        statsResult.recordset.forEach(s => {
            statsByGoal[s.goalId] = {
                count: s.projectCount,
                sum: s.totalCompletion || 0
            };
        });

        const goals = goalsResult.recordset.map(goal => {
            const stats = statsByGoal[goal.id] || { count: 0, sum: 0 };
            return {
                id: goal.id.toString(),
                title: goal.title,
                type: goal.type,
                parentId: goal.parentId ? goal.parentId.toString() : null,
                createdAt: goal.createdAt,
                directProjectCount: stats.count,
                directCompletionSum: stats.sum,
                kpis: kpisResult.recordset
                    .filter(k => k.goalId === goal.id)
                    .map(k => ({
                        id: k.id.toString(),
                        name: k.name,
                        target: k.target,
                        current: k.currentValue,
                        unit: k.unit
                    }))
            };
        });

        res.json(goals);
    } catch (err) {
        handleError(res, 'fetching goals', err);
    }
});

// Create goal
router.post('/', checkPermission('can_create_goal'), async (req, res) => {
    try {
        const { title, type, parentId } = req.body;
        if (!title || !type) {
            return res.status(400).json({ error: 'Missing required fields: title, type' });
        }
        const pool = await getPool();
        const result = await pool.request()
            .input('title', sql.NVarChar, title)
            .input('type', sql.NVarChar, type)
            .input('parentId', sql.Int, parentId ? parseInt(parentId) : null)
            .query('INSERT INTO Goals (title, type, parentId) OUTPUT INSERTED.id VALUES (@title, @type, @parentId)');

        const newId = result.recordset[0].id.toString();
        logAudit({ action: 'goal.create', entityType: 'goal', entityId: newId, entityTitle: title, user: getAuthUser(req), after: { title, type, parentId }, req });
        res.json({ id: newId, title, type, parentId, kpis: [] });
    } catch (err) {
        handleError(res, 'creating goal', err);
    }
});

// Update goal
router.put('/:id', checkPermission('can_edit_goal'), async (req, res) => {
    try {
        const { title, type } = req.body;
        const id = parseInt(req.params.id);
        const pool = await getPool();
        const prev = await pool.request().input('id', sql.Int, id).query('SELECT title, type FROM Goals WHERE id = @id');
        const beforeState = prev.recordset[0];
        await pool.request()
            .input('id', sql.Int, id)
            .input('title', sql.NVarChar, title)
            .input('type', sql.NVarChar, type)
            .query('UPDATE Goals SET title = @title, type = @type WHERE id = @id');

        logAudit({ action: 'goal.update', entityType: 'goal', entityId: id, entityTitle: title, user: getAuthUser(req), before: beforeState, after: { title, type }, req });
        res.json({ success: true });
    } catch (err) {
        handleError(res, 'updating goal', err);
    }
});

// Delete goal
router.delete('/:id', checkPermission('can_delete_goal'), async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const pool = await getPool();
        const prev = await pool.request().input('id', sql.Int, id).query('SELECT title, type, parentId FROM Goals WHERE id = @id');
        await pool.request()
            .input('id', sql.Int, id)
            .query('DELETE FROM Goals WHERE id = @id');

        logAudit({ action: 'goal.delete', entityType: 'goal', entityId: id, entityTitle: prev.recordset[0]?.title, user: getAuthUser(req), before: prev.recordset[0], req });
        res.json({ success: true });
    } catch (err) {
        handleError(res, 'deleting goal', err);
    }
});

// Add KPI to goal
router.post('/:goalId/kpis', checkPermission('can_manage_kpis'), async (req, res) => {
    try {
        const { name, target, current, unit } = req.body;
        const pool = await getPool();
        const result = await pool.request()
            .input('goalId', sql.Int, parseInt(req.params.goalId))
            .input('name', sql.NVarChar, name)
            .input('target', sql.Decimal(18, 2), target)
            .input('current', sql.Decimal(18, 2), current)
            .input('unit', sql.NVarChar, unit)
            .query('INSERT INTO KPIs (goalId, name, target, currentValue, unit) OUTPUT INSERTED.id VALUES (@goalId, @name, @target, @current, @unit)');

        const newId = result.recordset[0].id.toString();
        logAudit({ action: 'kpi.create', entityType: 'kpi', entityId: newId, entityTitle: name, user: getAuthUser(req), after: { name, target, current, unit, goalId: req.params.goalId }, req });
        res.json({ id: newId, name, target, current, unit });
    } catch (err) {
        handleError(res, 'creating KPI', err);
    }
});

export default router;
