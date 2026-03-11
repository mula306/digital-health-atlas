import path from 'path';
import { fileURLToPath } from 'url';
import { assertSafeDbName, connectMasterWithRetry, runSqlFile } from '../../scripts/sql_script_runner.js';
import { closePool, getPool, sql } from '../../db.js';
import { seedPermissions } from '../../utils/seedPermissions.js';
import { seedTestDataset } from '../fixtures/seed_test_dataset.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scriptsDir = path.resolve(__dirname, '..', '..', 'scripts');

const ensureTestAuthMode = () => {
    if (String(process.env.NODE_ENV || '').toLowerCase() === 'production') {
        throw new Error('Refusing to run tests against NODE_ENV=production.');
    }
    process.env.NODE_ENV = process.env.NODE_ENV || 'test';
    process.env.TEST_AUTH_MODE = 'mock';
};

const dropDatabaseIfExists = async (pool, dbName) => {
    const escaped = dbName.replace(/]/g, ']]');
    await pool.request().query(`
        IF DB_ID(N'${escaped}') IS NOT NULL
        BEGIN
            ALTER DATABASE [${escaped}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
            DROP DATABASE [${escaped}];
        END
    `);
};

export const setupTestDatabase = async (options = {}) => {
    ensureTestAuthMode();
    const dbName = options.dbName || process.env.TEST_DB_NAME || 'DHAtlas_test';
    assertSafeDbName(dbName, 'test harness');

    await closePool();
    const masterPool = await connectMasterWithRetry({
        connectRetries: Number.parseInt(process.env.DB_CONNECT_RETRIES || '20', 10),
        connectDelayMs: Number.parseInt(process.env.DB_CONNECT_DELAY_MS || '1000', 10)
    });

    try {
        await dropDatabaseIfExists(masterPool, dbName);
        await runSqlFile({
            pool: masterPool,
            baseDir: scriptsDir,
            filename: 'schema.sql',
            dbName
        });
    } finally {
        await masterPool.close();
    }

    process.env.DB_NAME = dbName;
    await closePool();
    await seedPermissions({ throwOnError: true });
    await seedTestDataset();
};

export const teardownTestDatabase = async (options = {}) => {
    const dbName = options.dbName || process.env.TEST_DB_NAME || process.env.DB_NAME || 'DHAtlas_test';
    assertSafeDbName(dbName, 'test teardown');
    await closePool();
    const masterPool = await connectMasterWithRetry({
        connectRetries: Number.parseInt(process.env.DB_CONNECT_RETRIES || '20', 10),
        connectDelayMs: Number.parseInt(process.env.DB_CONNECT_DELAY_MS || '1000', 10)
    });
    try {
        await dropDatabaseIfExists(masterPool, dbName);
    } finally {
        await masterPool.close();
    }
};

export const resetRateLimitsForTests = () => {
    process.env.API_RATE_LIMIT_WINDOW_MS = process.env.API_RATE_LIMIT_WINDOW_MS || '60000';
    process.env.API_RATE_LIMIT_MAX = process.env.API_RATE_LIMIT_MAX || '250';
};

export const clearDynamicTestData = async () => {
    const pool = await getPool();
    await pool.request().query(`
        DELETE FROM GovernanceReviewVote;
        DELETE FROM GovernanceReviewParticipant;
        DELETE FROM GovernanceReview;
        DELETE FROM GovernanceSessionAgenda;
        DELETE FROM GovernanceSession;
    `);
};

export const getScalar = async (queryText, params = {}) => {
    const pool = await getPool();
    const request = pool.request();
    Object.entries(params).forEach(([key, value]) => {
        if (Number.isInteger(value)) {
            request.input(key, sql.Int, value);
        } else if (typeof value === 'boolean') {
            request.input(key, sql.Bit, value ? 1 : 0);
        } else {
            request.input(key, sql.NVarChar, value);
        }
    });
    const result = await request.query(queryText);
    const row = result.recordset[0];
    if (!row) return null;
    const firstKey = Object.keys(row)[0];
    return row[firstKey];
};

