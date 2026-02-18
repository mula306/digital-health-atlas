import express from 'express';
import { getPool } from '../db.js';
import { checkPermission } from '../middleware/authMiddleware.js';
import { handleError } from '../utils/errorHandler.js';
import { cache, CACHE_KEYS } from '../utils/cache.js';

const router = express.Router();

// Get all tag groups with their tags and aliases
router.get('/', checkPermission(['can_view_projects', 'can_view_exec_dashboard']), async (req, res) => {
    try {
        const cached = cache.get(CACHE_KEYS.TAG_GROUPS);
        if (cached) return res.json(cached);

        const pool = await getPool();
        const [groupsResult, tagsResult, aliasesResult] = await Promise.all([
            pool.request().query('SELECT * FROM TagGroups ORDER BY sortOrder'),
            pool.request().query('SELECT * FROM Tags ORDER BY sortOrder'),
            pool.request().query('SELECT * FROM TagAliases')
        ]);

        // Build alias lookup
        const aliasesByTag = {};
        aliasesResult.recordset.forEach(a => {
            if (!aliasesByTag[a.tagId]) aliasesByTag[a.tagId] = [];
            aliasesByTag[a.tagId].push({ id: a.id, alias: a.alias });
        });

        const groups = groupsResult.recordset.map(g => ({
            id: g.id.toString(),
            name: g.name,
            slug: g.slug,
            requirePrimary: g.requirePrimary,
            sortOrder: g.sortOrder,
            tags: tagsResult.recordset
                .filter(t => t.groupId === g.id)
                .map(t => ({
                    id: t.id.toString(),
                    groupId: t.groupId.toString(),
                    name: t.name,
                    slug: t.slug,
                    status: t.status,
                    color: t.color,
                    sortOrder: t.sortOrder,
                    aliases: (aliasesByTag[t.id] || []).map(a => ({ id: a.id.toString(), alias: a.alias }))
                }))
        }));

        cache.set(CACHE_KEYS.TAG_GROUPS, groups);
        res.json(groups);
    } catch (err) {
        handleError(res, 'fetching tags', err);
    }
});

export default router;
