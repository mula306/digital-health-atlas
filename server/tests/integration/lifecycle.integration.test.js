import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureTestSetup } from '../helpers/testSetup.js';
import { createTestRequest, asPersona } from '../helpers/testServer.js';
import { TEST_FIXTURE_IDS } from '../fixtures/seed_test_dataset.js';
import { getPool, sql } from '../../db.js';

await ensureTestSetup();
const request = createTestRequest();

const resetLifecycleFixtures = async () => {
    const pool = await getPool();
    await pool.request()
        .input('projectId', sql.Int, TEST_FIXTURE_IDS.PROJECT_1)
        .input('goalId', sql.Int, TEST_FIXTURE_IDS.GOAL_1)
        .input('formId', sql.Int, TEST_FIXTURE_IDS.FORM_1)
        .query(`
            UPDATE Projects
            SET
                title = 'Test Project Org1',
                description = 'Deterministic fixture project for org1',
                status = 'active',
                lifecycleState = 'active',
                completedAt = NULL,
                archivedAt = NULL,
                archivedByOid = NULL,
                archiveReason = NULL,
                lastActivityAt = GETDATE(),
                retentionClass = 'confidential'
            WHERE id = @projectId;

            UPDATE Goals
            SET
                title = 'Test Goal Org1',
                description = 'Deterministic fixture goal for org1',
                lifecycleState = 'active',
                retiredAt = NULL,
                archivedAt = NULL,
                archivedByOid = NULL,
                archiveReason = NULL,
                lastActivityAt = GETDATE(),
                retentionClass = 'confidential'
            WHERE id = @goalId;

            UPDATE IntakeForms
            SET
                name = 'Test Intake Form',
                description = 'Deterministic intake form for integration tests',
                lifecycleState = 'active',
                retiredAt = NULL,
                archivedAt = NULL,
                archivedByOid = NULL
            WHERE id = @formId;
        `);
};

test.beforeEach(async () => {
    await resetLifecycleFixtures();
});

test('project archive flow hides archived projects from active lists and restores them cleanly', async () => {
    const admin = asPersona(request, 'admin');

    const archiveResponse = await admin.delete(`/api/projects/${TEST_FIXTURE_IDS.PROJECT_1}`);
    assert.equal(archiveResponse.status, 200);
    assert.equal(archiveResponse.body.lifecycleState, 'archived');

    const blockedUpdate = await admin.put(`/api/projects/${TEST_FIXTURE_IDS.PROJECT_1}`).send({
        title: 'Should Not Update',
        description: 'Archived project should stay read-only',
        status: 'active',
        goalIds: [TEST_FIXTURE_IDS.GOAL_1]
    });
    assert.equal(blockedUpdate.status, 409);
    assert.match(String(blockedUpdate.body?.error || ''), /archived projects are read-only/i);

    const [activeListResponse, archivedListResponse] = await Promise.all([
        admin.get('/api/projects?lifecycle=active'),
        admin.get('/api/projects?lifecycle=archived')
    ]);

    assert.equal(activeListResponse.status, 200);
    assert.equal(archivedListResponse.status, 200);
    assert.equal(
        (activeListResponse.body?.projects || []).some((project) => Number(project.id) === TEST_FIXTURE_IDS.PROJECT_1),
        false
    );
    const archivedProject = (archivedListResponse.body?.projects || []).find(
        (project) => Number(project.id) === TEST_FIXTURE_IDS.PROJECT_1
    );
    assert.ok(archivedProject);
    assert.equal(archivedProject.lifecycleState, 'archived');

    const restoreResponse = await admin.post(`/api/projects/${TEST_FIXTURE_IDS.PROJECT_1}/restore`).send({});
    assert.equal(restoreResponse.status, 200);
    assert.equal(restoreResponse.body.lifecycleState, 'active');

    const restoredActiveList = await admin.get('/api/projects?lifecycle=active');
    assert.equal(restoredActiveList.status, 200);
    assert.equal(
        (restoredActiveList.body?.projects || []).some((project) => Number(project.id) === TEST_FIXTURE_IDS.PROJECT_1),
        true
    );
});

