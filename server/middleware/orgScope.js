/**
 * Organization Scope Middleware
 * 
 * Provides middleware functions to enforce multi-org data isolation.
 * All data-fetching routes should use one of these middlewares to ensure
 * users only see data belonging to their organization (+ shared data).
 * 
 * ADMIN BYPASS: Users with the 'Admin' role see ALL data across all
 * organizations. Their req.orgId is set to null so queries return everything.
 */

/**
 * Check if the user has the Admin role (sees everything).
 */
const isAdmin = (req) => {
    const roles = req.user?.roles || [];
    return Array.isArray(roles) ? roles.includes('Admin') : false;
};

const resolveEntityId = (rawValue) => {
    const parsed = Number.parseInt(rawValue, 10);
    return Number.isNaN(parsed) ? null : parsed;
};

/**
 * Hard requirement: user must belong to an organization.
 * Admins bypass this check and see all data (req.orgId = null).
 * Rejects with 403 if no orgId is set on a non-admin user.
 */
export const requireOrg = (req, res, next) => {
    if (isAdmin(req)) {
        req.orgId = null; // Admin sees everything
        return next();
    }
    if (!req.user?.orgId) {
        return res.status(403).json({
            error: 'No organization assigned. Contact your administrator to be assigned to an organization.'
        });
    }
    req.orgId = req.user.orgId;
    next();
};

/**
 * Soft org scoping: sets req.orgId if available but does not reject.
 * Admins get req.orgId = null (see everything).
 */
export const softOrg = (req, res, next) => {
    if (isAdmin(req)) {
        req.orgId = null;
        return next();
    }
    req.orgId = req.user?.orgId || null;
    next();
};

/**
 * For routes that should include cross-org shared projects.
 * Admins bypass and see all projects.
 * Sets req.orgId and req.includeShared = true.
 */
export const withSharedScope = (req, res, next) => {
    if (isAdmin(req)) {
        req.orgId = null; // Admin sees everything
        req.includeShared = false; // Not needed — they see all
        return next();
    }
    if (!req.user?.orgId) {
        return res.status(403).json({
            error: 'No organization assigned. Contact your administrator.'
        });
    }
    req.orgId = req.user.orgId;
    req.includeShared = true;
    next();
};

/**
 * Check if user's org has write access to a project.
 * Admins always have full write access.
 * Must be called after requireOrg or withSharedScope.
 * Sets req.hasWriteAccess = true/false.
 */
export const checkProjectWriteAccess = (getProjectId) => {
    return async (req, res, next) => {
        try {
            const { getPool, sql } = await import('../db.js');
            const pool = await getPool();
            const projectIdRaw = typeof getProjectId === 'function'
                ? getProjectId(req)
                : req.params.id || req.params.projectId;
            const projectId = resolveEntityId(projectIdRaw);
            const adminRequest = isAdmin(req);

            if (projectId === null) {
                return res.status(400).json({ error: 'Invalid project id' });
            }

            if (adminRequest) {
                const lifecycleResult = await pool.request()
                    .input('projectId', sql.Int, projectId)
                    .query(`
                        SELECT lifecycleState
                        FROM Projects
                        WHERE id = @projectId
                    `);

                if (!lifecycleResult.recordset.length) {
                    return res.status(404).json({ error: 'Project not found' });
                }

                req.projectLifecycleState = String(lifecycleResult.recordset[0].lifecycleState || 'active').toLowerCase();
                req.projectAccess = 'owner';
                req.hasWriteAccess = true;
                return next();
            }

            const result = await pool.request()
                .input('projectId', sql.Int, projectId)
                .input('orgId', sql.Int, req.orgId)
                .query(`
                    SELECT 
                        p.lifecycleState,
                        CASE 
                            WHEN p.orgId = @orgId THEN 'owner'
                            WHEN poa.accessLevel = 'write' THEN 'write'
                            WHEN poa.accessLevel = 'read' THEN 'read'
                            ELSE 'none'
                        END as accessLevel
                    FROM Projects p
                    LEFT JOIN ProjectOrgAccess poa 
                        ON poa.projectId = p.id
                       AND poa.orgId = @orgId
                       AND (poa.expiresAt IS NULL OR poa.expiresAt > GETDATE())
                    WHERE p.id = @projectId
                `);

            if (!result.recordset.length) {
                return res.status(404).json({ error: 'Project not found' });
            }

            const access = result.recordset[0].accessLevel;
            if (access === 'none') {
                return res.status(403).json({ error: 'Your organization does not have access to this project' });
            }

            req.projectLifecycleState = String(result.recordset[0].lifecycleState || 'active').toLowerCase();
            req.projectAccess = access; // 'owner' | 'write' | 'read'
            req.hasWriteAccess = access === 'owner' || access === 'write';
            next();
        } catch (err) {
            console.error('checkProjectWriteAccess error:', err);
            next(err);
        }
    };
};

