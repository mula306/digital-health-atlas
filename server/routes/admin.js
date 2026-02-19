import express from 'express';
import { getPool, sql } from '../db.js';
import { checkPermission, checkRole, getAuthUser, invalidatePermissionCache, requireAuth } from '../middleware/authMiddleware.js';
import { handleError } from '../utils/errorHandler.js';
import { logAudit } from '../utils/auditLogger.js';
import { invalidateTagCache, invalidateProjectCache } from '../utils/cache.js';

const router = express.Router();

// ==================== TAG GROUPS ====================

// Create tag group (Admin)
router.post('/tag-groups', checkPermission('can_manage_tags'), async (req, res) => {
    try {
        const { name, slug, requirePrimary, sortOrder } = req.body;
        if (!name || !slug) return res.status(400).json({ error: 'Missing required fields: name, slug' });

        const pool = await getPool();
        const result = await pool.request()
            .input('name', sql.NVarChar, name)
            .input('slug', sql.NVarChar, slug)
            .input('requirePrimary', sql.Bit, requirePrimary ? 1 : 0)
            .input('sortOrder', sql.Int, sortOrder || 0)
            .query('INSERT INTO TagGroups (name, slug, requirePrimary, sortOrder) OUTPUT INSERTED.id VALUES (@name, @slug, @requirePrimary, @sortOrder)');

        invalidateTagCache();
        const newId = result.recordset[0].id.toString();
        logAudit({ action: 'tag_group.create', entityType: 'tag_group', entityId: newId, entityTitle: name, user: getAuthUser(req), after: { name, slug, requirePrimary, sortOrder }, req });
        res.json({ id: newId, name, slug, requirePrimary: !!requirePrimary, sortOrder: sortOrder || 0, tags: [] });
    } catch (err) {
        handleError(res, 'creating tag group', err);
    }
});

// Update tag group (Admin)
router.put('/tag-groups/:id', checkPermission('can_manage_tags'), async (req, res) => {
    try {
        const { name, slug, requirePrimary, sortOrder } = req.body;
        const id = parseInt(req.params.id);
        const pool = await getPool();
        const prev = await pool.request().input('id', sql.Int, id).query('SELECT name, slug, requirePrimary, sortOrder FROM TagGroups WHERE id = @id');
        await pool.request()
            .input('id', sql.Int, id)
            .input('name', sql.NVarChar, name)
            .input('slug', sql.NVarChar, slug)
            .input('requirePrimary', sql.Bit, requirePrimary ? 1 : 0)
            .input('sortOrder', sql.Int, sortOrder || 0)
            .query('UPDATE TagGroups SET name = @name, slug = @slug, requirePrimary = @requirePrimary, sortOrder = @sortOrder WHERE id = @id');

        invalidateTagCache();
        logAudit({ action: 'tag_group.update', entityType: 'tag_group', entityId: id, entityTitle: name, user: getAuthUser(req), before: prev.recordset[0], after: { name, slug, requirePrimary, sortOrder }, req });
        res.json({ success: true });
    } catch (err) {
        handleError(res, 'updating tag group', err);
    }
});

// Delete tag group (Admin)
router.delete('/tag-groups/:id', checkPermission('can_manage_tags'), async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const pool = await getPool();
        const prev = await pool.request().input('id', sql.Int, id).query('SELECT name, slug FROM TagGroups WHERE id = @id');
        await pool.request()
            .input('id', sql.Int, id)
            .query('DELETE FROM TagGroups WHERE id = @id');

        invalidateTagCache();
        logAudit({ action: 'tag_group.delete', entityType: 'tag_group', entityId: id, entityTitle: prev.recordset[0]?.name, user: getAuthUser(req), before: prev.recordset[0], req });
        res.json({ success: true });
    } catch (err) {
        handleError(res, 'deleting tag group', err);
    }
});

// ==================== TAGS ====================

