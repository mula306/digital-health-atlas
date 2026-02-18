import { exec } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const CONTAINER_NAME = 'sqlserver2022';
const DB_NAME = 'DHAtlas';
const BACKUP_FILENAME = 'DHAtlas_Base.bak';
const CONTAINER_BACKUP_PATH = `/var/opt/mssql/backups/${BACKUP_FILENAME}`;
const HOST_BACKUP_DIR = path.join(__dirname, '../backups');
const HOST_BACKUP_PATH = path.join(HOST_BACKUP_DIR, BACKUP_FILENAME);

// SQL Command to backup database
// WITH FORMAT overwrites existing media, WITH INIT overwrites existing backup sets
const BACKUP_CMD = `sqlcmd -S localhost -U sa -P "YourStrong@Passw0rd" -C -Q "BACKUP DATABASE [${DB_NAME}] TO DISK = '${CONTAINER_BACKUP_PATH}' WITH FORMAT, INIT, NAME = '${DB_NAME}-Full Database Backup', SKIP, NOREWIND, NOUNLOAD, STATS = 10"`;

async function execute(command) {
    return new Promise((resolve, reject) => {
        exec(command, (error, stdout, stderr) => {
            if (error) {
                console.error(`Error: ${error.message}`);
                return reject(error);
            }
            if (stderr) {
                // sqlcmd outputs progress to stderr sometimes, but meaningful errors too
                console.log(`Log: ${stderr}`);
            }
            resolve(stdout);
        });
    });
}

async function runSnapshot() {
    console.log(`📸 Starting Database Snapshot for [${DB_NAME}]...`);

    try {
        // 1. Ensure backup directory exists in container (usually default, but good to check)
        // /var/opt/mssql/backups is the standard mount or path

        // 2. Run Backup inside Docker
        console.log(`🔹 Executing backup inside container '${CONTAINER_NAME}'...`);
        const dockerCmd = `docker exec ${CONTAINER_NAME} /opt/mssql-tools18/bin/${BACKUP_CMD}`;
        await execute(dockerCmd);
        console.log(`✅ Backup created inside container at ${CONTAINER_BACKUP_PATH}`);

        // 3. Copy backup file to Host
        console.log(`🔹 Copying backup to host: ${HOST_BACKUP_PATH}...`);

        // Ensure host dir exists
        if (!fs.existsSync(HOST_BACKUP_DIR)) {
            fs.mkdirSync(HOST_BACKUP_DIR, { recursive: true });
        }

        await execute(`docker cp ${CONTAINER_NAME}:${CONTAINER_BACKUP_PATH} "${HOST_BACKUP_PATH}"`);
        console.log(`✅ Snapshot saved to: ${HOST_BACKUP_PATH}`);

        // 4. Verify file size
        const stats = fs.statSync(HOST_BACKUP_PATH);
        console.log(`📦 Backup Size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);

    } catch (err) {
        console.error('❌ Snapshot Failed:', err);
        process.exit(1);
    }
}

runSnapshot();
