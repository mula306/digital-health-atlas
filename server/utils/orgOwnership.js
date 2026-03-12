import { sql } from '../db.js';

export const isAdminUser = (user) => {
    const roles = Array.isArray(user?.roles) ? user.roles : [];
    return roles.includes('Admin');
};

export const parseOptionalOrgId = (value) => {
    if (value === undefined || value === null || value === '') return null;
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? Number.NaN : parsed;
};

export const requireUserOrgId = (user, message = 'No organization assigned. Contact your administrator.') => {
    const parsed = parseOptionalOrgId(user?.orgId);
    if (!Number.isFinite(parsed)) {
        throw new Error(message);
    }
    return parsed;
};

export const resolveOwnedOrgId = ({
    user,
    requestedOrgId,
    requireExplicitAdmin = true,
    missingUserOrgMessage = 'No organization assigned. Contact your administrator.',
    adminOrgRequiredMessage = 'orgId is required for admin-created records',
    orgMismatchMessage = 'orgId must match your organization'
}) => {
    const parsedRequestedOrgId = parseOptionalOrgId(requestedOrgId);
    if (Number.isNaN(parsedRequestedOrgId)) {
        throw new Error('orgId must be a valid organization id');
    }

    if (isAdminUser(user)) {
        if (parsedRequestedOrgId === null) {
            if (requireExplicitAdmin) {
                throw new Error(adminOrgRequiredMessage);
            }
            const adminOrgId = parseOptionalOrgId(user?.orgId);
            if (Number.isFinite(adminOrgId)) {
                return adminOrgId;
            }
            throw new Error(adminOrgRequiredMessage);
        }
        return parsedRequestedOrgId;
    }

    const userOrgId = requireUserOrgId(user, missingUserOrgMessage);
    if (parsedRequestedOrgId !== null && parsedRequestedOrgId !== userOrgId) {
        throw new Error(orgMismatchMessage);
    }
    return userOrgId;
};

export const ensureOrganizationExists = async (pool, orgId, label = 'orgId') => {
    const result = await pool.request()
        .input('orgId', sql.Int, orgId)
        .query('SELECT TOP 1 id FROM Organizations WHERE id = @orgId');
    if (result.recordset.length === 0) {
        throw new Error(`Invalid ${label}`);
    }
};

export const buildActorOrgScope = (user) => {
    if (isAdminUser(user)) {
        return {
            isAdmin: true,
            orgId: parseOptionalOrgId(user?.orgId)
        };
    }

    return {
        isAdmin: false,
        orgId: requireUserOrgId(user)
    };
};
