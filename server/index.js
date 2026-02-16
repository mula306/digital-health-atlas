import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import NodeCache from 'node-cache';
import { getPool, sql } from './db.js';
import { logAudit } from './utils/auditLogger.js';
import { seedPermissions } from './utils/seedPermissions.js';

const app = express();
const PORT = 3001;
const IS_DEVELOPMENT = process.env.NODE_ENV !== 'production';

// Initialize cache with 60 second TTL
const cache = new NodeCache({ stdTTL: 60, checkperiod: 120 });

// Rate Limiter: 5000 requests per 15 minutes in Dev, 100 in Prod
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: IS_DEVELOPMENT ? 5000 : 100, // Limit each IP to 5000 requests per windowMs in dev
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
    message: { error: 'Too many requests, please try again later.' }
});

// Middleware
app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    contentSecurityPolicy: IS_DEVELOPMENT ? false : {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "https://alcdn.msauth.net", "https://aadcdn.msauth.net"],
            connectSrc: ["'self'", "https://login.microsoftonline.com"],
            imgSrc: ["'self'", "data:", "blob:"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            objectSrc: ["'none'"],
            upgradeInsecureRequests: [],
        }
    }
}));

// CORS Configuration
const corsOptions = {
    origin: function (origin, callback) {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);

        // Check for allowed domains/IPs
        // 1. Localhost
        // 2. 192.168.x.x (Local Network)
        // 3. 10.x.x.x (Private Network)
        // 4. 172.x.x.x (Private/Docker)
        // 5. DigitalOcean App Platform (optional future proofing)
        // Regex for local network IPs: support both http and https
        const isLocalNetwork = /^https?:\/\/192\.168\.\d{1,3}\.\d{1,3}(:\d+)?$/.test(origin) ||
            /^https?:\/\/10\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?$/.test(origin) ||
            /^https?:\/\/172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}(:\d+)?$/.test(origin);

        const allowedOrigins = [
            'http://localhost:5173',
            'https://localhost:5173',
            'http://localhost:4173',
            'http://localhost:3000'
        ];

        if (allowedOrigins.indexOf(origin) !== -1 || isLocalNetwork || origin === process.env.CORS_ORIGIN) {
            callback(null, true);
        } else {
            console.log('Blocked by CORS:', origin);
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    optionsSuccessStatus: 200
};
app.use(cors(corsOptions));

app.use(compression()); // Enable gzip compression
app.use(express.json({ limit: '1mb' }));

// Global request logger
app.use((req, res, next) => {
    const start = Date.now();
    const logPrefix = `[${new Date().toISOString()}] ${req.method} ${req.url}`;
    console.log(`${logPrefix} - Pending`);

    // Log response
    res.on('finish', () => {
        const duration = Date.now() - start;
        console.log(`${logPrefix} - ${res.statusCode} (${duration}ms)`);
    });
    next();
});

import passport from './auth.js';
import { checkPermission, checkRole, invalidatePermissionCache } from './middleware/authMiddleware.js';

// Initialize Passport
app.use(passport.initialize());

// Safe error handler - logs details server-side, returns generic message to client
function handleError(res, context, err) {
    console.error(`Error ${context}:`, err);
    // Only show detailed errors in development
    const message = IS_DEVELOPMENT ? err.message : 'An internal error occurred';
    res.status(500).json({ error: message });
}

// Helper to get authenticated user from request
function getAuthUser(req) {
    return req.user || null;
}


// Apply rate limiting and authentication to all API routes
// Note: We authenticate AFTER rate limiting to prevent auth attacks from bypassing limits
app.use('/api/', limiter);

// Protect API routes with Azure AD (JWT)
if (process.env.AZURE_CLIENT_ID) {
    // Use custom callback to handle auth errors and allow optional auth
    app.use('/api/', (req, res, next) => {
        passport.authenticate('jwt', { session: false }, (err, user, info) => {
            if (err) {
                console.error('Passport Error:', err);
                return next(err);
            }
            if (!user) {
                // Log the reason for failure (e.g. "No auth token", "jwt expired")
                // Only log detailed info if it's NOT just "No auth token" to avoid spam on public endpoints
                if (info && info.message !== 'No auth token') {
                    console.log('Passport Info (Auth Failed/Skipped):', info.message || info);
                }

                // Allow request to proceed as anonymous
                // The route handlers will decide if they need to enforce auth
                req.user = null;
                return next();
            }

            // Success
            req.user = user;
            return next();
        })(req, res, next);
    });
} else {
    console.warn("WARNING: Azure Auth not configured. API is unprotected.");
}