/**
 * Require previously-computed project write access.
 */
export const requireProjectWriteAccess = (req, res, next) => {
    if (req.projectLifecycleState === 'archived') {
        return res.status(409).json({ error: 'Archived projects are read-only until restored.' });
    }
    if (req.hasWriteAccess) return next();
    return res.status(403).json({ error: 'Your organization has read-only access to this project' });
};

/**
 * Check if user's org has access to a goal and whether that access is writable.
 * Must be called after requireOrg or withSharedScope.
 */
export const checkGoalAccess = (getGoalId) => {
    return async (req, res, next) => {
        try {
            const { getPool, sql } = await import('../db.js');
            const pool = await getPool();
            const goalIdRaw = typeof getGoalId === 'function'
                ? getGoalId(req)
                : req.params.id || req.params.goalId;
            const goalId = resolveEntityId(goalIdRaw);
            const adminRequest = isAdmin(req);

            if (goalId === null) {
                return res.status(400).json({ error: 'Invalid goal id' });
            }

            if (adminRequest) {
                const lifecycleResult = await pool.request()
                    .input('goalId', sql.Int, goalId)
                    .query(`
                        SELECT lifecycleState
                        FROM Goals
                        WHERE id = @goalId
                    `);

                if (!lifecycleResult.recordset.length) {
                    return res.status(404).json({ error: 'Goal not found' });
                }

                req.goalLifecycleState = String(lifecycleResult.recordset[0].lifecycleState || 'active').toLowerCase();
                req.goalAccess = 'owner';
                req.hasGoalWriteAccess = true;
                return next();
            }

            const result = await pool.request()
                .input('goalId', sql.Int, goalId)
                .input('orgId', sql.Int, req.orgId)
                .query(`
                    SELECT
                        g.lifecycleState,
                        CASE
                            WHEN g.orgId = @orgId THEN 'owner'
                            WHEN goa.accessLevel = 'write' THEN 'write'
                            WHEN goa.accessLevel = 'read' THEN 'read'
                            ELSE 'none'
                        END as accessLevel
                    FROM Goals g
                    LEFT JOIN GoalOrgAccess goa
                        ON goa.goalId = g.id
                       AND goa.orgId = @orgId
                       AND (goa.expiresAt IS NULL OR goa.expiresAt > GETDATE())
                    WHERE g.id = @goalId
                `);

            if (!result.recordset.length) {
                return res.status(404).json({ error: 'Goal not found' });
            }

            const access = result.recordset[0].accessLevel;
            if (access === 'none') {
                return res.status(403).json({ error: 'Your organization does not have access to this goal' });
            }

            req.goalLifecycleState = String(result.recordset[0].lifecycleState || 'active').toLowerCase();
            req.goalAccess = access;
            req.hasGoalWriteAccess = access === 'owner' || access === 'write';
            return next();
        } catch (err) {
            console.error('checkGoalAccess error:', err);
            return next(err);
        }
    };
};

/**
 * Require previously-computed goal write access.
 */
export const requireGoalWriteAccess = (req, res, next) => {
    if (req.goalLifecycleState === 'retired' || req.goalLifecycleState === 'archived') {
        return res.status(409).json({ error: 'Retired or archived goals are read-only until restored.' });
    }
    if (req.hasGoalWriteAccess) return next();
    return res.status(403).json({ error: 'Your organization has read-only access to this goal' });
};

/**
 * Check write access to the project linked to a task.
 * Must be called after requireOrg or withSharedScope.
 */
