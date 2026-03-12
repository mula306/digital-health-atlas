import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureTestSetup } from '../helpers/testSetup.js';
import { createTestRequest, asPersona } from '../helpers/testServer.js';
import { TEST_FIXTURE_IDS } from '../fixtures/seed_test_dataset.js';
import { getPool, sql } from '../../db.js';

await ensureTestSetup();
const request = createTestRequest();

const deleteGoalsByIds = async (goalIds = []) => {
    const ids = [...new Set(
        goalIds
            .map((goalId) => Number.parseInt(goalId, 10))
            .filter((goalId) => Number.isFinite(goalId))
    )].sort((a, b) => b - a);

    if (ids.length === 0) return;

    const pool = await getPool();
    for (const goalId of ids) {
        await pool.request()
            .input('goalId', sql.Int, goalId)
            .query(`
                DELETE FROM GoalOrgAccess WHERE goalId = @goalId;
                DELETE FROM KPIs WHERE goalId = @goalId;
                DELETE FROM ProjectGoals WHERE goalId = @goalId;
                DELETE FROM Goals WHERE id = @goalId;
            `);
    }
};

test('goal API only allows enterprise roots and sequential child levels', async (t) => {
    const admin = asPersona(request, 'admin');

    const invalidRoot = await admin.post('/api/goals').send({
        title: 'Invalid portfolio root',
        type: 'portfolio',
        orgId: TEST_FIXTURE_IDS.ORG_1
    });
    assert.equal(invalidRoot.status, 400);
    assert.match(String(invalidRoot.body?.error || ''), /root goals/i);

    const invalidChild = await admin.post('/api/goals').send({
        title: 'Invalid service under enterprise',
        type: 'service',
        parentId: TEST_FIXTURE_IDS.GOAL_1,
        orgId: TEST_FIXTURE_IDS.ORG_1
    });
    assert.equal(invalidChild.status, 400);
    assert.match(String(invalidChild.body?.error || ''), /enterprise/i);

    const validChild = await admin.post('/api/goals').send({
        title: 'Valid portfolio child',
        type: 'portfolio',
        parentId: TEST_FIXTURE_IDS.GOAL_1,
        orgId: TEST_FIXTURE_IDS.ORG_1
    });
    assert.equal(validChild.status, 200);
    assert.equal(String(validChild.body?.type), 'portfolio');

    t.after(async () => {
        await deleteGoalsByIds([validChild.body?.id]);
    });
});

test('team goals cannot accept children and goal updates must keep a valid cascade position', async (t) => {
    const admin = asPersona(request, 'admin');

    const portfolioResponse = await admin.post('/api/goals').send({
        title: 'Portfolio validation parent',
        type: 'portfolio',
        parentId: TEST_FIXTURE_IDS.GOAL_1,
        orgId: TEST_FIXTURE_IDS.ORG_1
    });
    assert.equal(portfolioResponse.status, 200);

    const serviceResponse = await admin.post('/api/goals').send({
        title: 'Service validation child',
        type: 'service',
        parentId: portfolioResponse.body.id,
        orgId: TEST_FIXTURE_IDS.ORG_1
    });
    assert.equal(serviceResponse.status, 200);

    const teamResponse = await admin.post('/api/goals').send({
        title: 'Team validation leaf',
        type: 'team',
        parentId: serviceResponse.body.id,
        orgId: TEST_FIXTURE_IDS.ORG_1
    });
    assert.equal(teamResponse.status, 200);

    t.after(async () => {
        await deleteGoalsByIds([
            teamResponse.body?.id,
            serviceResponse.body?.id,
            portfolioResponse.body?.id
        ]);
    });

    const invalidLeafChild = await admin.post('/api/goals').send({
        title: 'Child under team should fail',
        type: 'team',
        parentId: teamResponse.body.id,
        orgId: TEST_FIXTURE_IDS.ORG_1
    });
    assert.equal(invalidLeafChild.status, 400);
    assert.match(String(invalidLeafChild.body?.error || ''), /cannot have child goals/i);

    const invalidUpdate = await admin.put(`/api/goals/${serviceResponse.body.id}`).send({
        title: 'Invalid service retype',
        description: 'Should remain a service',
        type: 'team'
    });
    assert.equal(invalidUpdate.status, 400);
    assert.match(String(invalidUpdate.body?.error || ''), /portfolio goal/i);
});

test('database constraint rejects legacy goal taxonomy values', async () => {
    const pool = await getPool();

    await assert.rejects(
        async () => {
            await pool.request()
                .input('title', sql.NVarChar, 'Legacy goal type insert')
                .input('type', sql.NVarChar, 'org')
                .input('orgId', sql.Int, TEST_FIXTURE_IDS.ORG_1)
                .query(`
                    INSERT INTO Goals (title, type, parentId, orgId)
                    VALUES (@title, @type, NULL, @orgId)
                `);
        },
        /CK_Goals_Type/i
    );
});