// Create tag (Admin)
router.post('/tags', checkPermission('can_manage_tags'), async (req, res) => {
    try {
        const { groupId, name, slug, status, color, sortOrder, aliases } = req.body;
        if (!groupId || !name || !slug) return res.status(400).json({ error: 'Missing required fields: groupId, name, slug' });

        const pool = await getPool();
        const result = await pool.request()
            .input('groupId', sql.Int, parseInt(groupId))
            .input('name', sql.NVarChar, name)
            .input('slug', sql.NVarChar, slug)
            .input('status', sql.NVarChar, status || 'active')
            .input('color', sql.NVarChar, color || '#6366f1')
            .input('sortOrder', sql.Int, sortOrder || 0)
            .query('INSERT INTO Tags (groupId, name, slug, status, color, sortOrder) OUTPUT INSERTED.id VALUES (@groupId, @name, @slug, @status, @color, @sortOrder)');

        const tagId = result.recordset[0].id;

        // Insert aliases if provided
        if (aliases && aliases.length > 0) {
            for (const alias of aliases) {
                if (alias.trim()) {
                    await pool.request()
                        .input('tagId', sql.Int, tagId)
                        .input('alias', sql.NVarChar, alias.trim())
                        .query('INSERT INTO TagAliases (tagId, alias) VALUES (@tagId, @alias)');
                }
            }
        }

        invalidateTagCache();
        logAudit({ action: 'tag.create', entityType: 'tag', entityId: tagId.toString(), entityTitle: name, user: getAuthUser(req), after: { groupId, name, slug, status: status || 'active', color: color || '#6366f1', sortOrder: sortOrder || 0, aliases }, req });
        res.json({ id: tagId.toString(), groupId: groupId.toString(), name, slug, status: status || 'active', color: color || '#6366f1', sortOrder: sortOrder || 0, aliases: (aliases || []).map(a => ({ alias: a })) });
    } catch (err) {
        handleError(res, 'creating tag', err);
    }
});

// Update tag (Admin) — supports partial updates
router.put('/tags/:id', checkPermission('can_manage_tags'), async (req, res) => {
    try {
        const { name, slug, status, color, sortOrder, aliases } = req.body;
        const pool = await getPool();
        const request = pool.request().input('id', sql.Int, parseInt(req.params.id));

        let updateParts = [];
        if (name !== undefined) { request.input('name', sql.NVarChar, name); updateParts.push('name = @name'); }
        if (slug !== undefined) { request.input('slug', sql.NVarChar, slug); updateParts.push('slug = @slug'); }
        if (status !== undefined) { request.input('status', sql.NVarChar, status); updateParts.push('status = @status'); }
        if (color !== undefined) { request.input('color', sql.NVarChar, color); updateParts.push('color = @color'); }
        if (sortOrder !== undefined) { request.input('sortOrder', sql.Int, sortOrder); updateParts.push('sortOrder = @sortOrder'); }

        if (updateParts.length > 0) {
            await request.query(`UPDATE Tags SET ${updateParts.join(', ')} WHERE id = @id`);
        }

        // Replace aliases if provided (delete-then-insert)
        if (aliases !== undefined) {
            await pool.request()
                .input('tagId', sql.Int, parseInt(req.params.id))
                .query('DELETE FROM TagAliases WHERE tagId = @tagId');

            for (const alias of aliases) {
                if (alias.trim()) {
                    await pool.request()
                        .input('tagId', sql.Int, parseInt(req.params.id))
                        .input('alias', sql.NVarChar, alias.trim())
                        .query('INSERT INTO TagAliases (tagId, alias) VALUES (@tagId, @alias)');
                }
            }
        }

        invalidateTagCache();
        logAudit({ action: 'tag.update', entityType: 'tag', entityId: req.params.id, entityTitle: name, user: getAuthUser(req), after: { name, slug, status, color, sortOrder, aliases }, req });
        res.json({ success: true });
    } catch (err) {
        handleError(res, 'updating tag', err);
    }
});

// Delete tag (Admin)
router.delete('/tags/:id', checkPermission('can_manage_tags'), async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const pool = await getPool();
        const prev = await pool.request().input('id', sql.Int, id).query('SELECT name, slug, groupId FROM Tags WHERE id = @id');
        await pool.request()
            .input('id', sql.Int, id)
            .query('DELETE FROM Tags WHERE id = @id');

        invalidateTagCache();
        invalidateProjectCache();
        logAudit({ action: 'tag.delete', entityType: 'tag', entityId: id, entityTitle: prev.recordset[0]?.name, user: getAuthUser(req), before: prev.recordset[0], req });
        res.json({ success: true });
    } catch (err) {
        handleError(res, 'deleting tag', err);
    }
});