export const checkTaskWriteAccess = (getTaskId) => {
    return async (req, res, next) => {
        try {
            const { getPool, sql } = await import('../db.js');
            const pool = await getPool();
            const taskIdRaw = typeof getTaskId === 'function'
                ? getTaskId(req)
                : req.params.id || req.params.taskId;
            const taskId = resolveEntityId(taskIdRaw);
            const adminRequest = isAdmin(req);

            if (taskId === null) {
                return res.status(400).json({ error: 'Invalid task id' });
            }

            if (adminRequest) {
                const lifecycleResult = await pool.request()
                    .input('taskId', sql.Int, taskId)
                    .query(`
                        SELECT p.lifecycleState
                        FROM Tasks t
                        INNER JOIN Projects p ON p.id = t.projectId
                        WHERE t.id = @taskId
                    `);

                if (!lifecycleResult.recordset.length) {
                    return res.status(404).json({ error: 'Task not found' });
                }

                req.projectLifecycleState = String(lifecycleResult.recordset[0].lifecycleState || 'active').toLowerCase();
                req.projectAccess = 'owner';
                req.hasWriteAccess = true;
                return next();
            }

            const result = await pool.request()
                .input('taskId', sql.Int, taskId)
                .input('orgId', sql.Int, req.orgId)
                .query(`
                    SELECT
                        p.lifecycleState,
                        CASE
                            WHEN p.orgId = @orgId THEN 'owner'
                            WHEN poa.accessLevel = 'write' THEN 'write'
                            WHEN poa.accessLevel = 'read' THEN 'read'
                            ELSE 'none'
                        END as accessLevel
                    FROM Tasks t
                    INNER JOIN Projects p ON p.id = t.projectId
                    LEFT JOIN ProjectOrgAccess poa
                        ON poa.projectId = p.id
                       AND poa.orgId = @orgId
                       AND (poa.expiresAt IS NULL OR poa.expiresAt > GETDATE())
                    WHERE t.id = @taskId
                `);

            if (!result.recordset.length) {
                return res.status(404).json({ error: 'Task not found' });
            }

            const access = result.recordset[0].accessLevel;
            if (access === 'none') {
                return res.status(403).json({ error: 'Your organization does not have access to this task project' });
            }

            req.projectLifecycleState = String(result.recordset[0].lifecycleState || 'active').toLowerCase();
            req.projectAccess = access;
            req.hasWriteAccess = access === 'owner' || access === 'write';
            return next();
        } catch (err) {
            console.error('checkTaskWriteAccess error:', err);
            return next(err);
        }
    };
};

/**
 * Check write access to the goal linked to a KPI.
 * Must be called after requireOrg or withSharedScope.
 */
export const checkKpiWriteAccess = (getKpiId) => {
    return async (req, res, next) => {
        try {
            const { getPool, sql } = await import('../db.js');
            const pool = await getPool();
            const kpiIdRaw = typeof getKpiId === 'function'
                ? getKpiId(req)
                : req.params.id || req.params.kpiId;
            const kpiId = resolveEntityId(kpiIdRaw);
            const adminRequest = isAdmin(req);

            if (kpiId === null) {
                return res.status(400).json({ error: 'Invalid KPI id' });
            }

            if (adminRequest) {
                const lifecycleResult = await pool.request()
                    .input('kpiId', sql.Int, kpiId)
                    .query(`
                        SELECT g.lifecycleState
                        FROM KPIs k
                        INNER JOIN Goals g ON g.id = k.goalId
                        WHERE k.id = @kpiId
                    `);

                if (!lifecycleResult.recordset.length) {
                    return res.status(404).json({ error: 'KPI not found' });
                }

                req.goalLifecycleState = String(lifecycleResult.recordset[0].lifecycleState || 'active').toLowerCase();
                req.goalAccess = 'owner';
                req.hasGoalWriteAccess = true;
                return next();
            }

            const result = await pool.request()
                .input('kpiId', sql.Int, kpiId)
                .input('orgId', sql.Int, req.orgId)
                .query(`
                    SELECT
                        g.lifecycleState,
                        CASE
                            WHEN g.orgId = @orgId THEN 'owner'
                            WHEN goa.accessLevel = 'write' THEN 'write'
                            WHEN goa.accessLevel = 'read' THEN 'read'
                            ELSE 'none'
                        END as accessLevel
                    FROM KPIs k
                    INNER JOIN Goals g ON g.id = k.goalId
                    LEFT JOIN GoalOrgAccess goa
                        ON goa.goalId = g.id
                       AND goa.orgId = @orgId
                       AND (goa.expiresAt IS NULL OR goa.expiresAt > GETDATE())
                    WHERE k.id = @kpiId
                `);

            if (!result.recordset.length) {
                return res.status(404).json({ error: 'KPI not found' });
            }

            const access = result.recordset[0].accessLevel;
            if (access === 'none') {
                return res.status(403).json({ error: 'Your organization does not have access to this KPI goal' });
            }

            req.goalLifecycleState = String(result.recordset[0].lifecycleState || 'active').toLowerCase();
            req.goalAccess = access;
            req.hasGoalWriteAccess = access === 'owner' || access === 'write';
            return next();
        } catch (err) {
            console.error('checkKpiWriteAccess error:', err);
            return next(err);
        }
    };
};
