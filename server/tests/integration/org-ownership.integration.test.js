import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureTestSetup } from '../helpers/testSetup.js';
import { createTestRequest, asPersona } from '../helpers/testServer.js';
import { TEST_FIXTURE_IDS } from '../fixtures/seed_test_dataset.js';
import { getPool, sql } from '../../db.js';

await ensureTestSetup();
const request = createTestRequest();

const resetSubmissionConversionState = async (submissionId) => {
    const pool = await getPool();
    const existing = await pool.request()
        .input('submissionId', sql.Int, submissionId)
        .query('SELECT convertedProjectId FROM IntakeSubmissions WHERE id = @submissionId');

    const convertedProjectId = Number.parseInt(existing.recordset[0]?.convertedProjectId, 10);

    await pool.request()
        .input('submissionId', sql.Int, submissionId)
        .input('goalId', sql.Int, TEST_FIXTURE_IDS.GOAL_2)
        .input('orgId', sql.Int, TEST_FIXTURE_IDS.ORG_1)
        .query(`
            UPDATE IntakeSubmissions
            SET
                status = 'pending',
                convertedProjectId = NULL,
                governanceRequired = 0,
                governanceStatus = 'not-started',
                governanceDecision = NULL,
                governanceReason = NULL,
                orgId = ${TEST_FIXTURE_IDS.ORG_1}
            WHERE id = @submissionId;

            DELETE FROM GoalOrgAccess
            WHERE goalId = @goalId
              AND orgId = @orgId;
        `);

    if (Number.isFinite(convertedProjectId) && ![TEST_FIXTURE_IDS.PROJECT_1, TEST_FIXTURE_IDS.PROJECT_2].includes(convertedProjectId)) {
        await pool.request()
            .input('projectId', sql.Int, convertedProjectId)
            .query(`
                DELETE FROM ProjectOrgAccess WHERE projectId = @projectId;
                DELETE FROM ProjectGoals WHERE projectId = @projectId;
                DELETE FROM Tasks WHERE projectId = @projectId;
                DELETE FROM ProjectWatchers WHERE projectId = @projectId;
                DELETE FROM Projects WHERE id = @projectId;
            `);
    }
};

const resetProjectOwnershipState = async () => {
    const pool = await getPool();
    await pool.request()
        .input('projectId', sql.Int, TEST_FIXTURE_IDS.PROJECT_1)
        .input('ownerOrgId', sql.Int, TEST_FIXTURE_IDS.ORG_1)
        .input('sharedOrgId', sql.Int, TEST_FIXTURE_IDS.ORG_2)
        .input('goalId', sql.Int, TEST_FIXTURE_IDS.GOAL_1)
        .input('grantedByOid', sql.NVarChar(100), 'test-admin-oid')
        .query(`
            UPDATE Projects
            SET
                title = 'Test Project Org1',
                description = 'Deterministic fixture project for org1',
                status = 'active',
                goalId = @goalId,
                orgId = @ownerOrgId
            WHERE id = @projectId;

            DELETE FROM ProjectGoals WHERE projectId = @projectId;
            INSERT INTO ProjectGoals (projectId, goalId)
            SELECT @projectId, @goalId
            WHERE NOT EXISTS (
                SELECT 1
                FROM ProjectGoals
                WHERE projectId = @projectId AND goalId = @goalId
            );

            DELETE FROM ProjectOrgAccess WHERE projectId = @projectId;
            INSERT INTO ProjectOrgAccess (projectId, orgId, accessLevel, expiresAt, grantedByOid)
            VALUES (@projectId, @sharedOrgId, 'read', DATEADD(day, 7, GETDATE()), @grantedByOid);

            DELETE FROM GoalOrgAccess
            WHERE goalId = @goalId
              AND orgId = @sharedOrgId;
        `);
};

test('admin-created org-bound records require explicit orgId', async () => {
    const admin = asPersona(request, 'admin');

    const projectResponse = await admin.post('/api/projects').send({
        title: 'Admin project without org'
    });
    assert.equal(projectResponse.status, 400);
    assert.match(String(projectResponse.body?.error || ''), /orgid/i);

    const goalResponse = await admin.post('/api/goals').send({
        title: 'Admin goal without org',
        type: 'enterprise'
    });
    assert.equal(goalResponse.status, 400);
    assert.match(String(goalResponse.body?.error || ''), /orgid/i);

    const formResponse = await admin.post('/api/intake/forms').send({
        name: 'Admin form without org',
        description: 'Should fail',
        fields: []
    });
    assert.equal(formResponse.status, 400);
    assert.match(String(formResponse.body?.error || ''), /orgid/i);

    const boardResponse = await admin.post('/api/governance/boards').send({
        name: 'Admin board without org'
    });
    assert.equal(boardResponse.status, 400);
    assert.match(String(boardResponse.body?.error || ''), /orgid/i);
});

