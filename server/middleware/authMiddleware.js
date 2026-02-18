import { getPool } from '../db.js';
import NodeCache from 'node-cache';

// Cache permissions for 1 minute to reduce DB hits
const permissionCache = new NodeCache({ stdTTL: 60 });
const CACHE_KEY = 'all_role_permissions';

/**
 * Middleware to ensure user has a specific role (e.g. 'Admin')
 * Azure AD token payload usually puts roles in `roles` array.
 */
export const checkRole = (requiredRole) => {
    return (req, res, next) => {
        // req.user is populated by passport-azure-ad
        // It typically looks like the decoded JWT token
        const user = req.user;

        if (!user) {
            return res.status(401).json({ error: 'Unauthorized: No user found' });
        }

        const userRoles = user.roles || [];

        if (userRoles.includes(requiredRole)) {
            return next();
        }

        console.log(`[AuthDebug] User ${user.oid || user.sub} denied. Required: '${requiredRole}', Have: ${JSON.stringify(userRoles)}`);
        return res.status(403).json({ error: `Forbidden: Requires ${requiredRole} role` });
    };
};

/**
 * Middleware to check if user has a specific dynamic permission.
 * Checks against the RolePermissions table in DB.
 * Admins are always allowed.
 * Supports checking multiple permissions (OR logic) if passed an array.
 */
/**
 * Check if a user has specific permissions programmatically.
 * @param {object} user - The user object (with roles)
 * @param {string|string[]} permissionKeys - Permission key(s) to check
 * @returns {Promise<boolean>}
 */
export const hasPermission = async (user, permissionKeys) => {
    if (!user) return false;
    const userRoles = user.roles || [];

    // 1. Admin Bypass
    if (userRoles.includes('Admin')) {
        return true;
    }

    try {
        // 2. Get Permissions (Cached)
        let allPermissions = permissionCache.get(CACHE_KEY);
        if (!allPermissions) {
            const pool = await getPool();
            const result = await pool.request().query('SELECT * FROM RolePermissions');
            allPermissions = result.recordset;
            permissionCache.set(CACHE_KEY, allPermissions);
        }

        // Normalize to array
        const keysToCheck = Array.isArray(permissionKeys) ? permissionKeys : [permissionKeys];

        // 3. Check if ANY of user's roles has ANY of the required permissions enabled
        return userRoles.some(role => {
            return keysToCheck.some(key => {
                const entry = allPermissions.find(p => p.role === role && p.permission === key);
                return entry ? entry.isAllowed : false;
            });
        });

    } catch (err) {
        console.error('Permission Check Error:', err);
        return false;
    }
};

/**
 * Middleware to check if user has a specific dynamic permission.
 * Checks against the RolePermissions table in DB.
 * Admins are always allowed.
 * Supports checking multiple permissions (OR logic) if passed an array.
 */
export const checkPermission = (permissionKeys) => {
    return async (req, res, next) => {
        const user = req.user;

        if (!user) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const hasAccess = await hasPermission(user, permissionKeys);

        if (hasAccess) {
            return next();
        } else {
            return res.status(403).json({ error: `Forbidden: Missing required permission` });
        }
    };
};

/**
 * Middleware to ensure the request has an authenticated user.
 * Rejects anonymous requests with 401. Use this as a baseline guard
 * on endpoints that don't need granular RBAC but must not be public.
 */
export const requireAuth = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ error: 'Unauthorized: Authentication required' });
    }
    return next();
};

/**
 * Explicitly invalidate the permission cache.
 * Call this when permissions are updated in the DB.
 */
export const invalidatePermissionCache = () => {
    try {
        permissionCache.del(CACHE_KEY);
        console.log('Permission cache invalidated.');
    } catch (err) {
        console.error('Error invalidating permission cache:', err);
    }
};

/**
 * Helper to get authenticated user from request
 * @param {Request} req 
 * @returns {object|null}
 */
export const getAuthUser = (req) => {
    return req.user || null;
};
