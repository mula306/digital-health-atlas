// Generic SQL migration runner for one migration file.
// Usage:
//   node scripts/run_migration.js <migration-file.sql>
// Example:
//   node scripts/run_migration.js migrate_project_watchlist.sql
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getPool } from '../db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const splitSqlBatches = (script) =>
    script.split(/^\s*GO\s*$/gim).filter((batch) => batch.trim());

async function runMigration() {
    let pool;
    try {
        const scriptName = String(process.argv[2] || '').trim();
        if (!scriptName) {
            throw new Error('Missing migration file argument. Example: node scripts/run_migration.js migrate_project_watchlist.sql');
        }

        const scriptPath = path.join(__dirname, scriptName);
        if (!fs.existsSync(scriptPath)) {
            throw new Error(`Migration file not found: ${scriptName}`);
        }

        console.log(`Connecting to database for migration: ${scriptName}`);
        pool = await getPool();

        console.log('Reading migration script...');
        const sqlScript = fs.readFileSync(scriptPath, 'utf8');
        const batches = splitSqlBatches(sqlScript);
        console.log(`Found ${batches.length} batch(es) to execute.`);

        for (let i = 0; i < batches.length; i += 1) {
            const batch = batches[i].trim();
            if (!batch) continue;

            console.log(`Executing batch ${i + 1}/${batches.length}...`);
            try {
                await pool.request().query(batch);
                console.log(`  OK: batch ${i + 1}`);
            } catch (err) {
                const snippet = batch.split('\n').slice(0, 3).join(' ').slice(0, 200);
                throw new Error(
                    `Batch ${i + 1}/${batches.length} failed in ${scriptName}: ${err.message}\n` +
                    `Batch snippet: ${snippet}`
                );
            }
        }

        console.log('\nMigration completed successfully.');
        process.exit(0);
    } catch (err) {
        console.error('\nMigration failed:', err.message);
        process.exit(1);
    } finally {
        if (pool?.close) {
            await pool.close();
        }
    }
}

runMigration();
