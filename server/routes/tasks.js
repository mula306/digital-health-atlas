import express from 'express';
import { getPool, sql } from '../db.js';
import { checkPermission, getAuthUser } from '../middleware/authMiddleware.js';
import { handleError } from '../utils/errorHandler.js';
import { logAudit } from '../utils/auditLogger.js';
import { invalidateProjectCache } from '../utils/cache.js';

const router = express.Router();

// Update task
router.put('/:id', checkPermission('can_edit_project'), async (req, res) => {
    try {
        const { title, status, priority, description, startDate, endDate } = req.body;
        const id = parseInt(req.params.id);
        const pool = await getPool();
        const prev = await pool.request().input('id', sql.Int, id).query('SELECT title, status, priority, projectId FROM Tasks WHERE id = @id');
        const beforeState = prev.recordset[0];
        const request = pool.request()
            .input('id', sql.Int, id);

        let updateParts = [];

        if (title !== undefined) {
            request.input('title', sql.NVarChar, title);
            updateParts.push('title = @title');
        }
        if (status !== undefined) {
            request.input('status', sql.NVarChar, status);
            updateParts.push('status = @status');
        }
        if (priority !== undefined) {
            request.input('priority', sql.NVarChar, priority);
            updateParts.push('priority = @priority');
        }
        if (description !== undefined) {
            request.input('description', sql.NVarChar(sql.MAX), description);
            updateParts.push('description = @description');
        }

        // Handle dates: Allow setting to null explicitly if passed as null
        if (startDate !== undefined) {
            request.input('startDate', sql.Date, startDate);
            updateParts.push('startDate = @startDate');
        }
        if (endDate !== undefined) {
            request.input('endDate', sql.Date, endDate);
            updateParts.push('endDate = @endDate');
        }

        if (updateParts.length === 0) {
            return res.json({ success: true, message: 'No changes detected' });
        }

        await request.query(`UPDATE Tasks SET ${updateParts.join(', ')} WHERE id = @id`);

        invalidateProjectCache();
        logAudit({ action: 'task.update', entityType: 'task', entityId: id, entityTitle: title || beforeState?.title, user: getAuthUser(req), before: beforeState, after: { title, status, priority, description, startDate, endDate }, metadata: { projectId: beforeState?.projectId }, req });
        res.json({ success: true });
    } catch (err) {
        handleError(res, 'updating task', err);
    }
});

// Delete task
router.delete('/:id', checkPermission('can_edit_project'), async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const pool = await getPool();
        const prev = await pool.request().input('id', sql.Int, id).query('SELECT title, status, priority, projectId FROM Tasks WHERE id = @id');
        await pool.request()
            .input('id', sql.Int, id)
            .query('DELETE FROM Tasks WHERE id = @id');

        invalidateProjectCache();
        logAudit({ action: 'task.delete', entityType: 'task', entityId: id, entityTitle: prev.recordset[0]?.title, user: getAuthUser(req), before: prev.recordset[0], metadata: { projectId: prev.recordset[0]?.projectId }, req });
        res.json({ success: true });
    } catch (err) {
        handleError(res, 'deleting task', err);
    }
});

export default router;