// ==================== ROLE PERMISSIONS (ADMIN) ====================

// Get all permissions - Require authentication so users can check their own rights
router.get('/permissions', requireAuth, async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request().query('SELECT * FROM RolePermissions ORDER BY role, permission');
        res.json(result.recordset);
    } catch (err) {
        handleError(res, 'fetching permissions', err);
    }
});

// Update a single permission
router.post('/permissions', checkRole('Admin'), async (req, res) => {
    try {
        const { role, permission, isAllowed } = req.body;
        const pool = await getPool();

        await pool.request()
            .input('role', sql.NVarChar, role)
            .input('permission', sql.NVarChar, permission)
            .input('isAllowed', sql.Bit, isAllowed ? 1 : 0)
            .query(`
                MERGE RolePermissions AS target
                USING (SELECT @role, @permission) AS source (role, permission)
                ON (target.role = source.role AND target.permission = source.permission)
                WHEN MATCHED THEN
                    UPDATE SET isAllowed = @isAllowed
                WHEN NOT MATCHED THEN
                    INSERT (role, permission, isAllowed)
                    VALUES (@role, @permission, @isAllowed);
            `);

        invalidatePermissionCache(); // Clear cache so changes take effect immediately
        logAudit({ action: 'permission.update', entityType: 'permission', entityId: `${role}.${permission}`, entityTitle: `${role}: ${permission}`, user: getAuthUser(req), after: { role, permission, isAllowed }, req });
        res.json({ success: true, role, permission, isAllowed });
    } catch (err) {
        handleError(res, 'updating permission', err);
    }
});

// Bulk update permissions
router.post('/permissions/bulk', checkRole('Admin'), async (req, res) => {
    try {
        const { updates } = req.body; // Array of { role, permission, isAllowed }
        if (!Array.isArray(updates)) {
            return res.status(400).json({ error: 'updates must be an array' });
        }

        const pool = await getPool();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            for (const update of updates) {
                const request = new sql.Request(transaction);
                await request
                    .input('role', sql.NVarChar, update.role)
                    .input('permission', sql.NVarChar, update.permission)
                    .input('isAllowed', sql.Bit, update.isAllowed ? 1 : 0)
                    .query(`
                        MERGE RolePermissions AS target
                        USING (SELECT @role, @permission) AS source (role, permission)
                        ON (target.role = source.role AND target.permission = source.permission)
                        WHEN MATCHED THEN
                            UPDATE SET isAllowed = @isAllowed
                        WHEN NOT MATCHED THEN
                            INSERT (role, permission, isAllowed)
                            VALUES (@role, @permission, @isAllowed);
                    `);
            }
            await transaction.commit();
            invalidatePermissionCache(); // Clear cache so changes take effect immediately
            logAudit({ action: 'permission.bulk_update', entityType: 'permission', entityId: null, entityTitle: `${updates.length} permissions updated`, user: getAuthUser(req), after: null, metadata: { changes: updates }, req });
            res.json({ success: true, count: updates.length });
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    } catch (err) {
        handleError(res, 'bulk updating permissions', err);
    }
});

// ==================== AUDIT LOG (ADMIN) ====================

