import { test, expect } from '@playwright/test';

test('my work hub loads and deep-links into intake request', async ({ page }) => {
    await page.goto('/?view=my-work');

    await expect(page.getByRole('heading', { name: 'My Work Hub' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'My Intake Requests' })).toBeVisible();

    const intakePanel = page.locator('.my-work-panel').filter({ hasText: 'My Intake Requests' });
    const requestItems = intakePanel.locator('.my-work-list-item');
    if (await requestItems.count()) {
        await requestItems.first().click();
    } else {
        await intakePanel.getByRole('button', { name: 'Open Intake' }).click();
    }

    await expect(page).toHaveURL(/view=intake/);
    await expect(page).toHaveURL(/stage=my-requests/);
    await expect(page.getByRole('button', { name: /My Requests/i })).toBeVisible();
});

test('intake governance stage is directly routable with query params', async ({ page }) => {
    await page.goto('/?view=intake&stage=governance');

    await expect(page).toHaveURL(/view=intake/);
    await expect(page).toHaveURL(/stage=governance/);
    await expect(page.locator('.workflow-step-card.active').filter({ hasText: 'Governance' })).toBeVisible();
    await expect(page.getByText('Governance Required')).toBeVisible();
});
