import { getPool, sql } from '../db.js';
import { buildDefaultPermissionEntries } from './rbacCatalog.js';

export async function seedPermissions(options = {}) {
    const throwOnError = options.throwOnError === true;
    try {
        console.log('Seeding default permissions...');
        const pool = await getPool();
        const permissions = buildDefaultPermissionEntries();
        const overwriteExisting = process.env.SEED_PERMISSIONS_FORCE === 'true';

        const mergeSql = overwriteExisting
            ? `
                    MERGE RolePermissions AS target
                    USING (SELECT @role AS role, @permission AS permission, @isAllowed AS isAllowed) AS source
                    ON (target.role = source.role AND target.permission = source.permission)
                    WHEN MATCHED THEN
                        UPDATE SET isAllowed = source.isAllowed
                    WHEN NOT MATCHED THEN
                        INSERT (role, permission, isAllowed)
                        VALUES (source.role, source.permission, source.isAllowed);
                `
            : `
                    MERGE RolePermissions AS target
                    USING (SELECT @role AS role, @permission AS permission, @isAllowed AS isAllowed) AS source
                    ON (target.role = source.role AND target.permission = source.permission)
                    WHEN NOT MATCHED THEN
                        INSERT (role, permission, isAllowed)
                        VALUES (source.role, source.permission, source.isAllowed);
                `;

        for (const p of permissions) {
            await pool.request()
                .input('role', sql.NVarChar, p.role)
                .input('permission', sql.NVarChar, p.permission)
                .input('isAllowed', sql.Bit, p.isAllowed ? 1 : 0)
                .query(mergeSql);
        }

        if (process.env.PRUNE_LEGACY_USER_ROLE === 'true') {
            await pool.request().query(`DELETE FROM RolePermissions WHERE role = 'User'`);
            console.log('Pruned legacy User role permissions.');
        }

        console.log(`Default permissions seeded successfully (${overwriteExisting ? 'overwrite mode' : 'insert-only mode'}).`);
        return {
            ok: true,
            totalEntries: permissions.length,
            mode: overwriteExisting ? 'overwrite' : 'insert-only'
        };
    } catch (err) {
        console.error('Error seeding permissions:', err);
        if (throwOnError) {
            throw err;
        }
        return {
            ok: false,
            error: err
        };
    }
}
