// Run the tag migration script using the existing DB connection
import { getPool, sql } from './db.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function runMigration() {
    try {
        console.log('Connecting to database...');
        const pool = await getPool();

        console.log('Reading migration script...');
        const sqlScript = fs.readFileSync(path.join(__dirname, 'migrate_tags.sql'), 'utf8');

        // Split by GO statements (MSSQL batch separator)
        const batches = sqlScript.split(/^\s*GO\s*$/mi).filter(b => b.trim());

        console.log(`Found ${batches.length} batches to execute...`);

        for (let i = 0; i < batches.length; i++) {
            const batch = batches[i].trim();
            if (!batch) continue;

            try {
                console.log(`Executing batch ${i + 1}/${batches.length}...`);
                await pool.request().query(batch);
                console.log(`  ✓ Batch ${i + 1} completed`);
            } catch (err) {
                console.error(`  ✗ Batch ${i + 1} failed:`, err.message);
                // Continue with other batches (some may fail if tables already exist)
            }
        }

        // Verify: count records
        const groups = await pool.request().query('SELECT COUNT(*) as count FROM TagGroups');
        const tags = await pool.request().query('SELECT COUNT(*) as count FROM Tags');
        const aliases = await pool.request().query('SELECT COUNT(*) as count FROM TagAliases');

        console.log('\n=== Migration Complete ===');
        console.log(`TagGroups: ${groups.recordset[0].count}`);
        console.log(`Tags: ${tags.recordset[0].count}`);
        console.log(`TagAliases: ${aliases.recordset[0].count}`);

        process.exit(0);
    } catch (err) {
        console.error('Migration failed:', err);
        process.exit(1);
    }
}

runMigration();