test('cross-org governance conversion keeps submission org ownership and auto-shares external goal context', async () => {
    await resetSubmissionConversionState(TEST_FIXTURE_IDS.SUBMISSION_2);

    const org2Manager = asPersona(request, 'org2_intake_manager');
    const conversionResponse = await org2Manager
        .post(`/api/intake/submissions/${TEST_FIXTURE_IDS.SUBMISSION_2}/convert`)
        .send({
            projectData: {
                title: 'Converted by org2 manager',
                goalId: TEST_FIXTURE_IDS.GOAL_2
            },
            conversionContext: 'Integration test conversion context',
            kickoffTasks: [
                {
                    title: 'Launch kickoff'
                }
            ]
        });

    assert.equal(conversionResponse.status, 200);
    assert.equal(conversionResponse.body.success, true);
    assert.equal(String(conversionResponse.body.project?.orgId), String(TEST_FIXTURE_IDS.ORG_1));
    assert.equal(String(conversionResponse.body.project?.goalId), String(TEST_FIXTURE_IDS.GOAL_2));
    assert.equal(Number(conversionResponse.body.seededTaskCount), 1);

    const projectId = Number.parseInt(conversionResponse.body.projectId, 10);
    assert.ok(Number.isFinite(projectId));

    const pool = await getPool();
    const submissionResult = await pool.request()
        .input('submissionId', sql.Int, TEST_FIXTURE_IDS.SUBMISSION_2)
        .query(`
            SELECT status, convertedProjectId, orgId
            FROM IntakeSubmissions
            WHERE id = @submissionId
        `);

    assert.equal(String(submissionResult.recordset[0]?.status), 'approved');
    assert.equal(Number(submissionResult.recordset[0]?.convertedProjectId), projectId);
    assert.equal(Number(submissionResult.recordset[0]?.orgId), TEST_FIXTURE_IDS.ORG_1);

    const projectResult = await pool.request()
        .input('projectId', sql.Int, projectId)
        .query('SELECT id, orgId FROM Projects WHERE id = @projectId');
    assert.equal(Number(projectResult.recordset[0]?.orgId), TEST_FIXTURE_IDS.ORG_1);

    const goalShareResult = await pool.request()
        .input('goalId', sql.Int, TEST_FIXTURE_IDS.GOAL_2)
        .input('orgId', sql.Int, TEST_FIXTURE_IDS.ORG_1)
        .query(`
            SELECT TOP 1 accessLevel
            FROM GoalOrgAccess
            WHERE goalId = @goalId
              AND orgId = @orgId
        `);
    assert.equal(String(goalShareResult.recordset[0]?.accessLevel), 'read');

    await resetSubmissionConversionState(TEST_FIXTURE_IDS.SUBMISSION_2);
});

test('admin can transfer project ownership to another organization and redundant owner shares are removed', async () => {
    await resetProjectOwnershipState();
    const admin = asPersona(request, 'admin');

    const updateResponse = await admin
        .put(`/api/projects/${TEST_FIXTURE_IDS.PROJECT_1}`)
        .send({
            title: 'Transferred Project Ownership',
            description: 'Ownership moved to org 2',
            status: 'active',
            orgId: TEST_FIXTURE_IDS.ORG_2,
            goalIds: [TEST_FIXTURE_IDS.GOAL_1]
        });

    assert.equal(updateResponse.status, 200);
    assert.equal(updateResponse.body.success, true);

    const pool = await getPool();
    const projectResult = await pool.request()
        .input('projectId', sql.Int, TEST_FIXTURE_IDS.PROJECT_1)
        .query('SELECT orgId FROM Projects WHERE id = @projectId');
    assert.equal(Number(projectResult.recordset[0]?.orgId), TEST_FIXTURE_IDS.ORG_2);

    const redundantShareResult = await pool.request()
        .input('projectId', sql.Int, TEST_FIXTURE_IDS.PROJECT_1)
        .input('orgId', sql.Int, TEST_FIXTURE_IDS.ORG_2)
        .query('SELECT COUNT(*) AS count FROM ProjectOrgAccess WHERE projectId = @projectId AND orgId = @orgId');
    assert.equal(Number(redundantShareResult.recordset[0]?.count), 0);

    const goalShareResult = await pool.request()
        .input('goalId', sql.Int, TEST_FIXTURE_IDS.GOAL_1)
        .input('orgId', sql.Int, TEST_FIXTURE_IDS.ORG_2)
        .query(`
            SELECT TOP 1 accessLevel
            FROM GoalOrgAccess
            WHERE goalId = @goalId
              AND orgId = @orgId
        `);
    assert.equal(String(goalShareResult.recordset[0]?.accessLevel), 'read');

    await resetProjectOwnershipState();
});
