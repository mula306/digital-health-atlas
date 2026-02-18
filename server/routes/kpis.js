import express from 'express';
import { getPool, sql } from '../db.js';
import { checkPermission, getAuthUser } from '../middleware/authMiddleware.js';
import { handleError } from '../utils/errorHandler.js';
import { logAudit } from '../utils/auditLogger.js';

const router = express.Router();

// Update KPI
router.put('/:id', checkPermission('can_manage_kpis'), async (req, res) => {
    try {
        const { name, target, current, unit } = req.body;
        const id = parseInt(req.params.id);
        const pool = await getPool();
        const prev = await pool.request().input('id', sql.Int, id).query('SELECT name, target, currentValue, unit FROM KPIs WHERE id = @id');
        const beforeState = prev.recordset[0];
        const request = pool.request()
            .input('id', sql.Int, id);

        let updateParts = [];

        if (name !== undefined) {
            request.input('name', sql.NVarChar, name);
            updateParts.push('name = @name');
        }
        if (target !== undefined) {
            request.input('target', sql.Decimal(18, 2), target);
            updateParts.push('target = @target');
        }
        // Handle "current" from frontend mapping to "currentValue" in DB
        if (current !== undefined) {
            request.input('current', sql.Decimal(18, 2), current);
            updateParts.push('currentValue = @current');
        }
        if (unit !== undefined) {
            request.input('unit', sql.NVarChar, unit);
            updateParts.push('unit = @unit');
        }

        if (updateParts.length === 0) {
            return res.json({ success: true, message: 'No changes detected' });
        }

        await request.query(`UPDATE KPIs SET ${updateParts.join(', ')} WHERE id = @id`);

        logAudit({ action: 'kpi.update', entityType: 'kpi', entityId: id, entityTitle: name || beforeState?.name, user: getAuthUser(req), before: beforeState, after: { name, target, current, unit }, req });
        res.json({ success: true });
    } catch (err) {
        handleError(res, 'updating KPI', err);
    }
});

// Delete KPI
router.delete('/:id', checkPermission('can_manage_kpis'), async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const pool = await getPool();
        const prev = await pool.request().input('id', sql.Int, id).query('SELECT name, target, currentValue, unit, goalId FROM KPIs WHERE id = @id');
        await pool.request()
            .input('id', sql.Int, id)
            .query('DELETE FROM KPIs WHERE id = @id');

        logAudit({ action: 'kpi.delete', entityType: 'kpi', entityId: id, entityTitle: prev.recordset[0]?.name, user: getAuthUser(req), before: prev.recordset[0], req });
        res.json({ success: true });
    } catch (err) {
        handleError(res, 'deleting KPI', err);
    }
});

export default router;
