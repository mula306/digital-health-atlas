import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..', '..');

const readRouteFile = (relativePath) => {
    const absolutePath = path.join(projectRoot, relativePath);
    return fs.readFileSync(absolutePath, 'utf8');
};

test('wave3 project routes are present', () => {
    const source = readRouteFile('routes/projects.js');
    assert.match(source, /router\.get\('\/:id\/benefits-risk'/);
    assert.match(source, /router\.post\('\/:id\/benefits'/);
    assert.match(source, /router\.put\('\/:id\/benefits\/:benefitId'/);
    assert.match(source, /router\.delete\('\/:id\/benefits\/:benefitId'/);
});

test('wave3 executive pack scheduler routes are present', () => {
    const source = readRouteFile('routes/reports.js');
    assert.match(source, /router\.get\('\/scheduler\/status'/);
    assert.match(source, /router\.post\('\/scheduler\/run-due'/);
    assert.match(source, /export const startExecutivePackScheduler/);
    assert.match(source, /export const runDueExecutiveReportPacks/);
});

test('governance board capacity fields are exposed', () => {
    const source = readRouteFile('routes/governance.js');
    assert.match(source, /weeklyCapacityHours/);
    assert.match(source, /wipLimit/);
    assert.match(source, /defaultSubmissionEffortHours/);
    assert.match(source, /boardCapacityReady/);
});

test('intake governance queue returns capacity scenario payload', () => {
    const source = readRouteFile('routes/intake.js');
    assert.match(source, /router\.get\('\/governance-queue'/);
    assert.match(source, /scenarioApproveNow/);
    assert.match(source, /capacityEffortHours/);
});
