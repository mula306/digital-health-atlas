import { seedPermissions } from '../utils/seedPermissions.js';

async function run() {
    try {
        const result = await seedPermissions({ throwOnError: true });
        console.log(`Seeded ${result.totalEntries} role-permission defaults (${result.mode}).`);
        process.exit(0);
    } catch (err) {
        console.error('Permission seed failed:', err.message);
        process.exit(1);
    }
}

run();

