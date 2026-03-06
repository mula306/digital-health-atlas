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

// ==================== ALL USERS (for member assignment) ====================

// Returns all users with org info for admin member assignment panel
router.get('/all-users', checkRole('Admin'), async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request().query(`
            SELECT u.oid, u.name, u.email, u.orgId, u.lastLogin,
                   o.name AS orgName
            FROM Users u
            LEFT JOIN Organizations o ON u.orgId = o.id
            ORDER BY u.name ASC
        `);

        res.json(result.recordset.map(u => ({
            oid: u.oid,
            name: u.name,
            email: u.email || null,
            orgId: u.orgId,
            orgName: u.orgName || null,
            lastLogin: u.lastLogin || null
        })));
    } catch (err) {
        handleError(res, 'fetching all users', err);
    }
});

// ==================== ORGANIZATIONS ====================

// List all organizations
router.get('/organizations', checkRole('Admin'), async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request().query(`
            SELECT o.*, 
                   (SELECT COUNT(*) FROM Users u WHERE u.orgId = o.id) AS memberCount
            FROM Organizations o
            ORDER BY o.name ASC
        `);
        res.json(result.recordset.map(o => ({
            id: o.id.toString(),
            name: o.name,
            slug: o.slug,
            isActive: !!o.isActive,
            createdAt: o.createdAt,
            memberCount: o.memberCount || 0
        })));
    } catch (err) {
        handleError(res, 'fetching organizations', err);
    }
});

// Create organization
router.post('/organizations', checkRole('Admin'), async (req, res) => {
    try {
        const { name, slug, isActive } = req.body;
        if (!name || !slug) return res.status(400).json({ error: 'name and slug are required' });

        const pool = await getPool();
        const result = await pool.request()
            .input('name', sql.NVarChar(255), name.trim())
            .input('slug', sql.NVarChar(100), slug.trim().toLowerCase())
            .input('isActive', sql.Bit, isActive !== false ? 1 : 0)
            .query('INSERT INTO Organizations (name, slug, isActive) OUTPUT INSERTED.* VALUES (@name, @slug, @isActive)');

        const org = result.recordset[0];
        logAudit({ action: 'org.create', entityType: 'organization', entityId: org.id, entityTitle: name, user: getAuthUser(req), after: { name, slug }, req });
        res.json({ id: org.id.toString(), name: org.name, slug: org.slug, isActive: !!org.isActive, createdAt: org.createdAt });
    } catch (err) {
        if (err.number === 2627) return res.status(409).json({ error: 'Organization name or slug already exists' });
        handleError(res, 'creating organization', err);
    }
});

// Update organization
router.put('/organizations/:id', checkRole('Admin'), async (req, res) => {
    try {
        const { name, slug, isActive } = req.body;
        const id = parseInt(req.params.id);
        const pool = await getPool();

        const updates = [];
        const request = pool.request().input('id', sql.Int, id);
        if (name !== undefined) { request.input('name', sql.NVarChar(255), name.trim()); updates.push('name = @name'); }
        if (slug !== undefined) { request.input('slug', sql.NVarChar(100), slug.trim().toLowerCase()); updates.push('slug = @slug'); }
        if (isActive !== undefined) { request.input('isActive', sql.Bit, isActive ? 1 : 0); updates.push('isActive = @isActive'); }

        if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });
        await request.query(`UPDATE Organizations SET ${updates.join(', ')} WHERE id = @id`);

        logAudit({ action: 'org.update', entityType: 'organization', entityId: id, entityTitle: name, user: getAuthUser(req), after: { name, slug, isActive }, req });
        res.json({ success: true });
    } catch (err) {
        handleError(res, 'updating organization', err);
    }
});

// Assign user to organization
router.put('/users/:oid/organization', checkRole('Admin'), async (req, res) => {
    try {
        const { orgId } = req.body;
        const oid = req.params.oid;
        const pool = await getPool();

        await pool.request()
            .input('oid', sql.NVarChar(100), oid)
            .input('orgId', sql.Int, orgId ? parseInt(orgId) : null)
            .query('UPDATE Users SET orgId = @orgId WHERE oid = @oid');

        logAudit({ action: 'user.org_assign', entityType: 'user', entityId: oid, entityTitle: oid, user: getAuthUser(req), after: { orgId }, req });
        res.json({ success: true });
    } catch (err) {
        handleError(res, 'assigning user to organization', err);
    }
});

// ==================== PROJECT SHARING ====================