// ==================== GOALS ====================

// Get all goals with KPIs
app.get('/api/goals', checkPermission(['can_view_goals', 'can_view_exec_dashboard']), async (req, res) => {
    try {
        const pool = await getPool();
        const goalsResult = await pool.request().query('SELECT * FROM Goals ORDER BY id');
        const kpisResult = await pool.request().query('SELECT * FROM KPIs');

        const goals = goalsResult.recordset.map(goal => ({
            id: goal.id.toString(),
            title: goal.title,
            type: goal.type,
            parentId: goal.parentId ? goal.parentId.toString() : null,
            createdAt: goal.createdAt,
            kpis: kpisResult.recordset
                .filter(k => k.goalId === goal.id)
                .map(k => ({
                    id: k.id.toString(),
                    name: k.name,
                    target: k.target,
                    current: k.currentValue,
                    unit: k.unit
                }))
        }));

        res.json(goals);
    } catch (err) {
        handleError(res, 'fetching goals', err);
    }
});

// Create goal
app.post('/api/goals', checkPermission('can_create_goal'), async (req, res) => {
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
app.put('/api/goals/:id', checkPermission('can_edit_goal'), async (req, res) => {
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
app.delete('/api/goals/:id', checkPermission('can_delete_goal'), async (req, res) => {
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

// ==================== KPIs ====================

// Add KPI to goal
app.post('/api/goals/:goalId/kpis', checkPermission('can_manage_kpis'), async (req, res) => {
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

// Update KPI
app.put('/api/kpis/:id', checkPermission('can_manage_kpis'), async (req, res) => {
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
app.delete('/api/kpis/:id', checkPermission('can_manage_kpis'), async (req, res) => {
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

// ==================== TAGS ====================

// Helper to invalidate tag cache
function invalidateTagCache() {
    cache.del('tagGroups');
}

// Get all tag groups with their tags and aliases
app.get('/api/tags', checkPermission(['can_view_projects', 'can_view_exec_dashboard']), async (req, res) => {
    try {
        const cached = cache.get('tagGroups');
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

        cache.set('tagGroups', groups);
        res.json(groups);
    } catch (err) {
        handleError(res, 'fetching tags', err);
    }
});

// Create tag group (Admin)
app.post('/api/admin/tag-groups', checkPermission('can_manage_tags'), async (req, res) => {
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
app.put('/api/admin/tag-groups/:id', checkPermission('can_manage_tags'), async (req, res) => {
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
app.delete('/api/admin/tag-groups/:id', checkPermission('can_manage_tags'), async (req, res) => {
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

// Create tag (Admin)
app.post('/api/admin/tags', checkPermission('can_manage_tags'), async (req, res) => {
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
app.put('/api/admin/tags/:id', checkPermission('can_manage_tags'), async (req, res) => {
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
app.delete('/api/admin/tags/:id', checkPermission('can_manage_tags'), async (req, res) => {
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

// Set tags for a project (validates all rules)
app.put('/api/projects/:id/tags', checkPermission('can_edit_project'), async (req, res) => {
    try {
        const projectId = parseInt(req.params.id);
        const { tags } = req.body; // Array of { tagId, isPrimary }

        if (!Array.isArray(tags)) return res.status(400).json({ error: 'tags must be an array' });

        // Validate: 0-8 tags
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

        // Validate primary tags for requirePrimary groups
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

        // Transaction: replace all project tags
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

// ==================== PROJECTS ====================

// Helper to invalidate project cache
function invalidateProjectCache() {
    const keys = cache.keys().filter(k => k.startsWith('projects_'));
    keys.forEach(k => cache.del(k));
}

// Get all projects with tasks and status reports (OPTIMIZED with JOINs and pagination)
app.get('/api/projects', checkPermission(['can_view_projects', 'can_view_exec_dashboard']), async (req, res) => {
    try {
        // Pagination params
        const page = parseInt(req.query.page) || 1;
        let limit = parseInt(req.query.limit) || 50;
        if (limit > 100) limit = 100; // Clamp limit
        const offset = (page - 1) * limit;
        const search = req.query.search || '';
        const goalId = req.query.goalId || null;

        // Check cache first
        const cacheKey = `projects_${page}_${limit}_${search}_${goalId}`;
        const cached = cache.get(cacheKey);
        if (cached) {
            return res.json(cached);
        }

        const pool = await getPool();

        // Build WHERE clause for filtering
        let whereClause = '';
        const conditions = [];
        if (search) {
            conditions.push(`(p.title LIKE @search OR p.description LIKE @search)`);
        }
        if (goalId) {
            conditions.push(`p.goalId = @goalId`);
        }
        if (conditions.length > 0) {
            whereClause = 'WHERE ' + conditions.join(' AND ');
        }

        // Get total count for pagination metadata
        const countRequest = pool.request();
        if (search) countRequest.input('search', sql.NVarChar, `%${search}%`);
        if (goalId) countRequest.input('goalId', sql.Int, parseInt(goalId));
        const countResult = await countRequest.query(`SELECT COUNT(*) as total FROM Projects p ${whereClause}`);
        const totalProjects = countResult.recordset[0].total;
        const totalPages = Math.ceil(totalProjects / limit);

        // Single optimized query with JOIN - fetch projects with pagination
        const projectRequest = pool.request()
            .input('offset', sql.Int, offset)
            .input('limit', sql.Int, limit);
        if (search) projectRequest.input('search', sql.NVarChar, `%${search}%`);
        if (goalId) projectRequest.input('goalId', sql.Int, parseInt(goalId));

        const projectsResult = await projectRequest.query(`
            SELECT p.id, p.title, p.description, p.status, p.goalId, p.createdAt
            FROM Projects p
            ${whereClause}
            ORDER BY p.id
            OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
        `);

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
        const tasksRequest = pool.request();
        const reportsRequest = pool.request();
        const projectTagsRequest = pool.request();

        // Build parameterized IN clause
        const idParams = projectIds.map((id, i) => {
            tasksRequest.input(`id${i}`, sql.Int, id);
            reportsRequest.input(`id${i}`, sql.Int, id);
            projectTagsRequest.input(`id${i}`, sql.Int, id);
            return `@id${i}`;
        }).join(',');

        // Create request for latest reports and bind same parameters
        const latestReportsRequest = pool.request();
        projectIds.forEach((id, i) => {
            latestReportsRequest.input(`id${i}`, sql.Int, id);
        });

        const [tasksResult, reportsResult, latestReportsResult, projectTagsResult] = await Promise.all([
            // Fetch only necessary task fields active tasks filtering
            // Note: dueDate does not exist in schema, using endDate
            tasksRequest.query(`SELECT projectId, id, title, status, endDate FROM Tasks WHERE projectId IN (${idParams})`),
            reportsRequest.query(`SELECT projectId, COUNT(*) as count FROM StatusReports WHERE projectId IN (${idParams}) GROUP BY projectId`),
            // Fetch latest report for each project efficiently
            latestReportsRequest.query(`
                SELECT r.projectId, r.reportData, r.version, r.createdAt, r.createdBy
                FROM StatusReports r
                INNER JOIN (
                    SELECT projectId, MAX(version) as maxVersion
                    FROM StatusReports
                    WHERE projectId IN (${idParams})
                    GROUP BY projectId
                ) latest ON r.projectId = latest.projectId AND r.version = latest.maxVersion
            `),
            // Fetch project tags
            projectTagsRequest.query(`
                SELECT pt.projectId, pt.tagId, pt.isPrimary, t.name, t.slug, t.color, t.groupId, t.status AS tagStatus
                FROM ProjectTags pt
                INNER JOIN Tags t ON pt.tagId = t.id
                WHERE pt.projectId IN (${idParams})
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

        projectIds.forEach(pid => {
            const tasks = projectTasks[pid] || [];
            if (tasks.length === 0) {
                completionMap.set(pid, 0);
            } else {
                const doneCount = tasks.filter(t => t.status === 'done').length;
                completionMap.set(pid, Math.round((doneCount / tasks.length) * 100));
            }
        });

        // Better way: separate map for counts and active tasks
        const completedCountMap = new Map();
        const activeTasksMap = new Map();

        projectIds.forEach(pid => {
            const tasks = projectTasks[pid] || [];
            const doneCount = tasks.filter(t => t.status === 'done').length;
            completedCountMap.set(pid, doneCount);

            // Filter for active tasks (not done) to send to client for Dashboard lists
            // We only need specific fields for the dashboard: id, title, status, endDate, dueDate
            const activeTasks = tasks
                .filter(t => t.status !== 'done')
                .map(t => ({
                    id: t.id, // Keep as is (likely number or string depending on driver, but safer to match source)
                    title: t.title,
                    status: t.status,
                    endDate: t.endDate
                    // dueDate not needed/does not exist
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
app.get('/api/projects/:id', checkPermission('can_view_projects'), async (req, res) => {
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
app.post('/api/projects', checkPermission('can_create_project'), async (req, res) => {
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
app.put('/api/projects/:id', checkPermission('can_edit_project'), async (req, res) => {
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
app.delete('/api/projects/:id', checkPermission('can_delete_project'), async (req, res) => {
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

// ==================== TASKS ====================

// Add task to project
app.post('/api/projects/:projectId/tasks', checkPermission('can_edit_project'), async (req, res) => {
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

// Update task
app.put('/api/tasks/:id', checkPermission('can_edit_project'), async (req, res) => {
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
app.delete('/api/tasks/:id', checkPermission('can_edit_project'), async (req, res) => {
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


// Get status reports for a project
app.get('/api/projects/:projectId/reports', checkPermission('can_view_projects'), async (req, res) => {
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
app.post('/api/projects/:projectId/reports', checkPermission('can_create_reports'), async (req, res) => {
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

// ==================== INTAKE FORMS ====================

// Get all intake forms
app.get('/api/intake/forms', checkPermission('can_view_intake'), async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request().query('SELECT * FROM IntakeForms ORDER BY id');

        const forms = result.recordset.map(form => ({
            id: form.id.toString(),
            name: form.name,
            description: form.description,
            fields: JSON.parse(form.fields || '[]'),
            defaultGoalId: form.defaultGoalId ? form.defaultGoalId.toString() : null,
            createdAt: form.createdAt
        }));

        res.json(forms);
    } catch (err) {
        handleError(res, 'fetching intake forms', err);
    }
});

// Create intake form
app.post('/api/intake/forms', checkPermission('can_manage_intake'), async (req, res) => {
    try {
        const { name, description, fields, defaultGoalId } = req.body;
        const pool = await getPool();
        const result = await pool.request()
            .input('name', sql.NVarChar, name)
            .input('description', sql.NVarChar, description)
            .input('fields', sql.NVarChar, JSON.stringify(fields))
            .input('defaultGoalId', sql.Int, defaultGoalId ? parseInt(defaultGoalId) : null)
            .query('INSERT INTO IntakeForms (name, description, fields, defaultGoalId) OUTPUT INSERTED.id, INSERTED.createdAt VALUES (@name, @description, @fields, @defaultGoalId)');

        const newId = result.recordset[0].id.toString();
        logAudit({ action: 'intake_form.create', entityType: 'intake_form', entityId: newId, entityTitle: name, user: getAuthUser(req), after: { name, description, defaultGoalId }, req });
        res.json({
            id: newId,
            name,
            description,
            fields,
            defaultGoalId,
            createdAt: result.recordset[0].createdAt
        });
    } catch (err) {
        handleError(res, 'creating intake form', err);
    }
});

// Update intake form
app.put('/api/intake/forms/:id', checkPermission('can_manage_intake_forms'), async (req, res) => {
    try {
        const { name, description, fields, defaultGoalId } = req.body;
        const id = parseInt(req.params.id);
        const pool = await getPool();
        const prev = await pool.request().input('id', sql.Int, id).query('SELECT name, description, defaultGoalId FROM IntakeForms WHERE id = @id');
        await pool.request()
            .input('id', sql.Int, id)
            .input('name', sql.NVarChar, name)
            .input('description', sql.NVarChar, description)
            .input('fields', sql.NVarChar, JSON.stringify(fields))
            .input('defaultGoalId', sql.Int, defaultGoalId ? parseInt(defaultGoalId) : null)
            .query('UPDATE IntakeForms SET name = @name, description = @description, fields = @fields, defaultGoalId = @defaultGoalId WHERE id = @id');

        logAudit({ action: 'intake_form.update', entityType: 'intake_form', entityId: id, entityTitle: name, user: getAuthUser(req), before: prev.recordset[0], after: { name, description, defaultGoalId }, req });
        res.json({ success: true });
    } catch (err) {
        handleError(res, 'updating intake form', err);
    }
});

// Delete intake form
app.delete('/api/intake/forms/:id', checkPermission('can_manage_intake_forms'), async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const pool = await getPool();
        const prev = await pool.request().input('id', sql.Int, id).query('SELECT name FROM IntakeForms WHERE id = @id');
        await pool.request()
            .input('id', sql.Int, id)
            .query('DELETE FROM IntakeForms WHERE id = @id');

        logAudit({ action: 'intake_form.delete', entityType: 'intake_form', entityId: id, entityTitle: prev.recordset[0]?.name, user: getAuthUser(req), before: prev.recordset[0], req });
        res.json({ success: true });
    } catch (err) {
        handleError(res, 'deleting intake form', err);
    }
});

// ==================== INTAKE SUBMISSIONS ====================

// Get all submissions (Admin/Manager only)
app.get('/api/intake/submissions', checkPermission('can_view_incoming_requests'), async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request().query('SELECT * FROM IntakeSubmissions ORDER BY submittedAt DESC');

        const submissions = result.recordset.map(sub => {
            const storedData = JSON.parse(sub.infoRequests || '[]');
            const isConversationFormat = storedData.length > 0 && storedData[0]?.type;

            return {
                id: sub.id.toString(),
                formId: sub.formId.toString(),
                formData: JSON.parse(sub.formData || '{}'),
                status: sub.status,
                conversation: isConversationFormat ? storedData : [],
                convertedProjectId: sub.convertedProjectId ? sub.convertedProjectId.toString() : null,
                submittedAt: sub.submittedAt,
                submitterName: sub.submitterName,
                submitterEmail: sub.submitterEmail
            };
        });

        res.json(submissions);
    } catch (err) {
        handleError(res, 'fetching submissions', err);
    }
});

// Get MY submissions (Authenticated User)
app.get('/api/intake/my-submissions', async (req, res) => {
    try {
        const user = getAuthUser(req);
        if (!user) return res.status(401).json({ error: 'Unauthorized' });

        const pool = await getPool();
        const result = await pool.request()
            .input('submitterId', sql.NVarChar, user.oid)
            .query('SELECT * FROM IntakeSubmissions WHERE submitterId = @submitterId ORDER BY submittedAt DESC');

        const submissions = result.recordset.map(sub => {
            const storedData = JSON.parse(sub.infoRequests || '[]');
            const isConversationFormat = storedData.length > 0 && storedData[0]?.type;

            return {
                id: sub.id.toString(),
                formId: sub.formId.toString(),
                formData: JSON.parse(sub.formData || '{}'),
                status: sub.status,
                conversation: isConversationFormat ? storedData : [],
                convertedProjectId: sub.convertedProjectId ? sub.convertedProjectId.toString() : null,
                submittedAt: sub.submittedAt
            };
        });

        res.json(submissions);
    } catch (err) {
        handleError(res, 'fetching my submissions', err);
    }
});

// Create submission (Authenticated)
app.post('/api/intake/submissions', async (req, res) => {
    try {
        const user = getAuthUser(req);
        if (!user) return res.status(401).json({ error: 'Unauthorized' });

        const { formId, formData } = req.body;
        const pool = await getPool();

        const result = await pool.request()
            .input('formId', sql.Int, parseInt(formId))
            .input('formData', sql.NVarChar, JSON.stringify(formData))
            .input('submitterId', sql.NVarChar, user ? user.oid : null)
            .input('submitterName', sql.NVarChar, user ? user.name : null)
            .input('submitterEmail', sql.NVarChar, user ? user.preferred_username : null) // Azure AD often puts email here
            .query('INSERT INTO IntakeSubmissions (formId, formData, infoRequests, submitterId, submitterName, submitterEmail) OUTPUT INSERTED.id, INSERTED.submittedAt VALUES (@formId, @formData, \'[]\', @submitterId, @submitterName, @submitterEmail)');

        const newSubId = result.recordset[0].id.toString();
        logAudit({ action: 'submission.create', entityType: 'submission', entityId: newSubId, entityTitle: `Form ${formId}`, user, after: { formId, status: 'pending' }, req });
        res.json({
            id: newSubId,
            formId,
            formData,
            status: 'pending',
            infoRequests: [],
            convertedProjectId: null,
            submittedAt: result.recordset[0].submittedAt
        });
    } catch (err) {
        handleError(res, 'creating submission', err);
    }
});

// Update submission status (Admin only)
app.put('/api/intake/submissions/:id', checkPermission('can_manage_intake'), async (req, res) => {
    try {
        const { status, convertedProjectId } = req.body;
        const id = parseInt(req.params.id);
        const pool = await getPool();
        const prev = await pool.request().input('id', sql.Int, id).query('SELECT status, convertedProjectId FROM IntakeSubmissions WHERE id = @id');

        await pool.request()
            .input('id', sql.Int, id)
            .input('status', sql.NVarChar, status)
            .input('convertedProjectId', sql.Int, convertedProjectId ? parseInt(convertedProjectId) : null)
            .query('UPDATE IntakeSubmissions SET status = @status, convertedProjectId = @convertedProjectId WHERE id = @id');

        logAudit({ action: 'submission.status_update', entityType: 'submission', entityId: id, entityTitle: status, user: getAuthUser(req), before: { status: prev.recordset[0]?.status }, after: { status, convertedProjectId }, req });
        res.json({ success: true });
    } catch (err) {
        handleError(res, 'updating submission', err);
    }
});

// Add Message to Conversation (User or Admin)
app.post('/api/intake/submissions/:id/message', async (req, res) => {
    try {
        const user = getAuthUser(req);
        if (!user) return res.status(401).json({ error: 'Unauthorized' });

        const submissionId = parseInt(req.params.id);
        const { message } = req.body;

        if (!message) return res.status(400).json({ error: 'Message required' });

        const pool = await getPool();

        // Fetch current conversation
        const subResult = await pool.request()
            .input('id', sql.Int, submissionId)
            .query('SELECT infoRequests, submitterId FROM IntakeSubmissions WHERE id = @id');

        if (subResult.recordset.length === 0) return res.status(404).json({ error: 'Submission not found' });

        const submission = subResult.recordset[0];
        const conversation = JSON.parse(submission.infoRequests || '[]');

        // Determine role and validate access
        // Admin can message any. Submitter can only message own.
        const isAdmin = user.roles && (user.roles.includes('Admin') || user.roles.includes('Editor'));
        const isOwner = submission.submitterId === user.oid;

        if (!isAdmin && !isOwner) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        const senderType = isAdmin ? 'admin' : 'requester';

        // Add new message
        conversation.push({
            id: `msg-${Date.now()}`,
            type: senderType,
            message: message,
            timestamp: new Date().toISOString(),
            read: false,
            senderName: user.name
        });

        // Update DB (also update status if needed)
        let statusUpdate = '';
        if (senderType === 'admin') statusUpdate = ", status = 'awaiting-response'";
        if (senderType === 'requester') statusUpdate = ", status = 'pending'"; // Re-open for admin review

        const request = pool.request()
            .input('id', sql.Int, submissionId)
            .input('conversation', sql.NVarChar, JSON.stringify(conversation));

        await request.query(`UPDATE IntakeSubmissions SET infoRequests = @conversation ${statusUpdate} WHERE id = @id`);

        logAudit({ action: 'submission.message', entityType: 'submission', entityId: submissionId, entityTitle: `Message by ${user.name}`, user, after: { senderType, message: message.substring(0, 200) }, req });
        res.json({ success: true, conversation });
    } catch (err) {
        handleError(res, 'adding message', err);
    }
});

// ==================== ROLE PERMISSIONS (ADMIN) ====================

// Get all permissions - Allow all auth users so they can check their own rights
app.get('/api/admin/permissions', async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request().query('SELECT * FROM RolePermissions ORDER BY role, permission');
        res.json(result.recordset);
    } catch (err) {
        handleError(res, 'fetching permissions', err);
    }
});

// Update a single permission
app.post('/api/admin/permissions', checkRole('Admin'), async (req, res) => {
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
app.post('/api/admin/permissions/bulk', checkRole('Admin'), async (req, res) => {
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
app.get('/api/admin/audit-log', checkRole('Admin'), async (req, res) => {
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
app.get('/api/admin/audit-log/stats', checkRole('Admin'), async (req, res) => {
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

// Get project-scoped activity feed (any user with can_view_projects)
app.get('/api/projects/:id/activity', checkPermission('can_view_projects'), async (req, res) => {
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

// ==================== START SERVER ====================

const HOST = '0.0.0.0'; // Listen on all interfaces for network access



app.listen(PORT, HOST, async () => {
    try {
        await getPool();
        // Seed permissions on startup
        await seedPermissions();

        console.log(`API server running on:`);
        console.log(`  Local:   http://localhost:${PORT}`);
        console.log(`  Network: http://0.0.0.0:${PORT}`);
    } catch (err) {
        console.error('Failed to connect to database:', err);
    }
});
