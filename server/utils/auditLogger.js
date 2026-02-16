import { getPool, sql } from '../db.js';

/**
 * Log an audit event. Fire-and-forget — never breaks the caller's operation.
 *
 * @param {Object} opts
 * @param {string} opts.action       - e.g. 'project.create', 'task.delete'
 * @param {string} opts.entityType   - e.g. 'project', 'goal', 'task'
 * @param {string|number} opts.entityId - ID of the affected record
 * @param {string} [opts.entityTitle]  - Human-readable label for quick scanning
 * @param {Object} [opts.user]       - req.user from Passport (needs .oid, .name)
 * @param {Object} [opts.before]     - Previous state (null for creates)
 * @param {Object} [opts.after]      - New state (null for deletes)
 * @param {Object} [opts.metadata]   - Extra context (e.g. { projectId })
 * @param {Object} [opts.req]        - Express request (for IP + User-Agent)
 */
export async function logAudit({
    action, entityType, entityId, entityTitle,
    user, before, after, metadata, req
}) {
    try {
        const pool = await getPool();
        await pool.request()
            .input('action', sql.NVarChar(50), action)
            .input('entityType', sql.NVarChar(30), entityType)
            .input('entityId', sql.NVarChar(20), entityId?.toString() || null)
            .input('entityTitle', sql.NVarChar(255), (entityTitle || '').substring(0, 255) || null)
            .input('userId', sql.NVarChar(100), user?.oid || null)
            .input('userName', sql.NVarChar(200), user?.name || null)
            .input('before', sql.NVarChar, before ? JSON.stringify(before) : null)
            .input('after', sql.NVarChar, after ? JSON.stringify(after) : null)
            .input('metadata', sql.NVarChar, metadata ? JSON.stringify(metadata) : null)
            .input('ipAddress', sql.NVarChar(45), req?.ip || null)
            .input('userAgent', sql.NVarChar(500), (req?.get?.('user-agent') || '').substring(0, 500) || null)
            .query(`INSERT INTO AuditLog
                (action, entityType, entityId, entityTitle, userId, userName,
                 [before], [after], metadata, ipAddress, userAgent)
                VALUES
                (@action, @entityType, @entityId, @entityTitle, @userId, @userName,
                 @before, @after, @metadata, @ipAddress, @userAgent)`);
    } catch (err) {
        // NEVER let audit logging failures break the main operation
        console.error('Audit log write failed:', err.message);
    }
}
