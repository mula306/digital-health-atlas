// Run AuditLog migration using the existing DB connection
import { getPool, sql } from '../db.js';

async function runMigration() {
    try {
        const pool = await getPool();
        console.log('Connected. Running AuditLog migration...');

        // Check if table exists
        const check = await pool.request().query(`
            SELECT CASE WHEN EXISTS (SELECT * FROM sys.tables WHERE name = 'AuditLog') THEN 1 ELSE 0 END AS tableExists
        `);

        if (check.recordset[0].tableExists) {
            console.log('AuditLog table already exists. Skipping creation.');
        } else {
            await pool.request().query(`
                CREATE TABLE AuditLog (
                    id          BIGINT IDENTITY(1,1) PRIMARY KEY,
                    action      NVARCHAR(50)   NOT NULL,
                    entityType  NVARCHAR(30)   NOT NULL,
                    entityId    NVARCHAR(20)   NULL,
                    entityTitle NVARCHAR(255)  NULL,
                    userId      NVARCHAR(100)  NULL,
                    userName    NVARCHAR(200)  NULL,
                    [before]    NVARCHAR(MAX)  NULL,
                    [after]     NVARCHAR(MAX)  NULL,
                    metadata    NVARCHAR(MAX)  NULL,
                    ipAddress   NVARCHAR(45)   NULL,
                    userAgent   NVARCHAR(500)  NULL,
                    createdAt   DATETIME2      DEFAULT GETDATE()
                )
            `);
            console.log('AuditLog table created.');
        }

        // Create indexes (idempotent)
        const indexes = [
            { name: 'IX_AuditLog_Action', sql: 'CREATE INDEX IX_AuditLog_Action ON AuditLog(action)' },
            { name: 'IX_AuditLog_EntityType', sql: 'CREATE INDEX IX_AuditLog_EntityType ON AuditLog(entityType)' },
            { name: 'IX_AuditLog_EntityId', sql: 'CREATE INDEX IX_AuditLog_EntityId ON AuditLog(entityId)' },
            { name: 'IX_AuditLog_UserId', sql: 'CREATE INDEX IX_AuditLog_UserId ON AuditLog(userId)' },
            { name: 'IX_AuditLog_CreatedAt', sql: 'CREATE INDEX IX_AuditLog_CreatedAt ON AuditLog(createdAt DESC)' },
            { name: 'IX_AuditLog_Entity_Time', sql: 'CREATE INDEX IX_AuditLog_Entity_Time ON AuditLog(entityType, entityId, createdAt DESC)' },
        ];

        for (const idx of indexes) {
            const exists = await pool.request()
                .input('idxName', sql.NVarChar, idx.name)
                .query(`SELECT CASE WHEN EXISTS (SELECT * FROM sys.indexes WHERE name = @idxName) THEN 1 ELSE 0 END AS [indexExists]`);
            if (!exists.recordset[0].indexExists) {
                await pool.request().query(idx.sql);
                console.log(`  Created index: ${idx.name}`);
            } else {
                console.log(`  Index already exists: ${idx.name}`);
            }
        }

        console.log('Migration completed successfully!');
        process.exit(0);
    } catch (err) {
        console.error('Migration failed:', err);
        process.exit(1);
    }
}

runMigration();
