// Run GoalOrgAccess migration using the existing DB connection
import { getPool, sql } from '../db.js';

async function runMigration() {
    try {
        const pool = await getPool();
        console.log('Connected. Running GoalOrgAccess migration...');

        // Check if table exists
        const check = await pool.request().query(`
            SELECT CASE WHEN EXISTS (SELECT * FROM sys.tables WHERE name = 'GoalOrgAccess') THEN 1 ELSE 0 END AS tableExists
        `);

        if (check.recordset[0].tableExists) {
            console.log('GoalOrgAccess table already exists. Skipping creation.');
        } else {
            await pool.request().query(`
                CREATE TABLE GoalOrgAccess (
                    goalId       INT NOT NULL,
                    orgId        INT NOT NULL,
                    accessLevel  NVARCHAR(20) NOT NULL DEFAULT 'read',
                    grantedAt    DATETIME2 DEFAULT GETDATE(),
                    grantedByOid NVARCHAR(100) NULL,
                    CONSTRAINT PK_GoalOrgAccess PRIMARY KEY (goalId, orgId),
                    CONSTRAINT FK_GoalOrgAccess_Goal FOREIGN KEY (goalId) REFERENCES Goals(id) ON DELETE CASCADE,
                    CONSTRAINT FK_GoalOrgAccess_Org FOREIGN KEY (orgId) REFERENCES Organizations(id) ON DELETE CASCADE,
                    CONSTRAINT CK_GoalOrgAccess_Level CHECK (accessLevel IN ('read', 'write'))
                )
            `);
            console.log('GoalOrgAccess table created.');
        }

        // Create indexes (idempotent)
        const indexes = [
            { name: 'IX_GoalOrgAccess_OrgId', sql: 'CREATE INDEX IX_GoalOrgAccess_OrgId ON GoalOrgAccess(orgId)' },
            { name: 'IX_GoalOrgAccess_GoalId', sql: 'CREATE INDEX IX_GoalOrgAccess_GoalId ON GoalOrgAccess(goalId)' },
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

        console.log('GoalOrgAccess migration completed successfully!');
        process.exit(0);
    } catch (err) {
        console.error('Migration failed:', err);
        process.exit(1);
    }
}

runMigration();
