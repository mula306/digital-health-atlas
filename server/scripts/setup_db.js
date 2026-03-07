// Run canonical schema.sql to fully initialize DHAtlas on fresh installs.
// Usage:
//   node scripts/setup_db.js
//   npm run setup-db

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

const SQL_FILES_IN_ORDER = [
    'schema.sql'
];

const verifyDatabase = async (pool, dbName) => {
    const escapedDbName = dbName.replace(/]/g, ']]');
    const tableCountQuery = `
        SELECT COUNT(*) AS count
        FROM [${escapedDbName}].INFORMATION_SCHEMA.TABLES
        WHERE TABLE_TYPE = 'BASE TABLE'
    `;
    const tableNamesQuery = `
        SELECT TABLE_NAME
        FROM [${escapedDbName}].INFORMATION_SCHEMA.TABLES
        WHERE TABLE_TYPE = 'BASE TABLE'
        ORDER BY TABLE_NAME
    `;

    const countResult = await pool.request().query(tableCountQuery);
    const tablesResult = await pool.request().query(tableNamesQuery);

    console.log(`\nDatabase "${dbName}" is ready.`);
    console.log(`  Tables: ${countResult.recordset[0].count}`);
    tablesResult.recordset.slice(0, 20).forEach((row) => {
        console.log(`  - ${row.TABLE_NAME}`);
    });
    if (tablesResult.recordset.length > 20) {
        console.log(`  ...and ${tablesResult.recordset.length - 20} more.`);
    }
};

async function setupDatabase() {
    let pool;
    try {
        assertSafeDbName(DB_NAME, 'setup scripts');

        console.log(`Preparing database "${DB_NAME}"...`);
        pool = await connectMasterWithRetry({
            connectRetries: CONNECT_RETRIES,
            connectDelayMs: CONNECT_DELAY_MS
        });

        for (const sqlFile of SQL_FILES_IN_ORDER) {
            await runSqlFile({
                pool,
                baseDir: __dirname,
                filename: sqlFile,
                dbName: DB_NAME
            });
        }

        await verifyDatabase(pool, DB_NAME);
        console.log('\nDatabase setup completed successfully.');
        process.exit(0);
    } catch (err) {
        console.error('\nDatabase setup failed:', err.message);
        console.error('\nCheck:');
        console.error('  1. Docker SQL Server container is running');
        console.error('  2. server/.env has valid DB_* settings');
        console.error('  3. SA password meets SQL Server complexity rules');
        process.exit(1);
    } finally {
        if (pool?.close) {
            await pool.close();
        }
    }
}

setupDatabase();
