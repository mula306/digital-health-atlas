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

test('canonical schema contains wave3 and governance capacity objects', () => {
    const schema = readScript('schema.sql');
    assert.match(schema, /GovernanceBoard/);
    assert.match(schema, /weeklyCapacityHours/);
    assert.match(schema, /wipLimit/);
    assert.match(schema, /defaultSubmissionEffortHours/);
    assert.match(schema, /ProjectBenefitRealization/);
    assert.match(schema, /CK_ProjectBenefitRealization_Status/);
    assert.match(schema, /ExecutiveReportPack/);
    assert.match(schema, /scopeOrgId/);
    assert.match(schema, /estimatedEffortHours/);
    assert.match(schema, /IX_ExecutiveReportPack_ScopeOrg/);
});

test('canonical schema includes multi-org sharing and workflow session objects', () => {
    const schema = readScript('schema.sql');
    assert.match(schema, /CREATE TABLE Organizations/);
    assert.match(schema, /CREATE TABLE ProjectOrgAccess/);
    assert.match(schema, /CREATE TABLE GoalOrgAccess/);
    assert.match(schema, /CREATE TABLE OrgSharingRequest/);
    assert.match(schema, /CREATE TABLE GovernanceSession/);
    assert.match(schema, /CREATE TABLE WorkflowSlaPolicy/);
    assert.match(schema, /CREATE TABLE ProjectWatchers/);
});

test('canonical schema migrates and constrains goal taxonomy to enterprise cascade values', () => {
    const schema = readScript('schema.sql');
    assert.match(schema, /CK_Goals_Type/);
    assert.match(schema, /'enterprise'/);
    assert.match(schema, /'portfolio'/);
    assert.match(schema, /'service'/);
    assert.match(schema, /'team'/);
    assert.match(schema, /WHEN 'org' THEN 'enterprise'/);
});

test('canonical schema includes archive-first lifecycle columns, constraints, and indexes', () => {
    const schema = readScript('schema.sql');
    assert.match(schema, /CK_Projects_LifecycleState/);
    assert.match(schema, /CK_Goals_LifecycleState/);
    assert.match(schema, /CK_IntakeForms_LifecycleState/);
    assert.match(schema, /resolvedAt DATETIME2 NULL/);
    assert.match(schema, /lastActivityAt DATETIME2 NULL/);
    assert.match(schema, /retentionClass NVARCHAR\(40\)/);
    assert.match(schema, /IX_Projects_LifecycleState/);
    assert.match(schema, /IX_Goals_LifecycleState/);
    assert.match(schema, /IX_IntakeForms_LifecycleState/);
    assert.match(schema, /IX_IntakeSubmissions_ResolvedAt/);
    assert.match(schema, /IX_Tasks_UpdatedAt/);
});

test('setup script uses schema-only initialization path', () => {
    const setupScript = readScript('setup_db.js');
    assert.match(setupScript, /SQL_FILES_IN_ORDER/);
    assert.match(setupScript, /'schema\.sql'/);
    assert.doesNotMatch(setupScript, /migrate_/);
    assert.doesNotMatch(setupScript, /upgrade_db/);
});

test('lifecycle maintenance scripts expose dry-run and apply modes', () => {
    const backfillScript = readScript('backfill_lifecycle.js');
    const retentionScript = readScript('run_retention.js');

    assert.match(backfillScript, /applyChanges = args\.includes\('--apply'\)/);
    assert.match(backfillScript, /lifecycle-backfill-report\.json/);
    assert.match(backfillScript, /goalRetireMonths/);

    assert.match(retentionScript, /applyChanges = args\.includes\('--apply'\)/);
    assert.match(retentionScript, /data-retention-report\.json/);
    assert.match(retentionScript, /Operational-artifact purge categories remain report-only/);
});
