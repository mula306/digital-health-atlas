import { getPool, sql } from '../db.js';
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

        return res.status(403).json({ error: `Forbidden: Requires ${requiredRole} role` });
    };
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

        const userRoles = user.roles || [];

        // 1. Admin Bypass
        if (userRoles.includes('Admin')) {
            return next();
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
            const hasAccess = userRoles.some(role => {
                return keysToCheck.some(key => {
                    const entry = allPermissions.find(p => p.role === role && p.permission === key);
                    return entry ? entry.isAllowed : false;
                });
            });

            if (hasAccess) {
                return next();
            } else {
                return res.status(403).json({ error: `Forbidden: Missing required permission` });
            }

        } catch (err) {
            console.error('Permission Check Error:', err);
            // Fail closed
            return res.status(500).json({ error: 'Internal Server Error during authorization' });
        }
    };
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
