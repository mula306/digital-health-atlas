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
        // Admin bypass
        if (isAdmin(req)) {
            req.projectAccess = 'owner';
            req.hasWriteAccess = true;
            return next();
        }

        try {
            const { getPool, sql } = await import('../db.js');
            const pool = await getPool();
            const projectId = typeof getProjectId === 'function'
                ? getProjectId(req)
                : parseInt(req.params.id || req.params.projectId);

            const result = await pool.request()
                .input('projectId', sql.Int, projectId)
                .input('orgId', sql.Int, req.orgId)
                .query(`
                    SELECT 
                        CASE 
                            WHEN p.orgId = @orgId THEN 'owner'
                            WHEN poa.accessLevel = 'write' THEN 'write'
                            WHEN poa.accessLevel = 'read' THEN 'read'
                            ELSE 'none'
                        END as accessLevel
                    FROM Projects p
                    LEFT JOIN ProjectOrgAccess poa 
                        ON poa.projectId = p.id AND poa.orgId = @orgId
                    WHERE p.id = @projectId
                `);

            if (!result.recordset.length) {
                return res.status(404).json({ error: 'Project not found' });
            }

            const access = result.recordset[0].accessLevel;
            if (access === 'none') {
                return res.status(403).json({ error: 'Your organization does not have access to this project' });
            }

            req.projectAccess = access; // 'owner' | 'write' | 'read'
            req.hasWriteAccess = access === 'owner' || access === 'write';
            next();
        } catch (err) {
            console.error('checkProjectWriteAccess error:', err);
            next(err);
        }
    };
};
