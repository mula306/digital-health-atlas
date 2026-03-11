import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureTestSetup } from '../helpers/testSetup.js';
import { createTestRequest, asPersona } from '../helpers/testServer.js';

await ensureTestSetup();
const request = createTestRequest();

test('report viewers can read scheduler status', async () => {
    const viewer = asPersona(request, 'viewer');
    const response = await viewer.get('/api/reports/scheduler/status');
    assert.equal(response.status, 200);
    assert.equal(typeof response.body.running, 'boolean');
    assert.ok(Number.isFinite(response.body.dueCount));
});

test('users without report viewing permissions are blocked from scheduler status', async () => {
    const intakeManager = asPersona(request, 'intake_manager');
    const response = await intakeManager.get('/api/reports/scheduler/status');
    assert.equal(response.status, 403);
});

test('only scheduler-manage capable users can trigger due pack run', async () => {
    const viewer = asPersona(request, 'viewer');
    const denied = await viewer.post('/api/reports/scheduler/run-due').send({ maxRuns: 1 });
    assert.equal(denied.status, 403);

    const admin = asPersona(request, 'admin');
    const allowed = await admin.post('/api/reports/scheduler/run-due').send({ maxRuns: 1 });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.body.running, false);
    assert.ok(Array.isArray(allowed.body.results));
});
