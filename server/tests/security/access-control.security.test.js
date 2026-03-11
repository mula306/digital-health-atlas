import test from 'node:test';
import assert from 'node:assert/strict';
import supertest from 'supertest';
import { ensureTestSetup } from '../helpers/testSetup.js';
import { createTestRequest, asPersona } from '../helpers/testServer.js';
import { TEST_FIXTURE_IDS } from '../fixtures/seed_test_dataset.js';
import { createApp } from '../../app.js';

await ensureTestSetup();
const request = createTestRequest();

test('read-only shared project cannot be edited by recipient org', async () => {
    const admin = asPersona(request, 'admin');
    await admin.post('/api/admin/projects/bulk-share').send({
        projectIds: [TEST_FIXTURE_IDS.PROJECT_1],
        orgId: TEST_FIXTURE_IDS.ORG_2,
        accessLevel: 'read'
    });

    const org2Editor = asPersona(request, 'org2_editor');
    const updateAttempt = await org2Editor
        .put(`/api/projects/${TEST_FIXTURE_IDS.PROJECT_1}`)
        .send({
            title: 'Unauthorized update attempt',
            description: 'should be blocked',
            status: 'active'
        });

    assert.equal(updateAttempt.status, 403);
    assert.match(String(updateAttempt.body?.error || ''), /read-only|write/i);
});

test('validation errors do not leak stack traces', async () => {
    const admin = asPersona(request, 'admin');
    const response = await admin.post('/api/admin/projects/bulk-share').send({
        projectIds: [],
        orgId: TEST_FIXTURE_IDS.ORG_2
    });

    assert.equal(response.status, 400);
    assert.ok(typeof response.body?.error === 'string');
    assert.equal(Object.prototype.hasOwnProperty.call(response.body, 'stack'), false);
});

test('global api rate limiter returns 429 after threshold', async () => {
    const { app } = createApp({
        testAuthMode: 'mock',
        env: {
            ...process.env,
            NODE_ENV: 'test',
            TEST_AUTH_MODE: 'mock',
            API_RATE_LIMIT_WINDOW_MS: '60000',
            API_RATE_LIMIT_MAX: '2'
        }
    });
    const limitedRequest = supertest(app);

    const first = await limitedRequest.get('/api/users/me').set('x-test-user', 'viewer');
    const second = await limitedRequest.get('/api/users/me').set('x-test-user', 'viewer');
    const third = await limitedRequest.get('/api/users/me').set('x-test-user', 'viewer');

    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(third.status, 429);
    const retryAfterHeader = third.headers['retry-after'] || third.headers['x-ratelimit-reset'];
    assert.ok(retryAfterHeader !== undefined);
});
