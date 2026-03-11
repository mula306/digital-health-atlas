import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const expectNoSeriousViolations = async (page) => {
    const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa'])
        .analyze();
    const serious = results.violations.filter((violation) =>
        violation.impact === 'serious' || violation.impact === 'critical'
    );
    expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);
};

test('my work page passes serious/critical a11y checks', async ({ page }) => {
    await page.goto('/?view=my-work');
    await expect(page.getByRole('heading', { name: 'My Work Hub' })).toBeVisible();
    await expectNoSeriousViolations(page);
});

test('intake governance stage renders governance filter controls', async ({ page }) => {
    await page.goto('/?view=intake&stage=governance');
    await expect(page.locator('.workflow-step-card.active').filter({ hasText: 'Governance' })).toBeVisible();
    await expect(page.locator('label').filter({ hasText: /^Board$/ })).toBeVisible();
    await expect(page.locator('label').filter({ hasText: /^Governance Status$/ })).toBeVisible();
    await expect(page.locator('label').filter({ hasText: /^Decision$/ })).toBeVisible();
});
