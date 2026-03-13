import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONTAINER_NAME = process.env.SNAPSHOT_CONTAINER_NAME || 'sqlserver2022';
const DB_NAME = process.env.SNAPSHOT_DB_NAME || process.env.DB_NAME || 'DHAtlas';
const DB_PASSWORD = process.env.SNAPSHOT_DB_PASSWORD || process.env.DB_PASSWORD;
const BACKUP_FILENAME = process.env.SNAPSHOT_FILENAME || `${DB_NAME}_Base.bak`;
const CONTAINER_BACKUP_PATH = `/var/opt/mssql/backups/${BACKUP_FILENAME}`;
const HOST_BACKUP_DIR = path.join(__dirname, '../backups');
const HOST_BACKUP_PATH = path.join(HOST_BACKUP_DIR, BACKUP_FILENAME);
const SQLCMD_PATH = process.env.SNAPSHOT_SQLCMD_PATH || '/opt/mssql-tools18/bin/sqlcmd';

const BACKUP_QUERY =
    `BACKUP DATABASE [${DB_NAME}] TO DISK = '${CONTAINER_BACKUP_PATH}' ` +
    `WITH FORMAT, INIT, NAME = '${DB_NAME}-Full Database Backup', SKIP, NOREWIND, NOUNLOAD, STATS = 10`;

function execute(command, args) {
    return new Promise((resolve, reject) => {
        execFile(command, args, { windowsHide: true }, (error, stdout, stderr) => {
            if (error) {
                reject(error);
                return;
            }
            if (stderr) {
                console.log(stderr.trim());
            }
            resolve(stdout);
        });
    });
}

function ensureSnapshotConfig() {
    if (!DB_PASSWORD) {
        throw new Error('Set DB_PASSWORD or SNAPSHOT_DB_PASSWORD before running the snapshot script.');
    }
}

async function runSnapshot() {
    ensureSnapshotConfig();
    console.log(`Starting database snapshot for [${DB_NAME}]...`);

    await execute('docker', [
        'exec',
        CONTAINER_NAME,
        SQLCMD_PATH,
        '-S',
        'localhost',
        '-U',
        'sa',
        '-P',
        DB_PASSWORD,
        '-C',
        '-Q',
        BACKUP_QUERY
    ]);
    console.log(`Backup created inside container at ${CONTAINER_BACKUP_PATH}`);

    if (!fs.existsSync(HOST_BACKUP_DIR)) {
        fs.mkdirSync(HOST_BACKUP_DIR, { recursive: true });
    }

    await execute('docker', ['cp', `${CONTAINER_NAME}:${CONTAINER_BACKUP_PATH}`, HOST_BACKUP_PATH]);
    console.log(`Snapshot saved to: ${HOST_BACKUP_PATH}`);

    const stats = fs.statSync(HOST_BACKUP_PATH);
    console.log(`Backup size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
}

runSnapshot().catch((err) => {
    console.error('Snapshot failed:', err);
    process.exit(1);
});