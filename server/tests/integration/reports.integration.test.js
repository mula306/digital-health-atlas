import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureTestSetup } from '../helpers/testSetup.js';
import { createTestRequest, asPersona } from '../helpers/testServer.js';
import { getPool, sql } from '../../db.js';
import { invalidatePermissionCache } from '../../middleware/authMiddleware.js';
import { TEST_PERSONAS } from '../../utils/testAuthPersonas.js';

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

test('scheduler permission does not expose other users executive packs', async () => {
    const pool = await getPool();
    const packName = `Scheduler isolation ${Date.now()}`;

    try {
        await pool.request()
            .input('name', sql.NVarChar(160), packName)
            .input('ownerOid', sql.NVarChar(100), TEST_PERSONAS.admin.oid)
            .input('scopeOrgId', sql.Int, TEST_PERSONAS.admin.orgId)
            .query(`
                INSERT INTO ExecutiveReportPack (
                    name, description, ownerOid, isActive, scheduleType, scheduleDayOfWeek,
                    scheduleHour, scheduleMinute, timezone, exceptionOnly, filterJson, scopeOrgId,
                    recipientJson, nextRunAt
                )
                VALUES (
                    @name, NULL, @ownerOid, 1, 'manual', NULL,
                    9, 0, 'America/Regina', 0, '{}', @scopeOrgId,
                    '[]', NULL
                )
            `);

        await pool.request()
            .input('role', sql.NVarChar(50), 'Viewer')
            .input('permission', sql.NVarChar(100), 'can_run_exec_pack_scheduler')
            .query(`
                UPDATE RolePermissions
                SET isAllowed = 1
                WHERE role = @role AND permission = @permission
            `);
        invalidatePermissionCache();

        const viewer = asPersona(request, 'viewer');
        const runDueResponse = await viewer.post('/api/reports/scheduler/run-due').send({ maxRuns: 1 });
        assert.equal(runDueResponse.status, 200);

        const packsResponse = await viewer.get('/api/reports/packs');
        assert.equal(packsResponse.status, 200);
        assert.equal(
            packsResponse.body.some((pack) => pack.name === packName),
            false,
            'viewer should not see admin-owned packs just because scheduler permission is granted'
        );
    } finally {
        await pool.request()
            .input('name', sql.NVarChar(160), packName)
            .query('DELETE FROM ExecutiveReportPack WHERE name = @name');

        await pool.request()
            .input('role', sql.NVarChar(50), 'Viewer')
            .input('permission', sql.NVarChar(100), 'can_run_exec_pack_scheduler')
            .query(`
                UPDATE RolePermissions
                SET isAllowed = 0
                WHERE role = @role AND permission = @permission
            `);
        invalidatePermissionCache();
    }
});
