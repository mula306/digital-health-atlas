import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureTestSetup } from '../helpers/testSetup.js';
import { createTestRequest, asPersona } from '../helpers/testServer.js';
import { TEST_FIXTURE_IDS } from '../fixtures/seed_test_dataset.js';
import { getPool, sql } from '../../db.js';

await ensureTestSetup();
const request = createTestRequest();

const resetProjectSharingState = async () => {
    const pool = await getPool();
    await pool.request()
        .input('projectId', sql.Int, TEST_FIXTURE_IDS.PROJECT_1)
        .input('orgId', sql.Int, TEST_FIXTURE_IDS.ORG_2)
        .input('goalId', sql.Int, TEST_FIXTURE_IDS.GOAL_1)
        .query(`
            DELETE FROM ProjectOrgAccess WHERE projectId = @projectId AND orgId = @orgId;
            DELETE FROM GoalOrgAccess WHERE goalId = @goalId AND orgId = @orgId;
        `);
};

test('bulk share projects auto-shares linked goals for context', async () => {
    await resetProjectSharingState();
    const admin = asPersona(request, 'admin');

    const shareResponse = await admin.post('/api/admin/projects/bulk-share').send({
        projectIds: [TEST_FIXTURE_IDS.PROJECT_1],
        orgId: TEST_FIXTURE_IDS.ORG_2,
        accessLevel: 'read'
    });

    assert.equal(shareResponse.status, 200);
    assert.equal(shareResponse.body.success, true);
    assert.equal(Number(shareResponse.body.linkedGoalCount), 1);

    const summaryResponse = await admin.get(`/api/admin/organizations/${TEST_FIXTURE_IDS.ORG_2}/sharing-summary`);
    assert.equal(summaryResponse.status, 200);
    assert.ok(Array.isArray(summaryResponse.body?.projects));
    const projectEntry = summaryResponse.body.projects.find(
        (item) => Number.parseInt(item.projectId, 10) === TEST_FIXTURE_IDS.PROJECT_1
    );
    assert.ok(projectEntry);
    assert.equal(projectEntry.goalContextMissing, false);
    assert.equal(projectEntry.goalContextStatus, 'complete');
});

test('bulk unshare removes explicit project access entry', async () => {
    const admin = asPersona(request, 'admin');
    const response = await admin.post('/api/admin/projects/bulk-unshare').send({
        projectIds: [TEST_FIXTURE_IDS.PROJECT_1],
        orgId: TEST_FIXTURE_IDS.ORG_2
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.success, true);
});

test('non-admin persona without permission cannot manage sharing summary', async () => {
    const org2Editor = asPersona(request, 'org2_editor');
    const response = await org2Editor.get(`/api/admin/organizations/${TEST_FIXTURE_IDS.ORG_2}/sharing-summary`);
    assert.equal(response.status, 403);
});

