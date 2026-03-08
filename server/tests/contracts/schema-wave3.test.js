import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..', '..');

const readScript = (filename) => {
    const absolutePath = path.join(projectRoot, 'scripts', filename);
    return fs.readFileSync(absolutePath, 'utf8');
};

test('migration script includes all wave3 schema elements', () => {
    const migration = readScript('migrate_wave3.sql');
    assert.match(migration, /GovernanceBoard/);
    assert.match(migration, /weeklyCapacityHours/);
    assert.match(migration, /wipLimit/);
    assert.match(migration, /defaultSubmissionEffortHours/);
    assert.match(migration, /IntakeSubmissions/);
    assert.match(migration, /estimatedEffortHours/);
    assert.match(migration, /ProjectBenefitRealization/);
    assert.match(migration, /ExecutiveReportPack/);
    assert.match(migration, /scopeOrgId/);
});

test('canonical schema contains wave3 objects', () => {
    const schema = readScript('schema.sql');
    assert.match(schema, /ProjectBenefitRealization/);
    assert.match(schema, /CK_ProjectBenefitRealization_Status/);
    assert.match(schema, /estimatedEffortHours/);
    assert.match(schema, /defaultSubmissionEffortHours/);
    assert.match(schema, /IX_ExecutiveReportPack_ScopeOrg/);
});