// Get organizations a project is shared with
router.get('/projects/:projectId/sharing', checkRole('Admin'), async (req, res) => {
    try {
        const projectId = parseInt(req.params.projectId);
        const pool = await getPool();
        const result = await pool.request()
            .input('projectId', sql.Int, projectId)
            .query(`
                SELECT poa.*, o.name AS orgName, o.slug AS orgSlug
                FROM ProjectOrgAccess poa
                INNER JOIN Organizations o ON o.id = poa.orgId
                WHERE poa.projectId = @projectId
            `);
        res.json(result.recordset.map(r => ({
            projectId: r.projectId.toString(),
            orgId: r.orgId.toString(),
            orgName: r.orgName,
            orgSlug: r.orgSlug,
            accessLevel: r.accessLevel,
            grantedAt: r.grantedAt
        })));
    } catch (err) {
        handleError(res, 'fetching project sharing', err);
    }
});

// Share project with organization
router.post('/projects/:projectId/sharing', checkRole('Admin'), async (req, res) => {
    try {
        const projectId = parseInt(req.params.projectId);
        const { orgId, accessLevel } = req.body;
        if (!orgId) return res.status(400).json({ error: 'orgId is required' });

        const level = accessLevel === 'write' ? 'write' : 'read';
        const user = getAuthUser(req);
        const pool = await getPool();

        await pool.request()
            .input('projectId', sql.Int, projectId)
            .input('orgId', sql.Int, parseInt(orgId))
            .input('accessLevel', sql.NVarChar(20), level)
            .input('grantedByOid', sql.NVarChar(100), user?.oid || null)
            .query(`
                MERGE ProjectOrgAccess AS target
                USING (SELECT @projectId, @orgId) AS source (projectId, orgId)
                ON target.projectId = source.projectId AND target.orgId = source.orgId
                WHEN MATCHED THEN UPDATE SET accessLevel = @accessLevel, grantedAt = GETDATE(), grantedByOid = @grantedByOid
                WHEN NOT MATCHED THEN INSERT (projectId, orgId, accessLevel, grantedByOid) VALUES (@projectId, @orgId, @accessLevel, @grantedByOid);
            `);

        logAudit({ action: 'project.share', entityType: 'project', entityId: projectId, entityTitle: 'Share', user, after: { orgId, accessLevel: level }, req });
        res.json({ success: true });
    } catch (err) {
        handleError(res, 'sharing project with organization', err);
    }
});

// Remove project sharing
router.delete('/projects/:projectId/sharing/:orgId', checkRole('Admin'), async (req, res) => {
    try {
        const projectId = parseInt(req.params.projectId);
        const orgId = parseInt(req.params.orgId);
        const pool = await getPool();

        await pool.request()
            .input('projectId', sql.Int, projectId)
            .input('orgId', sql.Int, orgId)
            .query('DELETE FROM ProjectOrgAccess WHERE projectId = @projectId AND orgId = @orgId');

        logAudit({ action: 'project.unshare', entityType: 'project', entityId: projectId, entityTitle: 'Unshare', user: getAuthUser(req), after: { orgId }, req });
        res.json({ success: true });
    } catch (err) {
        handleError(res, 'removing project sharing', err);
    }
});

// ==================== SHARING PICKER DATA (ALL ITEMS, LIGHTWEIGHT) ====================

// Returns all projects and goals for the sharing panel (admin only, no pagination)
router.get('/sharing-picker-data', checkRole('Admin'), async (req, res) => {
    try {
        const pool = await getPool();

        const [projectsResult, tagsResult, goalsResult] = await Promise.all([
            pool.request().query(`
                SELECT id, title, orgId FROM Projects ORDER BY title ASC
            `),
            pool.request().query(`
                SELECT pt.projectId, t.id AS tagId, t.name AS tagName
                FROM ProjectTags pt
                INNER JOIN Tags t ON pt.tagId = t.id
            `),
            pool.request().query(`
                SELECT id, title, type, parentId, orgId FROM Goals ORDER BY title ASC
            `)
        ]);

        // Build tag map
        const tagMap = {};
        tagsResult.recordset.forEach(t => {
            if (!tagMap[t.projectId]) tagMap[t.projectId] = [];
            tagMap[t.projectId].push({ tagId: t.tagId, tagName: t.tagName });
        });

        res.json({
            projects: projectsResult.recordset.map(p => ({
                id: p.id.toString(),
                title: p.title,
                orgId: p.orgId,
                tags: tagMap[p.id] || []
            })),
            goals: goalsResult.recordset.map(g => ({
                id: g.id.toString(),
                title: g.title,
                type: g.type,
                parentId: g.parentId ? g.parentId.toString() : null,
                orgId: g.orgId
            }))
        });
    } catch (err) {
        handleError(res, 'fetching sharing picker data', err);
    }
});

