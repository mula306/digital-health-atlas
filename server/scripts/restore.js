import { exec } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const CONTAINER_NAME = 'sqlserver2022';
const DB_NAME = 'DHAtlas';
const BACKUP_FILENAME = 'DHAtlas_Base.bak';
const CONTAINER_BACKUP_PATH = `/var/opt/mssql/backups/${BACKUP_FILENAME}`;
const HOST_BACKUP_PATH = path.join(__dirname, '../backups', BACKUP_FILENAME);

// SQL Commands
// 1. Set Single User to kill connections
const KILL_CONNECTIONS_CMD = `ALTER DATABASE [${DB_NAME}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE`;
// 2. Restore Database
const RESTORE_CMD = `RESTORE DATABASE [${DB_NAME}] FROM DISK = '${CONTAINER_BACKUP_PATH}' WITH FILE = 1, NOUNLOAD, REPLACE, STATS = 5`;
// 3. Set Multi User
const MULTI_USER_CMD = `ALTER DATABASE [${DB_NAME}] SET MULTI_USER`;

const FULL_SQL_CMD = `${KILL_CONNECTIONS_CMD}; ${RESTORE_CMD}; ${MULTI_USER_CMD}`;

async function execute(command) {
    return new Promise((resolve, reject) => {
        exec(command, (error, stdout, stderr) => {
            if (error) {
                // Ignore specific "database is in use" errors if we are forcing it, but we handle it via SQL
                console.error(`Error: ${error.message}`);
                return reject(error);
            }
            if (stderr) console.log(`Log: ${stderr}`);
            resolve(stdout);
        });
    });
}

async function runRestore() {
    console.log(`⚠️  WARNING: This will OVERWRITE database [${DB_NAME}] with the snapshot.`);
    console.log(`   Source: ${HOST_BACKUP_PATH}`);

    // Simple 5s countdown or prompt could go here, but for auto-script we skip

    try {
        // 1. Copy backup file from Host to Container
        console.log(`🔹 Copying backup file to container...`);
        await execute(`docker cp "${HOST_BACKUP_PATH}" ${CONTAINER_NAME}:${CONTAINER_BACKUP_PATH}`);
        console.log(`✅ File copied.`);

        // 2. Execute Restore
        console.log(`🔹 Executing RESTORE (This drops active connections)...`);
        const dockerCmd = `docker exec ${CONTAINER_NAME} /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P "YourStrong@Passw0rd" -C -Q "${FULL_SQL_CMD}"`;

        await execute(dockerCmd);

        console.log(`✅ Restore Complete! Database [${DB_NAME}] has been reset to base state.`);

    } catch (err) {
        console.error('❌ Restore Failed:', err);
        // Try to fix multi-user mode if it got stuck?
        // await execute(`docker exec ${CONTAINER_NAME} /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P "YourStrong@Passw0rd" -C -Q "ALTER DATABASE [${DB_NAME}] SET MULTI_USER"`).catch(() => {});
        process.exit(1);
    }
}

runRestore();
