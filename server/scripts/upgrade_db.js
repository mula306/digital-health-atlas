// Run migrations for existing databases that were created before schema.sql became canonical.
// Usage:
//   node scripts/upgrade_db.js
//   npm run upgrade-db

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getSqlConfig, sql } from '../db.js';

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
    'migrate_project_watchlist.sql'
];

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const assertSafeDbName = (dbName) => {
    if (!/^[A-Za-z0-9_]+$/.test(dbName)) {
        throw new Error(
            `DB_NAME "${dbName}" is invalid. Use letters, numbers, or underscore only for migration scripts.`
        );
    }
};

const applyDatabaseName = (script, dbName) => script.replace(/\bDHAtlas\b/g, dbName);

const splitSqlBatches = (script) => script.split(/^\s*GO\s*$/gim).filter((batch) => batch.trim());

const connectWithRetry = async () => {
    const masterConfig = getSqlConfig({ database: 'master' });
    let lastError = null;

    for (let attempt = 1; attempt <= CONNECT_RETRIES; attempt += 1) {
        try {
            const pool = await sql.connect(masterConfig);
            console.log(`Connected to SQL Server (attempt ${attempt}/${CONNECT_RETRIES}).`);
            return pool;
        } catch (err) {
            lastError = err;
            console.log(
                `SQL not ready yet (attempt ${attempt}/${CONNECT_RETRIES}): ${err.message}`
            );
            if (attempt < CONNECT_RETRIES) {
                await pause(CONNECT_DELAY_MS);
            }
        }
    }

    throw lastError || new Error('Unable to connect to SQL Server.');
};

const runSqlFile = async (pool, filename, dbName) => {
    const filePath = path.join(__dirname, filename);
    if (!fs.existsSync(filePath)) {
        throw new Error(`Missing SQL file: ${filename}`);
    }

    const rawScript = fs.readFileSync(filePath, 'utf8');
    const script = applyDatabaseName(rawScript, dbName);
    const batches = splitSqlBatches(script);

    console.log(`\nRunning ${filename} (${batches.length} batches)...`);

    for (let i = 0; i < batches.length; i += 1) {
        const batch = batches[i].trim();
        if (!batch) continue;

        try {
            await pool.request().query(batch);
            if (i % 10 === 0 || i === batches.length - 1) {
                process.stdout.write(`  Progress: ${i + 1}/${batches.length}\r`);
            }
        } catch (err) {
            const snippet = batch.split('\n').slice(0, 3).join(' ').slice(0, 180);
            throw new Error(
                `${filename} failed at batch ${i + 1}/${batches.length}: ${err.message}\n` +
                `Batch snippet: ${snippet}`
            );
        }
    }

    process.stdout.write('\n');
};

async function upgradeDatabase() {
    let pool;
    try {
        assertSafeDbName(DB_NAME);
        console.log(`Applying migrations to "${DB_NAME}"...`);
        pool = await connectWithRetry();

        for (const sqlFile of MIGRATION_FILES_IN_ORDER) {
            await runSqlFile(pool, sqlFile, DB_NAME);
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