// ==================== ORG SHARING SUMMARY ====================

// Get everything shared with a specific org (projects + goals)
router.get('/organizations/:orgId/sharing-summary', checkRole('Admin'), async (req, res) => {
    try {
        const orgId = parseInt(req.params.orgId);
        const pool = await getPool();

        const projectsResult = await pool.request()
            .input('orgId', sql.Int, orgId)
            .query(`
                SELECT poa.projectId, poa.accessLevel, poa.grantedAt, p.title AS projectTitle
                FROM ProjectOrgAccess poa
                INNER JOIN Projects p ON p.id = poa.projectId
                WHERE poa.orgId = @orgId
                ORDER BY p.title ASC
            `);

        // GoalOrgAccess may not exist yet if migration hasn't been run
        let goalsRecords = [];
        try {
            const goalsResult = await pool.request()
                .input('orgId', sql.Int, orgId)
                .query(`
                    SELECT goa.goalId, goa.accessLevel, goa.grantedAt, g.title AS goalTitle, g.type AS goalType, g.parentId
                    FROM GoalOrgAccess goa
                    INNER JOIN Goals g ON g.id = goa.goalId
                    WHERE goa.orgId = @orgId
                    ORDER BY g.title ASC
                `);
            goalsRecords = goalsResult.recordset;
        } catch (_goalErr) {
            // Table doesn't exist yet — that's OK, just return empty goals
            console.log('GoalOrgAccess table not found — goal sharing will be empty until migration is run');
        }

        res.json({
            projects: projectsResult.recordset.map(r => ({
                projectId: r.projectId.toString(),
                projectTitle: r.projectTitle,
                accessLevel: r.accessLevel,
                grantedAt: r.grantedAt
            })),
            goals: goalsRecords.map(r => ({
                goalId: r.goalId.toString(),
                goalTitle: r.goalTitle,
                goalType: r.goalType,
                parentId: r.parentId ? r.parentId.toString() : null,
                accessLevel: r.accessLevel,
                grantedAt: r.grantedAt
            }))
        });
    } catch (err) {
        handleError(res, 'fetching org sharing summary', err);
    }
});

// ==================== BULK PROJECT SHARING ====================

// Bulk share projects with an org
router.post('/projects/bulk-share', checkRole('Admin'), async (req, res) => {
    try {
        const { projectIds, orgId, accessLevel } = req.body;
        if (!Array.isArray(projectIds) || !orgId) {
            return res.status(400).json({ error: 'projectIds (array) and orgId are required' });
        }

        const level = accessLevel === 'write' ? 'write' : 'read';
        const user = getAuthUser(req);
        const pool = await getPool();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            for (const projectId of projectIds) {
                const request = new sql.Request(transaction);
                await request
                    .input('projectId', sql.Int, parseInt(projectId))
                    .input('orgId', sql.Int, parseInt(orgId))
                    .input('accessLevel', sql.NVarChar(20), level)
                    .input('grantedByOid', sql.NVarChar(100), user?.oid || null)
                    .query(`
                        MERGE ProjectOrgAccess AS target
                        USING (SELECT @projectId, @orgId) AS source (projectId, orgId)
                        ON target.projectId = source.projectId AND target.orgId = source.orgId
                        WHEN MATCHED THEN UPDATE SET accessLevel = @accessLevel, grantedAt = GETDATE(), grantedByOid = @grantedByOid
                        WHEN NOT MATCHED THEN INSERT (projectId, orgId, accessLevel, grantedByOid) VALUES (@projectId, @orgId, @accessLevel, @grantedByOid);
                    `);
            }
            await transaction.commit();
            logAudit({ action: 'project.bulk_share', entityType: 'project', entityId: null, entityTitle: `${projectIds.length} projects shared`, user, after: { orgId, accessLevel: level, count: projectIds.length }, req });
            res.json({ success: true, count: projectIds.length });
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    } catch (err) {
        handleError(res, 'bulk sharing projects', err);
    }
});