// Get audit log entries with filtering and pagination (Admin only)
router.get('/audit-log', checkRole('Admin'), async (req, res) => {
    try {
        const pool = await getPool();
        const page = parseInt(req.query.page) || 1;
        let limit = parseInt(req.query.limit) || 50;
        if (limit > 200) limit = 200;
        const offset = (page - 1) * limit;

        // Build dynamic WHERE clauses
        let whereClauses = [];
        const countRequest = pool.request();
        const dataRequest = pool.request();

        // Helper to add params to both requests
        const addParam = (name, type, value) => {
            countRequest.input(name, type, value);
            dataRequest.input(name, type, value);
        };

        if (req.query.action) {
            whereClauses.push('action = @action');
            addParam('action', sql.NVarChar(50), req.query.action);
        }
        if (req.query.entityType) {
            whereClauses.push('entityType = @entityType');
            addParam('entityType', sql.NVarChar(30), req.query.entityType);
        }
        if (req.query.entityId) {
            whereClauses.push('entityId = @entityId');
            addParam('entityId', sql.NVarChar(20), req.query.entityId);
        }
        if (req.query.userId) {
            whereClauses.push('userId = @userId');
            addParam('userId', sql.NVarChar(100), req.query.userId);
        }
        if (req.query.from) {
            whereClauses.push('createdAt >= @fromDate');
            addParam('fromDate', sql.DateTime2, new Date(req.query.from));
        }
        if (req.query.to) {
            whereClauses.push('createdAt <= @toDate');
            addParam('toDate', sql.DateTime2, new Date(req.query.to));
        }
        if (req.query.search) {
            whereClauses.push('(entityTitle LIKE @search OR userName LIKE @search)');
            addParam('search', sql.NVarChar, `%${req.query.search}%`);
        }

        const whereSQL = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

        // Get total count
        const countResult = await countRequest.query(`SELECT COUNT(*) as total FROM AuditLog ${whereSQL}`);
        const total = countResult.recordset[0].total;

        // Get paginated data
        dataRequest
            .input('offset', sql.Int, offset)
            .input('limit', sql.Int, limit);

        const dataResult = await dataRequest.query(`
            SELECT id, action, entityType, entityId, entityTitle, userId, userName,
                   [before], [after], metadata, ipAddress, userAgent, createdAt
            FROM AuditLog
            ${whereSQL}
            ORDER BY createdAt DESC
            OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
        `);

        const entries = dataResult.recordset.map(row => ({
            id: row.id.toString(),
            action: row.action,
            entityType: row.entityType,
            entityId: row.entityId,
            entityTitle: row.entityTitle,
            userId: row.userId,
            userName: row.userName,
            before: row.before ? JSON.parse(row.before) : null,
            after: row.after ? JSON.parse(row.after) : null,
            metadata: row.metadata ? JSON.parse(row.metadata) : null,
            ipAddress: row.ipAddress,
            userAgent: row.userAgent,
            createdAt: row.createdAt
        }));

        res.json({
            entries,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
                hasMore: page < Math.ceil(total / limit)
            }
        });
    } catch (err) {
        handleError(res, 'fetching audit log', err);
    }
});

// Get audit log summary statistics (Admin only)
router.get('/audit-log/stats', checkRole('Admin'), async (req, res) => {
    try {
        const pool = await getPool();

        const [countsResult, topUsersResult, topEntitiesResult, actionBreakdownResult] = await Promise.all([
            pool.request().query(`
                SELECT 
                    (SELECT COUNT(*) FROM AuditLog WHERE createdAt >= DATEADD(HOUR, -24, GETDATE())) as last24h,
                    (SELECT COUNT(*) FROM AuditLog WHERE createdAt >= DATEADD(DAY, -7, GETDATE())) as last7d,
                    (SELECT COUNT(*) FROM AuditLog WHERE createdAt >= DATEADD(DAY, -30, GETDATE())) as last30d,
                    (SELECT COUNT(*) FROM AuditLog) as total
            `),
            pool.request().query(`
                SELECT TOP 10 userName, userId, COUNT(*) as eventCount
                FROM AuditLog
                WHERE createdAt >= DATEADD(DAY, -30, GETDATE()) AND userName IS NOT NULL
                GROUP BY userName, userId
                ORDER BY eventCount DESC
            `),
            pool.request().query(`
                SELECT TOP 10 entityType, entityId, entityTitle, COUNT(*) as eventCount
                FROM AuditLog
                WHERE createdAt >= DATEADD(DAY, -30, GETDATE())
                GROUP BY entityType, entityId, entityTitle
                ORDER BY eventCount DESC
            `),
            pool.request().query(`
                SELECT action, COUNT(*) as count
                FROM AuditLog
                WHERE createdAt >= DATEADD(DAY, -30, GETDATE())
                GROUP BY action
                ORDER BY count DESC
            `)
        ]);

        res.json({
            counts: countsResult.recordset[0],
            topUsers: topUsersResult.recordset,
            topEntities: topEntitiesResult.recordset,
            actionBreakdown: actionBreakdownResult.recordset
        });
    } catch (err) {
        handleError(res, 'fetching audit log stats', err);
    }
});

export default router;
