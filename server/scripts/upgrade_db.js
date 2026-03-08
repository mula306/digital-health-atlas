// Run migrations for existing databases that were created before schema.sql became canonical.
// Usage:
//   node scripts/upgrade_db.js
//   npm run upgrade-db

import path from 'path';
import { fileURLToPath } from 'url';
import {
    assertSafeDbName,
    connectMasterWithRetry,
    runSqlFile
} from './sql_script_runner.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_NAME = process.env.DB_NAME || 'DHAtlas';
const CONNECT_RETRIES = Number.parseInt(process.env.DB_CONNECT_RETRIES || '30', 10);
const CONNECT_DELAY_MS = Number.parseInt(process.env.DB_CONNECT_DELAY_MS || '2000', 10);

const MIGRATION_FILES_IN_ORDER = [
    'migrate_governance_phase0.sql',
    'migrate_governance_phase1.sql',
    'migrate_governance_phase2.sql',
    'migrate_governance_phase3.sql',
    'migrate_multi_org.sql',
    'migrate_org_sharing_v2.sql',
    'migrate_project_goals.sql',
    'migrate_project_watchlist.sql',
    'migrate_task_tracking_phase1.sql',
    'migrate_wave2.sql',
    'migrate_wave3.sql'
];

async function upgradeDatabase() {
    let pool;
    try {
        assertSafeDbName(DB_NAME, 'migration scripts');
        console.log(`Applying migrations to "${DB_NAME}"...`);
        pool = await connectMasterWithRetry({
            connectRetries: CONNECT_RETRIES,
            connectDelayMs: CONNECT_DELAY_MS
        });

        for (const sqlFile of MIGRATION_FILES_IN_ORDER) {
            await runSqlFile({
                pool,
                baseDir: __dirname,
                filename: sqlFile,
                dbName: DB_NAME
            });
        }

        console.log('\nMigration upgrade completed successfully.');
        process.exit(0);
    } catch (err) {
        console.error('\nMigration upgrade failed:', err.message);
        console.error('\nCheck:');
        console.error('  1. Database already exists (run npm run setup-db for fresh installs)');
        console.error('  2. server/.env has valid DB_* settings');
        process.exit(1);
    } finally {
        if (pool?.close) {
            await pool.close();
        }
    }
}

upgradeDatabase();
