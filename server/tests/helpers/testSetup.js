import { setupTestDatabase, resetRateLimitsForTests } from './testDb.js';

let setupPromise = null;

export const ensureTestSetup = async () => {
    if (!setupPromise) {
        setupPromise = (async () => {
            resetRateLimitsForTests();
            await setupTestDatabase();
        })();
    }
    return setupPromise;
};