// Bulk unshare projects from an org
router.post('/projects/bulk-unshare', checkRole('Admin'), async (req, res) => {
    try {
        const { projectIds, orgId } = req.body;
        if (!Array.isArray(projectIds) || !orgId) {
            return res.status(400).json({ error: 'projectIds (array) and orgId are required' });
        }

        const pool = await getPool();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            for (const projectId of projectIds) {
                const request = new sql.Request(transaction);
                await request
                    .input('projectId', sql.Int, parseInt(projectId))
                    .input('orgId', sql.Int, parseInt(orgId))
                    .query('DELETE FROM ProjectOrgAccess WHERE projectId = @projectId AND orgId = @orgId');
            }
            await transaction.commit();
            logAudit({ action: 'project.bulk_unshare', entityType: 'project', entityId: null, entityTitle: `${projectIds.length} projects unshared`, user: getAuthUser(req), after: { orgId, count: projectIds.length }, req });
            res.json({ success: true, count: projectIds.length });
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    } catch (err) {
        handleError(res, 'bulk unsharing projects', err);
    }
});

// ==================== GOAL SHARING ====================

// Get organizations a goal is shared with
router.get('/goals/:goalId/sharing', checkRole('Admin'), async (req, res) => {
    try {
        const goalId = parseInt(req.params.goalId);
        const pool = await getPool();
        const result = await pool.request()
            .input('goalId', sql.Int, goalId)
            .query(`
                SELECT goa.*, o.name AS orgName, o.slug AS orgSlug
                FROM GoalOrgAccess goa
                INNER JOIN Organizations o ON o.id = goa.orgId
                WHERE goa.goalId = @goalId
            `);
        res.json(result.recordset.map(r => ({
            goalId: r.goalId.toString(),
            orgId: r.orgId.toString(),
            orgName: r.orgName,
            orgSlug: r.orgSlug,
            accessLevel: r.accessLevel,
            grantedAt: r.grantedAt
        })));
    } catch (err) {
        handleError(res, 'fetching goal sharing', err);
    }
});

// Share goal with organization (includes descendant goals automatically)
router.post('/goals/:goalId/sharing', checkRole('Admin'), async (req, res) => {
    try {
        const goalId = parseInt(req.params.goalId);
        const { orgId, accessLevel, includeDescendants } = req.body;
        if (!orgId) return res.status(400).json({ error: 'orgId is required' });

        const level = accessLevel === 'write' ? 'write' : 'read';
        const user = getAuthUser(req);
        const pool = await getPool();

        // Collect goal IDs to share (the goal + optionally its descendants)
        let goalIds = [goalId];

        if (includeDescendants !== false) {
            // Recursive CTE to find all descendant goals
            const descendants = await pool.request()
                .input('rootId', sql.Int, goalId)
                .query(`
                    WITH GoalTree AS (
                        SELECT id FROM Goals WHERE id = @rootId
                        UNION ALL
                        SELECT g.id FROM Goals g INNER JOIN GoalTree gt ON g.parentId = gt.id
                    )
                    SELECT id FROM GoalTree
                `);
            goalIds = descendants.recordset.map(r => r.id);
        }

        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            for (const gId of goalIds) {
                const request = new sql.Request(transaction);
                await request
                    .input('goalId', sql.Int, gId)
                    .input('orgId', sql.Int, parseInt(orgId))
                    .input('accessLevel', sql.NVarChar(20), level)
                    .input('grantedByOid', sql.NVarChar(100), user?.oid || null)
                    .query(`
                        MERGE GoalOrgAccess AS target
                        USING (SELECT @goalId, @orgId) AS source (goalId, orgId)
                        ON target.goalId = source.goalId AND target.orgId = source.orgId
                        WHEN MATCHED THEN UPDATE SET accessLevel = @accessLevel, grantedAt = GETDATE(), grantedByOid = @grantedByOid
                        WHEN NOT MATCHED THEN INSERT (goalId, orgId, accessLevel, grantedByOid) VALUES (@goalId, @orgId, @accessLevel, @grantedByOid);
                    `);
            }
            await transaction.commit();
            logAudit({ action: 'goal.share', entityType: 'goal', entityId: goalId, entityTitle: 'Goal Share', user, after: { orgId, accessLevel: level, goalCount: goalIds.length }, req });
            res.json({ success: true, sharedGoalCount: goalIds.length });
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    } catch (err) {
        handleError(res, 'sharing goal with organization', err);
    }
});

