/**
 * One-time migration: rename old report permission keys to new ones.
 *
 * Old keys:
 *   can_view_reports    → can_view_status_reports + can_view_exec_packs
 *   can_create_reports  → can_create_status_reports + can_manage_exec_packs
 *
 * This script is idempotent — safe to run multiple times.
 *
 * Usage:
 *   node server/scripts/migrate_report_permissions.js
 */

import { getPool, sql } from '../db.js';

const MIGRATIONS = [
    { oldKey: 'can_view_reports', newKeys: ['can_view_status_reports', 'can_view_exec_packs'] },
    { oldKey: 'can_create_reports', newKeys: ['can_create_status_reports', 'can_manage_exec_packs'] }
];

async function migrateReportPermissions() {
    const pool = await getPool();
    let totalInserted = 0;
    let totalDeleted = 0;

    for (const { oldKey, newKeys } of MIGRATIONS) {
        // Find all roles that have the old permission
        const oldRows = await pool.request()
            .input('oldKey', sql.NVarChar(100), oldKey)
            .query('SELECT role, isAllowed FROM RolePermissions WHERE permission = @oldKey');

        if (oldRows.recordset.length === 0) {
            console.log(`  [skip] No rows found for '${oldKey}' — already migrated or never existed.`);
            continue;
        }

        console.log(`  Found ${oldRows.recordset.length} role(s) with '${oldKey}'`);

        for (const row of oldRows.recordset) {
            for (const newKey of newKeys) {
                // Insert new key if it doesn't already exist for this role
                const exists = await pool.request()
                    .input('role', sql.NVarChar(50), row.role)
                    .input('newKey', sql.NVarChar(100), newKey)
                    .query('SELECT COUNT(*) as cnt FROM RolePermissions WHERE role = @role AND permission = @newKey');

                if (exists.recordset[0].cnt === 0) {
                    await pool.request()
                        .input('role', sql.NVarChar(50), row.role)
                        .input('permission', sql.NVarChar(100), newKey)
                        .input('isAllowed', sql.Bit, row.isAllowed)
                        .query('INSERT INTO RolePermissions (role, permission, isAllowed) VALUES (@role, @permission, @isAllowed)');
                    totalInserted++;
                    console.log(`    [insert] ${row.role} → ${newKey} = ${row.isAllowed}`);
                } else {
                    console.log(`    [exists] ${row.role} → ${newKey} — skipped`);
                }
            }
        }

        // Delete old key rows
        const deleteResult = await pool.request()
            .input('oldKey', sql.NVarChar(100), oldKey)
            .query('DELETE FROM RolePermissions WHERE permission = @oldKey');
        const deleted = deleteResult.rowsAffected[0] || 0;
        totalDeleted += deleted;
        console.log(`  [delete] Removed ${deleted} row(s) for '${oldKey}'`);
    }

    console.log(`\nMigration complete: ${totalInserted} inserted, ${totalDeleted} deleted.`);
    process.exit(0);
}

console.log('Migrating report permissions...\n');
migrateReportPermissions().catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
});
