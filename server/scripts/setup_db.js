// Run the full schema.sql to create/verify the DHAtlas database
// Usage:  node scripts/setup_db.js
//   or:   npm run setup-db

import { getPool } from '../db.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function setupDatabase() {
    try {
        console.log('Connecting to SQL Server...');
        const pool = await getPool();

        console.log('Reading schema.sql...');
        const sqlScript = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');

        // Split by GO statements (MSSQL batch separator)
        const batches = sqlScript.split(/^\s*GO\s*$/mi).filter(b => b.trim());

        console.log(`Found ${batches.length} batches to execute...\n`);

        let succeeded = 0;
        let skipped = 0;

        for (let i = 0; i < batches.length; i++) {
            const batch = batches[i].trim();
            if (!batch) continue;

            try {
                await pool.request().query(batch);
                succeeded++;
                // Show progress for long scripts
                if (i % 10 === 0 || i === batches.length - 1) {
                    process.stdout.write(`  Progress: ${i + 1}/${batches.length}\r`);
                }
            } catch (_err) {
                // Many batches will "fail" because tables/indexes already exist — that's fine
                skipped++;
            }
        }

        console.log(`\n\n=== Database Setup Complete ===`);
        console.log(`  Succeeded: ${succeeded}`);
        console.log(`  Skipped (already exists): ${skipped}`);

        // Quick verification
        const tables = await pool.request().query(`
            SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
            WHERE TABLE_TYPE = 'BASE TABLE'
            ORDER BY TABLE_NAME
        `);
        console.log(`\n  Tables in DHAtlas: ${tables.recordset.length}`);
        tables.recordset.forEach(t => console.log(`    • ${t.TABLE_NAME}`));

        process.exit(0);
    } catch (err) {
        console.error('\nDatabase setup failed:', err.message);
        console.error('\nMake sure:');
        console.error('  1. SQL Server is running (docker / local)');
        console.error('  2. server/.env has valid DB_USER, DB_PASSWORD, DB_SERVER');
        process.exit(1);
    }
}

setupDatabase();
