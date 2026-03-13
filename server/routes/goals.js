import express from 'express';
import { getPool, sql } from '../db.js';
import { checkPermission, getAuthUser } from '../middleware/authMiddleware.js';
import { withSharedScope, checkGoalAccess, requireGoalWriteAccess } from '../middleware/orgScope.js';
import { handleError } from '../utils/errorHandler.js';
import { logAudit } from '../utils/auditLogger.js';
import { buildInClause, addParams } from '../utils/sqlHelpers.js';
import { ensureOrganizationExists, resolveOwnedOrgId } from '../utils/orgOwnership.js';
import {
    ACTIVE_PROJECT_LIFECYCLE_STATES,
    GOAL_LIFECYCLE_STATES,
    LIFECYCLE_VIEW_MODES,
    addLifecycleParams,
    buildLifecycleInClause,
    getGoalLifecycleViewStates,
    normalizeGoalLifecycleState,
    normalizeLifecycleView,
    touchGoalActivity
} from '../utils/lifecycle.js';
import {
    GOAL_LEAF_TYPE,
    GOAL_LEVEL_CODES,
    GOAL_ROOT_TYPE,
    getGoalTypeLabel,
    getNextGoalType,
    isValidChildGoalType,
    isValidGoalType,
    isValidRootGoalType,
    normalizeGoalType
} from '../../shared/goalLevels.js';

const router = express.Router();

const mapProjectContextStatus = ({ totalLinkedProjectCount, visibleLinkedProjectCount }) => {
    if (totalLinkedProjectCount <= 0) return 'no-projects-linked';
    if (visibleLinkedProjectCount <= 0) return 'none-visible';
    if (visibleLinkedProjectCount < totalLinkedProjectCount) return 'partial';
    return 'complete';
};

const formatAllowedGoalTypes = () => GOAL_LEVEL_CODES.join(', ');

const parseGoalLifecycleView = (value) => normalizeLifecycleView(value || LIFECYCLE_VIEW_MODES.ACTIVE);

const mapGoalLifecycleMetadata = (row) => ({
    lifecycleState: normalizeGoalLifecycleState(row.lifecycleState),
    retiredAt: row.retiredAt || null,
    archivedAt: row.archivedAt || null,
    archivedByOid: row.archivedByOid || null,
    archiveReason: row.archiveReason || null,
    lastActivityAt: row.lastActivityAt || null,
    retentionClass: row.retentionClass || 'confidential'
});

const validateGoalTypePosition = ({ type, parentGoal = null, childGoals = [] }) => {
    const normalizedType = normalizeGoalType(type);
    if (!isValidGoalType(normalizedType)) {
        return {
            valid: false,
            error: `Goal type must be one of: ${formatAllowedGoalTypes()}.`
        };
    }

    if (!parentGoal) {
        if (!isValidRootGoalType(normalizedType)) {
            return {
                valid: false,
                error: `Root goals must use the "${GOAL_ROOT_TYPE}" type.`
            };
        }
    } else if (!isValidChildGoalType(parentGoal.type, normalizedType)) {
        const expectedType = getNextGoalType(parentGoal.type);
        if (!expectedType) {
            return {
                valid: false,
                error: `${getGoalTypeLabel(parentGoal.type)} goals cannot have child goals.`
            };
        }

        return {
            valid: false,
            error: `Child goals under a ${getGoalTypeLabel(parentGoal.type).toLowerCase()} goal must use the "${expectedType}" type.`
        };
    }

    if (Array.isArray(childGoals) && childGoals.length > 0) {
        if (normalizedType === GOAL_LEAF_TYPE) {
            return {
                valid: false,
                error: `${getGoalTypeLabel(normalizedType)} goals cannot have child goals.`
            };
        }

        const invalidChild = childGoals.find((child) => !isValidChildGoalType(normalizedType, child.type));
        if (invalidChild) {
            return {
                valid: false,
                error: `Goals of type "${normalizedType}" can only contain "${getNextGoalType(normalizedType)}" child goals.`
            };
        }
    }

    return { valid: true, normalizedType };
};