// Remove goal sharing
router.delete('/goals/:goalId/sharing/:orgId', checkRole('Admin'), async (req, res) => {
    try {
        const goalId = parseInt(req.params.goalId);
        const orgId = parseInt(req.params.orgId);
        const pool = await getPool();

        await pool.request()
            .input('goalId', sql.Int, goalId)
            .input('orgId', sql.Int, orgId)
            .query('DELETE FROM GoalOrgAccess WHERE goalId = @goalId AND orgId = @orgId');

        logAudit({ action: 'goal.unshare', entityType: 'goal', entityId: goalId, entityTitle: 'Goal Unshare', user: getAuthUser(req), after: { orgId }, req });
        res.json({ success: true });
    } catch (err) {
        handleError(res, 'removing goal sharing', err);
    }
});

// Bulk share goals with an org
router.post('/goals/bulk-share', checkRole('Admin'), async (req, res) => {
    try {
        const { goalIds, orgId, accessLevel, includeDescendants } = req.body;
        if (!Array.isArray(goalIds) || !orgId) {
            return res.status(400).json({ error: 'goalIds (array) and orgId are required' });
        }

        const level = accessLevel === 'write' ? 'write' : 'read';
        const user = getAuthUser(req);
        const pool = await getPool();

        // Expand to include descendants if requested
        let allGoalIds = [...goalIds.map(id => parseInt(id))];

        if (includeDescendants !== false && allGoalIds.length > 0) {
            const placeholders = allGoalIds.map((_, i) => `@gid${i}`).join(',');
            const request = pool.request();
            allGoalIds.forEach((id, i) => request.input(`gid${i}`, sql.Int, id));
            const descendants = await request.query(`
                WITH GoalTree AS (
                    SELECT id FROM Goals WHERE id IN (${placeholders})
                    UNION ALL
                    SELECT g.id FROM Goals g INNER JOIN GoalTree gt ON g.parentId = gt.id
                )
                SELECT DISTINCT id FROM GoalTree
            `);
            allGoalIds = descendants.recordset.map(r => r.id);
        }

        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            for (const gId of allGoalIds) {
                const request = new sql.Request(transaction);
                await request
                    .input('goalId', sql.Int, gId)
                    .input('orgId', sql.Int, parseInt(orgId))
                    .input('accessLevel', sql.NVarChar(20), level)
                    .input('grantedByOid', sql.NVarChar(100), user?.oid || null)
                    .query(`
                        MERGE GoalOrgAccess AS target
                        USING (SELECT @goalId, @orgId) AS source (goalId, orgId)
                        ON target.goalId = source.goalId AND target.orgId = source.orgId
                        WHEN MATCHED THEN UPDATE SET accessLevel = @accessLevel, grantedAt = GETDATE(), grantedByOid = @grantedByOid
                        WHEN NOT MATCHED THEN INSERT (goalId, orgId, accessLevel, grantedByOid) VALUES (@goalId, @orgId, @accessLevel, @grantedByOid);
                    `);
            }
            await transaction.commit();
            logAudit({ action: 'goal.bulk_share', entityType: 'goal', entityId: null, entityTitle: `${allGoalIds.length} goals shared`, user, after: { orgId, accessLevel: level, count: allGoalIds.length }, req });
            res.json({ success: true, count: allGoalIds.length });
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    } catch (err) {
        handleError(res, 'bulk sharing goals', err);
    }
});

// Bulk unshare goals from an org
router.post('/goals/bulk-unshare', checkRole('Admin'), async (req, res) => {
    try {
        const { goalIds, orgId } = req.body;
        if (!Array.isArray(goalIds) || !orgId) {
            return res.status(400).json({ error: 'goalIds (array) and orgId are required' });
        }

        const pool = await getPool();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            for (const goalId of goalIds) {
                const request = new sql.Request(transaction);
                await request
                    .input('goalId', sql.Int, parseInt(goalId))
                    .input('orgId', sql.Int, parseInt(orgId))
                    .query('DELETE FROM GoalOrgAccess WHERE goalId = @goalId AND orgId = @orgId');
            }
            await transaction.commit();
            logAudit({ action: 'goal.bulk_unshare', entityType: 'goal', entityId: null, entityTitle: `${goalIds.length} goals unshared`, user: getAuthUser(req), after: { orgId, count: goalIds.length }, req });
            res.json({ success: true, count: goalIds.length });
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    } catch (err) {
        handleError(res, 'bulk unsharing goals', err);
    }
});

export default router;
