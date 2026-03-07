import express from 'express';
import { getPool, sql } from '../db.js';
import { requireAuth, checkPermission } from '../middleware/authMiddleware.js';

const router = express.Router();

// Get current user with organization info
router.get('/me', requireAuth, async (req, res) => {
    try {
        const user = { ...req.user };
        
        // Attach org info if user has an orgId
        if (user.orgId) {
            const pool = await getPool();
            const orgResult = await pool.request()
                .input('orgId', sql.Int, user.orgId)
                .query('SELECT id, name, slug FROM Organizations WHERE id = @orgId');
            
            if (orgResult.recordset.length > 0) {
                user.organization = orgResult.recordset[0];
            }
        }
        
        res.json(user);
    } catch (_err) {
        // Fallback: return user without org info
        res.json(req.user);
    }
});

// List users that can be assigned tasks.
// Non-admin users are restricted to their organization users.
router.get('/assignable', checkPermission(['can_view_projects', 'can_edit_project']), async (req, res) => {
    try {
        const rawQuery = typeof req.query.q === 'string' ? req.query.q.trim() : '';
        const requestedLimit = parseInt(req.query.limit, 10);
        const limit = Number.isNaN(requestedLimit)
            ? 100
            : Math.max(1, Math.min(300, requestedLimit));

        const roles = Array.isArray(req.user?.roles) ? req.user.roles : [];
        const isAdmin = roles.includes('Admin');
        const orgId = req.user?.orgId || null;

        const pool = await getPool();
        const request = pool.request()
            .input('limit', sql.Int, limit);

        const whereConditions = [];

        if (!isAdmin) {
            if (!orgId) {
                whereConditions.push('u.oid = @currentOid');
                request.input('currentOid', sql.NVarChar(100), String(req.user?.oid || ''));
            } else {
                whereConditions.push('u.orgId = @orgId');
                request.input('orgId', sql.Int, orgId);
            }
        }

        if (rawQuery) {
            request.input('qContains', sql.NVarChar(260), `%${rawQuery}%`);
            whereConditions.push('(u.name LIKE @qContains OR u.email LIKE @qContains OR u.oid LIKE @qContains)');
        }

        const whereClause = whereConditions.length > 0
            ? `WHERE ${whereConditions.join(' AND ')}`
            : '';

        const result = await request.query(`
            SELECT TOP (@limit)
                u.oid,
                u.name,
                u.email,
                u.orgId
            FROM Users u
            ${whereClause}
            ORDER BY u.name ASC
        `);

        res.json(result.recordset.map((u) => ({
            oid: u.oid,
            name: u.name,
            email: u.email || null,
            orgId: u.orgId ? String(u.orgId) : null
        })));
    } catch (_err) {
        res.status(500).json({ error: 'Failed to load assignable users' });
    }
});

export default router;