const fetchGoalProjectContextMap = async (pool, orgId) => {
    const request = pool.request();
    const { text: projectLifecycleText, params: projectLifecycleParams } = buildLifecycleInClause(
        'linkedProjectLifecycle',
        ACTIVE_PROJECT_LIFECYCLE_STATES
    );
    addLifecycleParams(request, projectLifecycleParams);

    const query = orgId === null || orgId === undefined
        ? `
            WITH GoalProjectLinks AS (
                SELECT pg.goalId, pg.projectId
                FROM ProjectGoals pg
                UNION
                SELECT p.goalId, p.id AS projectId
                FROM Projects p
                WHERE p.goalId IS NOT NULL
                  AND p.lifecycleState IN (${projectLifecycleText})
            )
            SELECT
                gpl.goalId,
                COUNT(DISTINCT gpl.projectId) AS totalLinkedProjectCount,
                COUNT(DISTINCT gpl.projectId) AS visibleLinkedProjectCount
            FROM GoalProjectLinks gpl
            GROUP BY gpl.goalId
        `
        : `
            WITH GoalProjectLinks AS (
                SELECT pg.goalId, pg.projectId
                FROM ProjectGoals pg
                UNION
                SELECT p.goalId, p.id AS projectId
                FROM Projects p
                WHERE p.goalId IS NOT NULL
                  AND p.lifecycleState IN (${projectLifecycleText})
            )
            SELECT
                gpl.goalId,
                COUNT(DISTINCT gpl.projectId) AS totalLinkedProjectCount,
                SUM(CASE WHEN p.orgId = @orgId OR poa.projectId IS NOT NULL THEN 1 ELSE 0 END) AS visibleLinkedProjectCount
            FROM GoalProjectLinks gpl
            INNER JOIN Projects p ON p.id = gpl.projectId
            LEFT JOIN ProjectOrgAccess poa
                ON poa.projectId = p.id
               AND poa.orgId = @orgId
               AND (poa.expiresAt IS NULL OR poa.expiresAt > GETDATE())
            GROUP BY gpl.goalId
        `;

    if (orgId !== null && orgId !== undefined) {
        request.input('orgId', sql.Int, orgId);
    }

    const result = await request.query(query);
    return new Map(result.recordset.map((row) => [
        Number(row.goalId),
        {
            totalLinkedProjectCount: Number(row.totalLinkedProjectCount || 0),
            visibleLinkedProjectCount: Number(row.visibleLinkedProjectCount || 0)
        }
    ]));
};

