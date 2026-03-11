import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..', '..');

const readFile = (relativePath) => {
    const absolutePath = path.join(projectRoot, relativePath);
    return fs.readFileSync(absolutePath, 'utf8');
};

test('server bootstrap exposes app factory and start function', () => {
    const source = readFile('app.js');
    assert.match(source, /export const createApp/);
    assert.match(source, /export const startServer/);
});

test('mock auth contract uses x-test-user personas', () => {
    const source = readFile('app.js');
    assert.match(source, /x-test-user/);
    assert.match(source, /TEST_AUTH_MODE=mock is not allowed in production/);
    assert.match(source, /Unauthorized: provide valid x-test-user persona/);
});

test('test fixture seed script is available for deterministic datasets', () => {
    const source = readFile('scripts/seed_test_fixtures.js');
    assert.match(source, /seedTestDataset/);
});

