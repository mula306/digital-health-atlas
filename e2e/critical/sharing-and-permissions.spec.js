import { test, expect } from '@playwright/test';
import { apiHeaders, apiUrl, setMockPersona, TEST_FIXTURE_IDS } from '../fixtures/mockAuth.js';

test('cross-org recipients can see shared project and linked goal context', async ({ page, request }) => {
    const shareResponse = await request.post(apiUrl('/api/admin/projects/bulk-share'), {
        headers: apiHeaders('admin'),
        data: {
            projectIds: [TEST_FIXTURE_IDS.PROJECT_1],
            orgId: TEST_FIXTURE_IDS.ORG_2,
            accessLevel: 'read'
        }
    });

    expect(shareResponse.ok()).toBeTruthy();
    const sharePayload = await shareResponse.json();
    expect(Number(sharePayload.linkedGoalCount || 0)).toBeGreaterThan(0);

    await setMockPersona(page, 'org2_editor');

    await page.goto('/?view=projects');
    await expect(page.getByText('Test Project Org1')).toBeVisible();

    await page.goto('/?view=goals');
    await expect(page.getByRole('heading', { name: 'Test Goal Org1' })).toBeVisible();
});

test('read-only shared recipients do not get write controls and are blocked from writes', async ({ page, request }) => {
    const shareResponse = await request.post(apiUrl('/api/admin/projects/bulk-share'), {
        headers: apiHeaders('admin'),
        data: {
            projectIds: [TEST_FIXTURE_IDS.PROJECT_1],
            orgId: TEST_FIXTURE_IDS.ORG_2,
            accessLevel: 'read'
        }
    });

    expect(shareResponse.ok()).toBeTruthy();

    await setMockPersona(page, 'org2_editor');

    await page.goto('/?view=projects');
    await page.getByText('Test Project Org1').click();

    await expect(page.getByText('Read-only shared access')).toBeVisible();
    await expect(page.getByTitle('Edit Project')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'New Task' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Admin Panel' })).toHaveCount(0);

    const updateResponse = await request.put(apiUrl(`/api/projects/${TEST_FIXTURE_IDS.PROJECT_1}`), {
        headers: apiHeaders('org2_editor', { 'content-type': 'application/json' }),
        data: {
            title: 'Unauthorized update attempt',
            description: 'This should stay blocked',
            status: 'active',
            goalIds: [TEST_FIXTURE_IDS.GOAL_1]
        }
    });

    expect(updateResponse.status()).toBe(403);
    const updatePayload = await updateResponse.json();
    expect(String(updatePayload.error || '')).toMatch(/read-only|write/i);

    await page.goto('/?view=admin');
    await expect(page).not.toHaveURL(/view=admin/);
    await expect(page.getByText('System Administration')).toHaveCount(0);
});