// Get all goals with KPIs and project stats
router.get('/', checkPermission(['can_view_goals', 'can_view_exec_dashboard']), withSharedScope, async (req, res) => {
    try {
        console.log('Fetching goals...');
        const pool = await getPool();
        const lifecycleView = parseGoalLifecycleView(req.query.lifecycle);
        const { text: lifecycleText, params: lifecycleParams } = buildLifecycleInClause('goalLifecycle', getGoalLifecycleViewStates(lifecycleView));
        console.log('Pool acquired. Querying Goals...');
        let goalsResult;
        if (req.orgId === null || req.orgId === undefined) {
            // Admin: see all goals
            const request = pool.request();
            addLifecycleParams(request, lifecycleParams);
            goalsResult = await request
                .query(`
                    SELECT
                        g.*,
                        CAST('owner' AS NVARCHAR(20)) AS accessLevel
                    FROM Goals g
                    WHERE g.lifecycleState IN (${lifecycleText})
                    ORDER BY g.id
                `);
        } else {
            const request = pool.request()
                .input('orgId', sql.Int, req.orgId);
            addLifecycleParams(request, lifecycleParams);
            goalsResult = await request
                .query(`
                    SELECT
                        g.*,
                        CASE
                            WHEN g.orgId = @orgId THEN 'owner'
                            WHEN goa.accessLevel = 'write' THEN 'write'
                            WHEN goa.accessLevel = 'read' THEN 'read'
                            ELSE 'none'
                        END AS accessLevel
                    FROM Goals g
                    LEFT JOIN GoalOrgAccess goa
                        ON goa.goalId = g.id
                       AND goa.orgId = @orgId
                       AND (goa.expiresAt IS NULL OR goa.expiresAt > GETDATE())
                    WHERE (g.orgId = @orgId
                       OR goa.goalId IS NOT NULL)
                      AND g.lifecycleState IN (${lifecycleText})
                    ORDER BY g.id
                `);
        }
        console.log(`Goals fetched: ${goalsResult.recordset.length}`);

        console.log('Querying KPIs...');
        const kpisResult = await pool.request().query('SELECT * FROM KPIs');
        console.log(`KPIs fetched: ${kpisResult.recordset.length}`);
        const goalProjectContextMap = await fetchGoalProjectContextMap(pool, req.orgId ?? null);

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
        const statsOrgScope = (req.orgId === null || req.orgId === undefined) ? '' : `
            WHERE (
                p.orgId = @orgId
                OR p.id IN (
                    SELECT projectId
                    FROM ProjectOrgAccess
                    WHERE orgId = @orgId
                      AND (expiresAt IS NULL OR expiresAt > GETDATE())
                )
            )
        `;
        const statsProjectLifecycleFilter = `p.lifecycleState IN (${buildLifecycleInClause('statsProjectLifecycle', ACTIVE_PROJECT_LIFECYCLE_STATES).text})`;
        Object.assign(queryParams, buildLifecycleInClause('statsProjectLifecycle', ACTIVE_PROJECT_LIFECYCLE_STATES).params);
        if (req.orgId !== null && req.orgId !== undefined) {
            queryParams.orgId = req.orgId;
        }

        const statsQuery = `
            SELECT 
                pg.goalId,
                COUNT(DISTINCT p.id) as projectCount,
                SUM(
                    CASE WHEN tCounts.total > 0 
                    THEN (CAST(tCounts.done AS DECIMAL(10,2)) / tCounts.total) * 100 
                    ELSE 0 END
                ) as totalCompletion
            FROM ProjectGoals pg
            INNER JOIN Projects p ON pg.projectId = p.id
            ${tagJoin}
            OUTER APPLY (
                SELECT 
                    COUNT(*) as total,
                    SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) as done
                FROM Tasks t
                WHERE t.projectId = p.id
            ) tCounts
            ${statsOrgScope
                ? statsOrgScope.replace('WHERE (', `WHERE ${statsProjectLifecycleFilter} AND (`)
                : `WHERE ${statsProjectLifecycleFilter}`}
            GROUP BY pg.goalId
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
            const projectContext = goalProjectContextMap.get(Number(goal.id)) || {
                totalLinkedProjectCount: 0,
                visibleLinkedProjectCount: 0
            };
            return {
                id: goal.id.toString(),
                title: goal.title,
                description: goal.description || null,
                type: goal.type,
                ...mapGoalLifecycleMetadata(goal),
                parentId: goal.parentId ? goal.parentId.toString() : null,
                orgId: goal.orgId ? String(goal.orgId) : null,
                accessLevel: goal.accessLevel || 'owner',
                hasWriteAccess: (goal.accessLevel || 'owner') === 'owner' || goal.accessLevel === 'write',
                createdAt: goal.createdAt,
                directProjectCount: stats.count,
                directCompletionSum: stats.sum,
                totalLinkedProjectCount: projectContext.totalLinkedProjectCount,
                visibleLinkedProjectCount: projectContext.visibleLinkedProjectCount,
                projectContextStatus: mapProjectContextStatus(projectContext),
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
        const { title, description, type, parentId } = req.body;
        if (!title || !type) {
            return res.status(400).json({ error: 'Missing required fields: title, type' });
        }
        const pool = await getPool();
        const user = getAuthUser(req);
        const ownerOrgId = resolveOwnedOrgId({
            user,
            requestedOrgId: req.body?.orgId,
            adminOrgRequiredMessage: 'orgId is required for admin-created goals'
        });
        await ensureOrganizationExists(pool, ownerOrgId);

        let parentGoal = null;
        if (parentId) {
            const parentResult = await pool.request()
                .input('parentId', sql.Int, parseInt(parentId, 10))
                .query('SELECT TOP 1 id, orgId, type FROM Goals WHERE id = @parentId');
            if (parentResult.recordset.length === 0) {
                return res.status(400).json({ error: 'Invalid parentId' });
            }
            parentGoal = parentResult.recordset[0];
            if (Number(parentGoal.orgId || 0) !== ownerOrgId) {
                return res.status(400).json({ error: 'Parent goal must belong to the same organization.' });
            }
        }

        const hierarchyValidation = validateGoalTypePosition({
            type,
            parentGoal
        });
        if (!hierarchyValidation.valid) {
            return res.status(400).json({ error: hierarchyValidation.error });
        }

        const result = await pool.request()
            .input('title', sql.NVarChar, title)
            .input('description', sql.NVarChar(sql.MAX), description || null)
            .input('type', sql.NVarChar, hierarchyValidation.normalizedType)
            .input('parentId', sql.Int, parentId ? parseInt(parentId) : null)
            .input('orgId', sql.Int, ownerOrgId)
            .input('lifecycleState', sql.NVarChar(20), GOAL_LIFECYCLE_STATES.ACTIVE)
            .input('lastActivityAt', sql.DateTime2, new Date())
            .input('retentionClass', sql.NVarChar(40), 'confidential')
            .query(`
                INSERT INTO Goals (title, description, type, parentId, orgId, lifecycleState, lastActivityAt, retentionClass)
                OUTPUT INSERTED.id
                VALUES (@title, @description, @type, @parentId, @orgId, @lifecycleState, @lastActivityAt, @retentionClass)
            `);

        const newId = result.recordset[0].id.toString();
        logAudit({
            action: 'goal.create',
            entityType: 'goal',
            entityId: newId,
            entityTitle: title,
            user,
            after: {
                title,
                description: description || null,
                type: hierarchyValidation.normalizedType,
                parentId,
                orgId: ownerOrgId
            },
            req
        });
        res.json({
            id: newId,
            title,
            description: description || null,
            type: hierarchyValidation.normalizedType,
            lifecycleState: GOAL_LIFECYCLE_STATES.ACTIVE,
            retiredAt: null,
            archivedAt: null,
            archivedByOid: null,
            archiveReason: null,
            lastActivityAt: new Date(),
            retentionClass: 'confidential',
            parentId,
            orgId: String(ownerOrgId),
            accessLevel: 'owner',
            hasWriteAccess: true,
            totalLinkedProjectCount: 0,
            visibleLinkedProjectCount: 0,
            projectContextStatus: 'no-projects-linked',
            kpis: []
        });
    } catch (err) {
        if (err?.message?.includes('organization') || err?.message?.includes('orgId')) {
            return res.status(400).json({ error: err.message });
        }
        handleError(res, 'creating goal', err);
    }
});

// Update goal
router.put('/:id', checkPermission('can_edit_goal'), withSharedScope, checkGoalAccess(), requireGoalWriteAccess, async (req, res) => {
    try {
        const { title, description, type } = req.body;
        const id = parseInt(req.params.id);
        if (!title || !type) {
            return res.status(400).json({ error: 'Missing required fields: title, type' });
        }
        const pool = await getPool();
        const prev = await pool.request()
            .input('id', sql.Int, id)
            .query('SELECT id, title, description, type, parentId, lifecycleState, retiredAt, archivedAt, archivedByOid, archiveReason, lastActivityAt, retentionClass FROM Goals WHERE id = @id');
        if (prev.recordset.length === 0) {
            return res.status(404).json({ error: 'Goal not found' });
        }
        const beforeState = prev.recordset[0];

        const parentGoal = beforeState.parentId
            ? (await pool.request()
                .input('parentId', sql.Int, beforeState.parentId)
                .query('SELECT TOP 1 id, type FROM Goals WHERE id = @parentId')).recordset[0] || null
            : null;

        const childGoalsResult = await pool.request()
            .input('id', sql.Int, id)
            .query('SELECT id, type FROM Goals WHERE parentId = @id');

        const hierarchyValidation = validateGoalTypePosition({
            type,
            parentGoal,
            childGoals: childGoalsResult.recordset
        });
        if (!hierarchyValidation.valid) {
            return res.status(400).json({ error: hierarchyValidation.error });
        }

        await pool.request()
            .input('id', sql.Int, id)
            .input('title', sql.NVarChar, title)
            .input('description', sql.NVarChar(sql.MAX), description || null)
            .input('type', sql.NVarChar, hierarchyValidation.normalizedType)
            .input('lastActivityAt', sql.DateTime2, new Date())
            .query('UPDATE Goals SET title = @title, description = @description, type = @type, lastActivityAt = @lastActivityAt WHERE id = @id');

        await touchGoalActivity(pool, [id]);
        logAudit({
            action: 'goal.update',
            entityType: 'goal',
            entityId: id,
            entityTitle: title,
            user: getAuthUser(req),
            before: beforeState,
            after: { title, description: description || null, type: hierarchyValidation.normalizedType },
            req
        });
        res.json({ success: true });
    } catch (err) {
        handleError(res, 'updating goal', err);
    }
});

// Archive goal (legacy delete behavior maps to archive)
router.delete('/:id', checkPermission('can_delete_goal'), withSharedScope, checkGoalAccess(), requireGoalWriteAccess, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const pool = await getPool();
        const archivedAt = new Date();
        const prev = await pool.request().input('id', sql.Int, id).query('SELECT title, type, parentId, lifecycleState FROM Goals WHERE id = @id');
        if (!prev.recordset.length) {
            return res.status(404).json({ error: 'Goal not found' });
        }
        await pool.request()
            .input('id', sql.Int, id)
            .input('archivedAt', sql.DateTime2, archivedAt)
            .input('archivedByOid', sql.NVarChar(100), req.user?.oid || null)
            .input('archiveReason', sql.NVarChar(500), 'Archived via delete action')
            .query(`
                UPDATE Goals
                SET lifecycleState = 'archived',
                    archivedAt = @archivedAt,
                    archivedByOid = @archivedByOid,
                    archiveReason = @archiveReason,
                    lastActivityAt = @archivedAt
                WHERE id = @id
            `);

        logAudit({ action: 'goal.archive', entityType: 'goal', entityId: id, entityTitle: prev.recordset[0]?.title, user: getAuthUser(req), before: prev.recordset[0], after: { lifecycleState: 'archived', archivedAt }, req });
        res.json({ success: true, lifecycleState: 'archived', archivedAt });
    } catch (err) {
        handleError(res, 'deleting goal', err);
    }
});

router.post('/:id/retire', checkPermission('can_edit_goal'), withSharedScope, checkGoalAccess(), requireGoalWriteAccess, async (req, res) => {
    try {
        const id = Number.parseInt(req.params.id, 10);
        if (Number.isNaN(id)) {
            return res.status(400).json({ error: 'Invalid goal id' });
        }
        const retiredAt = new Date();
        const pool = await getPool();
        const previous = await pool.request().input('id', sql.Int, id).query('SELECT title, type, lifecycleState FROM Goals WHERE id = @id');
        if (!previous.recordset.length) {
            return res.status(404).json({ error: 'Goal not found' });
        }
        await pool.request()
            .input('id', sql.Int, id)
            .input('retiredAt', sql.DateTime2, retiredAt)
            .input('archiveReason', sql.NVarChar(500), String(req.body?.reason || '').trim() || 'Retired manually')
            .query(`
                UPDATE Goals
                SET lifecycleState = 'retired',
                    retiredAt = @retiredAt,
                    archivedAt = NULL,
                    archivedByOid = NULL,
                    archiveReason = @archiveReason,
                    lastActivityAt = @retiredAt
                WHERE id = @id
            `);
        logAudit({ action: 'goal.retire', entityType: 'goal', entityId: String(id), entityTitle: previous.recordset[0]?.title, user: getAuthUser(req), before: previous.recordset[0], after: { lifecycleState: 'retired', retiredAt }, req });
        res.json({ success: true, lifecycleState: 'retired', retiredAt });
    } catch (err) {
        handleError(res, 'retiring goal', err);
    }
});

router.post('/:id/archive', checkPermission('can_delete_goal'), withSharedScope, checkGoalAccess(), requireGoalWriteAccess, async (req, res) => {
    try {
        const id = Number.parseInt(req.params.id, 10);
        if (Number.isNaN(id)) {
            return res.status(400).json({ error: 'Invalid goal id' });
        }
        const archivedAt = new Date();
        const pool = await getPool();
        const previous = await pool.request().input('id', sql.Int, id).query('SELECT title, type, lifecycleState FROM Goals WHERE id = @id');
        if (!previous.recordset.length) {
            return res.status(404).json({ error: 'Goal not found' });
        }
        await pool.request()
            .input('id', sql.Int, id)
            .input('archivedAt', sql.DateTime2, archivedAt)
            .input('archivedByOid', sql.NVarChar(100), req.user?.oid || null)
            .input('archiveReason', sql.NVarChar(500), String(req.body?.reason || '').trim() || 'Archived manually')
            .query(`
                UPDATE Goals
                SET lifecycleState = 'archived',
                    archivedAt = @archivedAt,
                    archivedByOid = @archivedByOid,
                    archiveReason = @archiveReason,
                    lastActivityAt = @archivedAt
                WHERE id = @id
            `);
        logAudit({ action: 'goal.archive', entityType: 'goal', entityId: String(id), entityTitle: previous.recordset[0]?.title, user: getAuthUser(req), before: previous.recordset[0], after: { lifecycleState: 'archived', archivedAt }, req });
        res.json({ success: true, lifecycleState: 'archived', archivedAt });
    } catch (err) {
        handleError(res, 'archiving goal', err);
    }
});

router.post('/:id/restore', checkPermission('can_edit_goal'), withSharedScope, checkGoalAccess(), async (req, res) => {
    try {
        const id = Number.parseInt(req.params.id, 10);
        if (Number.isNaN(id)) {
            return res.status(400).json({ error: 'Invalid goal id' });
        }
        const pool = await getPool();
        const previous = await pool.request().input('id', sql.Int, id).query('SELECT title, type, lifecycleState FROM Goals WHERE id = @id');
        if (!previous.recordset.length) {
            return res.status(404).json({ error: 'Goal not found' });
        }
        const restoredAt = new Date();
        await pool.request()
            .input('id', sql.Int, id)
            .input('restoredAt', sql.DateTime2, restoredAt)
            .query(`
                UPDATE Goals
                SET lifecycleState = 'active',
                    retiredAt = NULL,
                    archivedAt = NULL,
                    archivedByOid = NULL,
                    archiveReason = NULL,
                    lastActivityAt = @restoredAt
                WHERE id = @id
            `);
        logAudit({ action: 'goal.restore', entityType: 'goal', entityId: String(id), entityTitle: previous.recordset[0]?.title, user: getAuthUser(req), before: previous.recordset[0], after: { lifecycleState: 'active', restoredAt }, req });
        res.json({ success: true, lifecycleState: 'active', lastActivityAt: restoredAt });
    } catch (err) {
        handleError(res, 'restoring goal', err);
    }
});

// Add KPI to goal
router.post('/:goalId/kpis', checkPermission('can_manage_kpis'), withSharedScope, checkGoalAccess((req) => req.params.goalId), requireGoalWriteAccess, async (req, res) => {
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

        await touchGoalActivity(pool, [req.params.goalId]);
        const newId = result.recordset[0].id.toString();
        logAudit({ action: 'kpi.create', entityType: 'kpi', entityId: newId, entityTitle: name, user: getAuthUser(req), after: { name, target, current, unit, goalId: req.params.goalId }, req });
        res.json({ id: newId, name, target, current, unit });
    } catch (err) {
        handleError(res, 'creating KPI', err);
    }
});

export default router;
