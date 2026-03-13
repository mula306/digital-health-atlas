import fs from 'fs';
import path from 'path';
import { getSqlConfig, sql } from '../db.js';

const DEFAULT_CONNECT_RETRIES = 30;
const DEFAULT_CONNECT_DELAY_MS = 2000;

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const splitSqlBatches = (script) =>
    script.split(/^\s*GO\s*$/gim).filter((batch) => batch.trim());

export const assertSafeDbName = (dbName, contextLabel = 'scripts') => {
    if (!/^[A-Za-z0-9_]+$/.test(dbName)) {
        throw new Error(
            `DB_NAME "${dbName}" is invalid. Use letters, numbers, or underscore only for ${contextLabel}.`
        );
    }
};

export const applyDatabaseName = (script, dbName) => script.replace(/\bDHAtlas\b/g, dbName);

export const connectMasterWithRetry = async ({
    connectRetries = DEFAULT_CONNECT_RETRIES,
    connectDelayMs = DEFAULT_CONNECT_DELAY_MS
} = {}) => {
    const masterConfig = getSqlConfig({ database: 'master' });
    let lastError = null;

    for (let attempt = 1; attempt <= connectRetries; attempt += 1) {
        try {
            const pool = await sql.connect(masterConfig);
            console.log(`Connected to SQL Server (attempt ${attempt}/${connectRetries}).`);
            return pool;
        } catch (err) {
            lastError = err;
            console.log(`SQL not ready yet (attempt ${attempt}/${connectRetries}): ${err.message}`);
            if (attempt < connectRetries) {
                await pause(connectDelayMs);
            }
        }
    }

    throw lastError || new Error('Unable to connect to SQL Server.');
};

export const runSqlFile = async ({
    pool,
    baseDir,
    filename,
    dbName,
    progressEvery = 10
}) => {
    const filePath = path.join(baseDir, filename);
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
            if (i % progressEvery === 0 || i === batches.length - 1) {
                process.stdout.write(`  Progress: ${i + 1}/${batches.length}\r`);
            }
        } catch (err) {
            const snippet = batch.split('\n').slice(0, 3).join(' ').slice(0, 180);
            throw new Error(
                `${filename} failed at batch ${i + 1}/${batches.length}: ${err.message}\n` +
                `Batch snippet: ${snippet}`,
                { cause: err }
            );
        }
    }

    process.stdout.write('\n');
};
