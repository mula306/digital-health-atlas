import express from 'express';
import { getPool, sql } from '../db.js';
import { checkPermission, getAuthUser } from '../middleware/authMiddleware.js';
import { withSharedScope, checkTaskWriteAccess, requireProjectWriteAccess } from '../middleware/orgScope.js';
import { handleError } from '../utils/errorHandler.js';
import { logAudit } from '../utils/auditLogger.js';
import { invalidateProjectCache } from '../utils/cache.js';
import { touchProjectActivity } from '../utils/lifecycle.js';

const router = express.Router();

const TASK_STATUSES = new Set(['todo', 'in-progress', 'blocked', 'review', 'done']);
const TASK_PRIORITIES = new Set(['low', 'medium', 'high']);

const toDateOnly = (value) => {
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

const coerceTaskStatus = (value) => {
    if (value === undefined) return undefined;
    const normalized = String(value || '').trim().toLowerCase();
    return TASK_STATUSES.has(normalized) ? normalized : null;
};

const coerceTaskPriority = (value) => {
    if (value === undefined) return undefined;
    const normalized = String(value || '').trim().toLowerCase();
    return TASK_PRIORITIES.has(normalized) ? normalized : null;
};

const validateAssignee = async (pool, assigneeOid, orgId) => {
    if (!assigneeOid) return null;
    const assigneeResult = await pool.request()
        .input('oid', sql.NVarChar(100), assigneeOid)
        .query('SELECT TOP 1 oid, name, orgId FROM Users WHERE oid = @oid');
    if (!assigneeResult.recordset.length) {
        return { error: 'Assignee not found.' };
    }
    const assignee = assigneeResult.recordset[0];
    if (orgId && assignee.orgId && assignee.orgId !== orgId) {
        return { error: 'Assignee must belong to your organization.' };
    }
    return { assigneeName: assignee.name || null };
};

// Update task
router.put('/:id', checkPermission('can_edit_project'), withSharedScope, checkTaskWriteAccess(), requireProjectWriteAccess, async (req, res) => {
    try {
        const { title, status, priority, description, startDate, endDate, assigneeOid, blockerNote } = req.body;
        const id = parseInt(req.params.id, 10);
        if (Number.isNaN(id)) {
            return res.status(400).json({ error: 'Invalid task id' });
        }

        const pool = await getPool();
        const prev = await pool.request()
            .input('id', sql.Int, id)
            .query(`
                SELECT id, title, status, priority, description, startDate, endDate, assigneeOid, blockerNote, projectId
                FROM Tasks
                WHERE id = @id
            `);
        if (!prev.recordset.length) {
            return res.status(404).json({ error: 'Task not found' });
        }

        const beforeState = prev.recordset[0];
        const request = pool.request().input('id', sql.Int, id);
        const updateParts = [];
        const afterState = {};
        let blockerNoteWasProvided = false;
        let pendingBlockerNote;

        if (title !== undefined) {
            const normalizedTitle = typeof title === 'string' ? title.trim() : '';
            if (!normalizedTitle) {
                return res.status(400).json({ error: 'Task title cannot be empty.' });
            }
            request.input('title', sql.NVarChar(255), normalizedTitle);
            updateParts.push('title = @title');
            afterState.title = normalizedTitle;
        }

        if (status !== undefined) {
            const normalizedStatus = coerceTaskStatus(status);
            if (!normalizedStatus) {
                return res.status(400).json({ error: `Invalid task status. Allowed: ${Array.from(TASK_STATUSES).join(', ')}` });
            }
            request.input('status', sql.NVarChar(20), normalizedStatus);
            updateParts.push('status = @status');
            afterState.status = normalizedStatus;
        }

        if (priority !== undefined) {
            const normalizedPriority = coerceTaskPriority(priority);
            if (!normalizedPriority) {
                return res.status(400).json({ error: `Invalid task priority. Allowed: ${Array.from(TASK_PRIORITIES).join(', ')}` });
            }
            request.input('priority', sql.NVarChar(20), normalizedPriority);
            updateParts.push('priority = @priority');
            afterState.priority = normalizedPriority;
        }

        if (description !== undefined) {
            const normalizedDescription = description === null ? '' : String(description);
            request.input('description', sql.NVarChar(sql.MAX), normalizedDescription);
            updateParts.push('description = @description');
            afterState.description = normalizedDescription;
        }

        let normalizedStartDate;
        if (startDate !== undefined) {
            normalizedStartDate = toDateOnly(startDate);
            if (startDate && !normalizedStartDate) {
                return res.status(400).json({ error: 'Invalid startDate. Use YYYY-MM-DD or ISO date format.' });
            }
            request.input('startDate', sql.Date, normalizedStartDate);
            updateParts.push('startDate = @startDate');
            afterState.startDate = normalizedStartDate;
        }

        let normalizedEndDate;
        if (endDate !== undefined) {
            normalizedEndDate = toDateOnly(endDate);
            if (endDate && !normalizedEndDate) {
                return res.status(400).json({ error: 'Invalid endDate. Use YYYY-MM-DD or ISO date format.' });
            }
            request.input('endDate', sql.Date, normalizedEndDate);
            updateParts.push('endDate = @endDate');
            afterState.endDate = normalizedEndDate;
        }

        if (assigneeOid !== undefined) {
            const normalizedAssigneeOid = normalizeTaskString(assigneeOid, 100);
            const assigneeValidation = await validateAssignee(pool, normalizedAssigneeOid, req.orgId);
            if (assigneeValidation?.error) {
                return res.status(400).json({ error: assigneeValidation.error });
            }
            request.input('assigneeOid', sql.NVarChar(100), normalizedAssigneeOid);
            updateParts.push('assigneeOid = @assigneeOid');
            afterState.assigneeOid = normalizedAssigneeOid;
            afterState.assigneeName = assigneeValidation?.assigneeName || null;
        }

        if (blockerNote !== undefined) {
            const normalizedBlockerNote = normalizeTaskString(blockerNote, 1000);
            blockerNoteWasProvided = true;
            pendingBlockerNote = normalizedBlockerNote;
            updateParts.push('blockerNote = @blockerNote');
            afterState.blockerNote = normalizedBlockerNote;
        }

        const effectiveStartDate = (startDate !== undefined)
            ? normalizedStartDate
            : (beforeState.startDate ? new Date(beforeState.startDate).toISOString().slice(0, 10) : null);
        const effectiveEndDate = (endDate !== undefined)
            ? normalizedEndDate
            : (beforeState.endDate ? new Date(beforeState.endDate).toISOString().slice(0, 10) : null);
        if (effectiveStartDate && effectiveEndDate && effectiveEndDate < effectiveStartDate) {
            return res.status(400).json({ error: 'endDate cannot be earlier than startDate.' });
        }

        const effectiveStatus = (status !== undefined)
            ? afterState.status
            : beforeState.status;
        if (effectiveStatus !== 'blocked') {
            if (blockerNoteWasProvided) {
                pendingBlockerNote = null;
                afterState.blockerNote = null;
            } else if (beforeState.blockerNote) {
                pendingBlockerNote = null;
                updateParts.push('blockerNote = @blockerNote');
                afterState.blockerNote = null;
            }
        }

        if (blockerNoteWasProvided || (effectiveStatus !== 'blocked' && beforeState.blockerNote)) {
            request.input('blockerNote', sql.NVarChar(1000), pendingBlockerNote ?? null);
        }

        if (updateParts.length === 0) {
            return res.json({ success: true, message: 'No changes detected' });
        }

        request.input('updatedAt', sql.DateTime2, new Date());
        updateParts.push('updatedAt = @updatedAt');

        await request.query(`UPDATE Tasks SET ${updateParts.join(', ')} WHERE id = @id`);

        await touchProjectActivity(pool, beforeState.projectId);
        invalidateProjectCache();
        logAudit({
            action: 'task.update',
            entityType: 'task',
            entityId: id,
            entityTitle: afterState.title || beforeState.title,
            user: getAuthUser(req),
            before: beforeState,
            after: afterState,
            metadata: { projectId: beforeState?.projectId },
            req
        });
        res.json({ success: true, task: afterState });
    } catch (err) {
        handleError(res, 'updating task', err);
    }
});

// Get checklist items for a task
router.get('/:id/checklist', checkPermission('can_view_projects'), withSharedScope, checkTaskWriteAccess(), async (req, res) => {
    try {
        const taskId = parseInt(req.params.id, 10);
        if (Number.isNaN(taskId)) {
            return res.status(400).json({ error: 'Invalid task id' });
        }

        const pool = await getPool();
        const result = await pool.request()
            .input('taskId', sql.Int, taskId)
            .query(`
                SELECT id, taskId, title, isDone, sortOrder, createdAt
                FROM TaskChecklistItems
                WHERE taskId = @taskId
                ORDER BY sortOrder ASC, id ASC
            `);

        const items = result.recordset.map((row) => ({
            id: String(row.id),
            taskId: String(row.taskId),
            title: row.title,
            isDone: !!row.isDone,
            sortOrder: Number(row.sortOrder || 0),
            createdAt: row.createdAt
        }));
        const doneCount = items.filter((item) => item.isDone).length;

        res.json({
            items,
            summary: {
                total: items.length,
                done: doneCount
            }
        });
    } catch (err) {
        handleError(res, 'fetching task checklist', err);
    }
});

// Add checklist item
router.post('/:id/checklist', checkPermission('can_edit_project'), withSharedScope, checkTaskWriteAccess(), requireProjectWriteAccess, async (req, res) => {
    try {
        const taskId = parseInt(req.params.id, 10);
        if (Number.isNaN(taskId)) {
            return res.status(400).json({ error: 'Invalid task id' });
        }

        const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
        if (!title) {
            return res.status(400).json({ error: 'Checklist item title is required.' });
        }

        let sortOrder = Number.isInteger(req.body?.sortOrder)
            ? req.body.sortOrder
            : Number.parseInt(req.body?.sortOrder, 10);
        if (Number.isNaN(sortOrder)) {
            sortOrder = null;
        }
        if (sortOrder !== null && sortOrder < 0) {
            return res.status(400).json({ error: 'sortOrder must be 0 or greater.' });
        }

        const pool = await getPool();
        if (sortOrder === null) {
            const sortResult = await pool.request()
                .input('taskId', sql.Int, taskId)
                .query('SELECT ISNULL(MAX(sortOrder), -1) + 1 AS nextSortOrder FROM TaskChecklistItems WHERE taskId = @taskId');
            sortOrder = Number(sortResult.recordset[0]?.nextSortOrder || 0);
        }

        const insertResult = await pool.request()
            .input('taskId', sql.Int, taskId)
            .input('title', sql.NVarChar(255), title)
            .input('sortOrder', sql.Int, sortOrder)
            .query(`
                INSERT INTO TaskChecklistItems (taskId, title, isDone, sortOrder)
                OUTPUT INSERTED.id, INSERTED.taskId, INSERTED.title, INSERTED.isDone, INSERTED.sortOrder, INSERTED.createdAt
                VALUES (@taskId, @title, 0, @sortOrder)
            `);

        const taskProjectResult = await pool.request()
            .input('taskId', sql.Int, taskId)
            .query('SELECT projectId FROM Tasks WHERE id = @taskId');
        await touchProjectActivity(pool, taskProjectResult.recordset[0]?.projectId);
        const item = insertResult.recordset[0];
        invalidateProjectCache();
        logAudit({
            action: 'task.checklist.add',
            entityType: 'task-checklist-item',
            entityId: String(item.id),
            entityTitle: item.title,
            user: getAuthUser(req),
            after: { taskId, title: item.title, sortOrder: item.sortOrder, isDone: false },
            metadata: { taskId },
            req
        });

        res.json({
            id: String(item.id),
            taskId: String(item.taskId),
            title: item.title,
            isDone: !!item.isDone,
            sortOrder: Number(item.sortOrder || 0),
            createdAt: item.createdAt
        });
    } catch (err) {
        handleError(res, 'adding task checklist item', err);
    }
});

// Update checklist item
router.put('/:id/checklist/:itemId', checkPermission('can_edit_project'), withSharedScope, checkTaskWriteAccess(), requireProjectWriteAccess, async (req, res) => {
    try {
        const taskId = parseInt(req.params.id, 10);
        const itemId = parseInt(req.params.itemId, 10);
        if (Number.isNaN(taskId) || Number.isNaN(itemId)) {
            return res.status(400).json({ error: 'Invalid task or checklist item id' });
        }

        const pool = await getPool();
        const request = pool.request()
            .input('taskId', sql.Int, taskId)
            .input('itemId', sql.Int, itemId);
        const updateParts = [];
        const after = {};

        if (req.body?.title !== undefined) {
            const title = typeof req.body.title === 'string' ? req.body.title.trim() : '';
            if (!title) {
                return res.status(400).json({ error: 'Checklist item title cannot be empty.' });
            }
            request.input('title', sql.NVarChar(255), title);
            updateParts.push('title = @title');
            after.title = title;
        }

        if (req.body?.isDone !== undefined) {
            const isDone = !!req.body.isDone;
            request.input('isDone', sql.Bit, isDone ? 1 : 0);
            updateParts.push('isDone = @isDone');
            after.isDone = isDone;
        }

        if (req.body?.sortOrder !== undefined) {
            const parsedSort = Number.parseInt(req.body.sortOrder, 10);
            if (Number.isNaN(parsedSort) || parsedSort < 0) {
                return res.status(400).json({ error: 'sortOrder must be 0 or greater.' });
            }
            request.input('sortOrder', sql.Int, parsedSort);
            updateParts.push('sortOrder = @sortOrder');
            after.sortOrder = parsedSort;
        }

        if (updateParts.length === 0) {
            return res.status(400).json({ error: 'No checklist changes provided.' });
        }

        const updateResult = await request.query(`
            UPDATE TaskChecklistItems
            SET ${updateParts.join(', ')}
            WHERE id = @itemId AND taskId = @taskId
        `);
        if (updateResult.rowsAffected[0] === 0) {
            return res.status(404).json({ error: 'Checklist item not found for task.' });
        }

        const currentResult = await pool.request()
            .input('taskId', sql.Int, taskId)
            .input('itemId', sql.Int, itemId)
            .query(`
                SELECT id, taskId, title, isDone, sortOrder, createdAt
                FROM TaskChecklistItems
                WHERE id = @itemId AND taskId = @taskId
            `);
        const item = currentResult.recordset[0];

        const taskProjectResult = await pool.request()
            .input('taskId', sql.Int, taskId)
            .query('SELECT projectId FROM Tasks WHERE id = @taskId');
        await touchProjectActivity(pool, taskProjectResult.recordset[0]?.projectId);
        invalidateProjectCache();
        logAudit({
            action: 'task.checklist.update',
            entityType: 'task-checklist-item',
            entityId: String(itemId),
            entityTitle: item?.title || 'Checklist Item',
            user: getAuthUser(req),
            after,
            metadata: { taskId },
            req
        });

        res.json({
            id: String(item.id),
            taskId: String(item.taskId),
            title: item.title,
            isDone: !!item.isDone,
            sortOrder: Number(item.sortOrder || 0),
            createdAt: item.createdAt
        });
    } catch (err) {
        handleError(res, 'updating task checklist item', err);
    }
});

// Delete checklist item
router.delete('/:id/checklist/:itemId', checkPermission('can_edit_project'), withSharedScope, checkTaskWriteAccess(), requireProjectWriteAccess, async (req, res) => {
    try {
        const taskId = parseInt(req.params.id, 10);
        const itemId = parseInt(req.params.itemId, 10);
        if (Number.isNaN(taskId) || Number.isNaN(itemId)) {
            return res.status(400).json({ error: 'Invalid task or checklist item id' });
        }

        const pool = await getPool();
        const prev = await pool.request()
            .input('taskId', sql.Int, taskId)
            .input('itemId', sql.Int, itemId)
            .query(`
                SELECT id, taskId, title, isDone, sortOrder
                FROM TaskChecklistItems
                WHERE id = @itemId AND taskId = @taskId
            `);
        if (!prev.recordset.length) {
            return res.status(404).json({ error: 'Checklist item not found for task.' });
        }

        await pool.request()
            .input('taskId', sql.Int, taskId)
            .input('itemId', sql.Int, itemId)
            .query('DELETE FROM TaskChecklistItems WHERE id = @itemId AND taskId = @taskId');

        const taskProjectResult = await pool.request()
            .input('taskId', sql.Int, taskId)
            .query('SELECT projectId FROM Tasks WHERE id = @taskId');
        await touchProjectActivity(pool, taskProjectResult.recordset[0]?.projectId);
        invalidateProjectCache();
        logAudit({
            action: 'task.checklist.delete',
            entityType: 'task-checklist-item',
            entityId: String(itemId),
            entityTitle: prev.recordset[0]?.title || 'Checklist Item',
            user: getAuthUser(req),
            before: prev.recordset[0],
            metadata: { taskId },
            req
        });
        res.json({ success: true });
    } catch (err) {
        handleError(res, 'deleting task checklist item', err);
    }
});

// Delete task
router.delete('/:id', checkPermission('can_edit_project'), withSharedScope, checkTaskWriteAccess(), requireProjectWriteAccess, async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (Number.isNaN(id)) {
            return res.status(400).json({ error: 'Invalid task id' });
        }
        const pool = await getPool();
        const prev = await pool.request()
            .input('id', sql.Int, id)
            .query('SELECT title, status, priority, projectId, assigneeOid, blockerNote FROM Tasks WHERE id = @id');
        await pool.request()
            .input('id', sql.Int, id)
            .query('DELETE FROM Tasks WHERE id = @id');

        await touchProjectActivity(pool, prev.recordset[0]?.projectId);
        invalidateProjectCache();
        logAudit({
            action: 'task.delete',
            entityType: 'task',
            entityId: id,
            entityTitle: prev.recordset[0]?.title,
            user: getAuthUser(req),
            before: prev.recordset[0],
            metadata: { projectId: prev.recordset[0]?.projectId },
            req
        });
        res.json({ success: true });
    } catch (err) {
        handleError(res, 'deleting task', err);
    }
});

export default router;
