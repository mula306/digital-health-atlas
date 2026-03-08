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

test('migration manifest stays aligned with upgrade runner coverage', () => {
    const manifest = readScript('migration_manifest.js');
    assert.match(manifest, /migrate_governance_phase0\.sql/);
    assert.match(manifest, /migrate_governance_phase1\.sql/);
    assert.match(manifest, /migrate_governance_phase2\.sql/);
    assert.match(manifest, /migrate_governance_phase3\.sql/);
    assert.match(manifest, /migrate_multi_org\.sql/);
    assert.match(manifest, /migrate_org_sharing_v2\.sql/);
    assert.match(manifest, /migrate_project_goals\.sql/);
    assert.match(manifest, /migrate_project_watchlist\.sql/);
    assert.match(manifest, /migrate_task_tracking_phase1\.sql/);
    assert.match(manifest, /migrate_wave2\.sql/);
    assert.match(manifest, /migrate_wave3\.sql/);
});

test('single migration runner supports DB_NAME-safe execution path', () => {
    const runner = readScript('run_migration.js');
    assert.match(runner, /assertSafeDbName/);
    assert.match(runner, /connectMasterWithRetry/);
    assert.match(runner, /runSqlFile/);
});