test('goal retire and archive flows use lifecycle filters and remain read-only until restored', async () => {
    const admin = asPersona(request, 'admin');

    const retireResponse = await admin.post(`/api/goals/${TEST_FIXTURE_IDS.GOAL_1}/retire`).send({
        reason: 'Lifecycle integration test'
    });
    assert.equal(retireResponse.status, 200);
    assert.equal(retireResponse.body.lifecycleState, 'retired');

    const blockedUpdate = await admin.put(`/api/goals/${TEST_FIXTURE_IDS.GOAL_1}`).send({
        title: 'Should Not Update',
        description: 'Retired goal should stay read-only',
        type: 'enterprise'
    });
    assert.equal(blockedUpdate.status, 409);
    assert.match(String(blockedUpdate.body?.error || ''), /retired or archived goals are read-only/i);

    const [activeListResponse, archivedListResponse] = await Promise.all([
        admin.get('/api/goals?lifecycle=active'),
        admin.get('/api/goals?lifecycle=archived')
    ]);
    assert.equal(activeListResponse.status, 200);
    assert.equal(archivedListResponse.status, 200);
    assert.equal(activeListResponse.body.some((goal) => Number(goal.id) === TEST_FIXTURE_IDS.GOAL_1), false);

    const retiredGoal = archivedListResponse.body.find((goal) => Number(goal.id) === TEST_FIXTURE_IDS.GOAL_1);
    assert.ok(retiredGoal);
    assert.equal(retiredGoal.lifecycleState, 'retired');

    const restoreAfterRetire = await admin.post(`/api/goals/${TEST_FIXTURE_IDS.GOAL_1}/restore`).send({});
    assert.equal(restoreAfterRetire.status, 200);
    assert.equal(restoreAfterRetire.body.lifecycleState, 'active');

    const archiveResponse = await admin.post(`/api/goals/${TEST_FIXTURE_IDS.GOAL_1}/archive`).send({
        reason: 'Archive coverage'
    });
    assert.equal(archiveResponse.status, 200);
    assert.equal(archiveResponse.body.lifecycleState, 'archived');

    const archivedListAgain = await admin.get('/api/goals?lifecycle=archived');
    assert.equal(archivedListAgain.status, 200);
    const archivedGoal = archivedListAgain.body.find((goal) => Number(goal.id) === TEST_FIXTURE_IDS.GOAL_1);
    assert.ok(archivedGoal);
    assert.equal(archivedGoal.lifecycleState, 'archived');

    const restoreAfterArchive = await admin.post(`/api/goals/${TEST_FIXTURE_IDS.GOAL_1}/restore`).send({});
    assert.equal(restoreAfterArchive.status, 200);
    assert.equal(restoreAfterArchive.body.lifecycleState, 'active');
});

test('deleting intake forms with submissions retires them instead of deleting history and lifecycle filters behave correctly', async () => {
    const admin = asPersona(request, 'admin');

    const deleteResponse = await admin.delete(`/api/intake/forms/${TEST_FIXTURE_IDS.FORM_1}`);
    assert.equal(deleteResponse.status, 200);
    assert.equal(deleteResponse.body.lifecycleState, 'retired');

    const updateWhileRetired = await admin.put(`/api/intake/forms/${TEST_FIXTURE_IDS.FORM_1}`).send({
        name: 'Should Not Update',
        description: 'Retired forms should remain read-only',
        fields: []
    });
    assert.equal(updateWhileRetired.status, 409);
    assert.match(String(updateWhileRetired.body?.error || ''), /retired or archived intake forms are read-only/i);

    const [activeFormsResponse, archivedFormsResponse] = await Promise.all([
        admin.get('/api/intake/forms?lifecycle=active'),
        admin.get('/api/intake/forms?lifecycle=archived')
    ]);
    assert.equal(activeFormsResponse.status, 200);
    assert.equal(archivedFormsResponse.status, 200);
    assert.equal(activeFormsResponse.body.some((form) => Number(form.id) === TEST_FIXTURE_IDS.FORM_1), false);

    const retiredForm = archivedFormsResponse.body.find((form) => Number(form.id) === TEST_FIXTURE_IDS.FORM_1);
    assert.ok(retiredForm);
    assert.equal(retiredForm.lifecycleState, 'retired');

    const pool = await getPool();
    const submissionCountResult = await pool.request()
        .input('formId', sql.Int, TEST_FIXTURE_IDS.FORM_1)
        .query('SELECT COUNT(*) AS count FROM IntakeSubmissions WHERE formId = @formId');
    assert.ok(Number(submissionCountResult.recordset[0]?.count) > 0);

    const restoreResponse = await admin.post(`/api/intake/forms/${TEST_FIXTURE_IDS.FORM_1}/restore`).send({});
    assert.equal(restoreResponse.status, 200);
    assert.equal(restoreResponse.body.lifecycleState, 'active');
});
