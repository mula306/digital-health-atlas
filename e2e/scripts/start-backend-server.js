import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { startServer } from '../../server/app.js';
import { setupTestDatabase } from '../../server/tests/helpers/testDb.js';

const port = Number.parseInt(process.env.PORT || '3101', 10);
const host = process.env.HOST || '127.0.0.1';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const loadEnvFile = (filePath) => {
    if (!fs.existsSync(filePath)) return;
    const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
    lines.forEach((rawLine) => {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) return;
        const separatorIndex = line.indexOf('=');
        if (separatorIndex <= 0) return;
        const key = line.slice(0, separatorIndex).trim();
        if (!key || Object.prototype.hasOwnProperty.call(process.env, key)) return;
        let value = line.slice(separatorIndex + 1).trim();
        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }
        process.env[key] = value;
    });
};

loadEnvFile(path.resolve(__dirname, '../../server/.env'));
loadEnvFile(path.resolve(__dirname, '../../.env'));

let runningServer = null;

const shutdown = (signal) => {
    if (!runningServer) {
        process.exit(0);
        return;
    }
    runningServer.close((err) => {
        if (err) {
            console.error(`Failed to close backend server on ${signal}:`, err);
            process.exit(1);
            return;
        }
        process.exit(0);
    });
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

const env = {
    ...process.env,
    NODE_ENV: process.env.NODE_ENV || 'test',
    TEST_AUTH_MODE: process.env.TEST_AUTH_MODE || 'mock',
    PORT: String(port)
};

try {
    await setupTestDatabase({ dbName: process.env.TEST_DB_NAME || 'DHAtlas_test' });

    const { server } = await startServer({ env, host });
    runningServer = server;
} catch (err) {
    console.error('Failed to start backend test server:', err);
    process.exit(1);
}
