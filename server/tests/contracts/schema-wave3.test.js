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

test('setup script uses schema-only initialization path', () => {
    const setupScript = readScript('setup_db.js');
    assert.match(setupScript, /SQL_FILES_IN_ORDER/);
    assert.match(setupScript, /'schema\.sql'/);
    assert.doesNotMatch(setupScript, /migrate_/);
    assert.doesNotMatch(setupScript, /upgrade_db/);
});
