import { seedTestDataset } from '../tests/fixtures/seed_test_dataset.js';

async function run() {
    try {
        await seedTestDataset();
        console.log('Test fixtures seeded successfully.');
        process.exit(0);
    } catch (err) {
        console.error('Failed to seed test fixtures:', err.message);
        process.exit(1);
    }
}

run();

