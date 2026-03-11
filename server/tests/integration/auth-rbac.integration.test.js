import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureTestSetup } from '../helpers/testSetup.js';
import { createTestRequest, asPersona } from '../helpers/testServer.js';
import { TEST_FIXTURE_IDS } from '../fixtures/seed_test_dataset.js';

await ensureTestSetup();

const request = createTestRequest();

test('mock auth rejects requests without x-test-user', async () => {
    const response = await request.get('/api/users/me');
    assert.equal(response.status, 401);
    assert.match(String(response.body?.error || ''), /x-test-user/i);
});

test('authenticated users can fetch permission catalog rows', async () => {
    const viewer = asPersona(request, 'viewer');
    const response = await viewer.get('/api/admin/permissions');
    assert.equal(response.status, 200);
    assert.ok(Array.isArray(response.body));
    assert.ok(response.body.length > 0);
});

test('viewer cannot mutate role permissions', async () => {
    const viewer = asPersona(request, 'viewer');
    const response = await viewer.post('/api/admin/permissions/bulk').send({
        updates: [
            {
                role: 'Viewer',
                permission: 'can_view_dashboard',
                isAllowed: true
            }
        ]
    });
    assert.equal(response.status, 403);
});

test('governance queue access follows permission model', async () => {
    const member = asPersona(request, 'governance_member');
    const allowed = await member.get('/api/intake/governance-queue?page=1&limit=10');
    assert.equal(allowed.status, 200);
    assert.ok(Array.isArray(allowed.body?.items || []));
    const hasSeededSubmission = (allowed.body.items || []).some(
        (item) => Number.parseInt(item.id, 10) === TEST_FIXTURE_IDS.SUBMISSION_1
    );
    assert.equal(hasSeededSubmission, true);

    const viewer = asPersona(request, 'viewer');
    const denied = await viewer.get('/api/intake/governance-queue?page=1&limit=10');
    assert.equal(denied.status, 403);
});

test('org-scoped goals only include owned or shared goals', async () => {
    const org2Editor = asPersona(request, 'org2_editor');
    const response = await org2Editor.get('/api/goals');
    assert.equal(response.status, 200);
    assert.ok(Array.isArray(response.body));
    const goalIds = response.body.map((goal) => Number.parseInt(goal.id, 10));
    assert.ok(goalIds.includes(TEST_FIXTURE_IDS.GOAL_2));
    assert.equal(goalIds.includes(TEST_FIXTURE_IDS.GOAL_1), false);
});

