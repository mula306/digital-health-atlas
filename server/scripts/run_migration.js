// Generic SQL migration runner for one migration file.
// Usage:
//   node scripts/run_migration.js <migration-file.sql>
// Example:
//   node scripts/run_migration.js migrate_project_watchlist.sql
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

async function runMigration() {
    let pool;
    try {
        const scriptName = String(process.argv[2] || '').trim();
        if (!scriptName) {
            throw new Error('Missing migration file argument. Example: node scripts/run_migration.js migrate_project_watchlist.sql');
        }

        assertSafeDbName(DB_NAME, 'single migration scripts');
        pool = await connectMasterWithRetry({
            connectRetries: CONNECT_RETRIES,
            connectDelayMs: CONNECT_DELAY_MS
        });

        await runSqlFile({
            pool,
            baseDir: __dirname,
            filename: scriptName,
            dbName: DB_NAME
        });

        console.log('\nMigration completed successfully.');
        process.exit(0);
    } catch (err) {
        console.error('\nMigration failed:', err.message);
        process.exit(1);
    } finally {
        if (pool?.close) {
            await pool.close();
        }
    }
}

runMigration();
