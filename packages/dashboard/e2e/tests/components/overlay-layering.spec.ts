import { expect, test, type Locator, type Page } from '@playwright/test';

const TEST_PAGE = '/overlay-layering-test';

async function expectFloatingLayerAboveModal(page: Page, content: Locator) {
    const floatingZIndexes = await content.evaluate(element => {
        const portal = element.parentElement?.parentElement;
        return Array.from(portal?.children ?? [])
            .filter(child => child.getAttribute('role') === 'presentation')
            .map(child => Number.parseInt(getComputedStyle(child).zIndex, 10));
    });
    const modalZIndex = await page
        .locator('[data-slot="dialog-content"]')
        .evaluate(element => Number.parseInt(getComputedStyle(element).zIndex, 10));

    expect(floatingZIndexes.length).toBeGreaterThan(0);
    expect(floatingZIndexes.every(zIndex => zIndex > modalZIndex)).toBe(true);
}

test.describe('floating controls inside modal layers', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(TEST_PAGE);
        await page.getByRole('button', { name: 'Open layering dialog' }).click();
        await expect(page.getByRole('dialog', { name: 'Layering dialog' })).toBeVisible();
    });

    test('popover stays visible and interactive above the dialog', async ({ page }) => {
        await page.getByRole('button', { name: 'Open test popover' }).click();
        const content = page.locator('[data-slot="popover-content"]');

        await expect(content).toBeVisible();
        await expectFloatingLayerAboveModal(page, content);
        await content.getByRole('button', { name: 'Choose popover option' }).click();
        await expect(page.getByTestId('overlay-last-action')).toHaveText('Popover selected');
    });

    test('select stays visible and interactive above the dialog', async ({ page }) => {
        await page.getByRole('dialog', { name: 'Layering dialog' }).getByRole('combobox').click();
        const content = page.locator('[data-slot="select-content"]');

        await expect(content).toBeVisible();
        await expectFloatingLayerAboveModal(page, content);
        await page.getByRole('option', { name: 'Choose select option' }).click();
        await expect(page.getByTestId('overlay-last-action')).toHaveText('Select selected');
    });

    test('dropdown menu stays visible and interactive above the dialog', async ({ page }) => {
        await page.getByRole('button', { name: 'Open test menu' }).click();
        const content = page.locator('[data-slot="dropdown-menu-content"]');

        await expect(content).toBeVisible();
        await expectFloatingLayerAboveModal(page, content);
        await page.getByRole('menuitem', { name: 'Choose menu option' }).click();
        await expect(page.getByTestId('overlay-last-action')).toHaveText('Menu selected');
    });

    test('a background menu does not cover a dialog opened from that menu', async ({ page }) => {
        await page.locator('[data-slot="dialog-close"]').click();
        await page.getByRole('button', { name: 'Open dialog menu' }).click();
        await page.getByRole('menuitem', { name: 'Open dialog while menu stays mounted' }).click();

        const dialog = page.getByRole('dialog', { name: 'Layering dialog' });
        const backgroundMenu = page
            .locator('[data-slot="dropdown-menu-content"]')
            .filter({ hasText: 'Open dialog while menu stays mounted' });

        await expect(dialog).toBeVisible();
        await expect(backgroundMenu).toBeAttached();

        const modalZIndex = await dialog.evaluate(element =>
            Number.parseInt(getComputedStyle(element).zIndex, 10),
        );
        const backgroundLayerZIndexes = await backgroundMenu.evaluate(element => {
            const portal = element.parentElement?.parentElement;
            return Array.from(portal?.children ?? [])
                .filter(child => child.getAttribute('role') === 'presentation')
                .map(child => Number.parseInt(getComputedStyle(child).zIndex, 10));
        });

        expect(backgroundLayerZIndexes.length).toBeGreaterThan(0);
        expect(backgroundLayerZIndexes.every(zIndex => zIndex < modalZIndex)).toBe(true);

        const backgroundMenuCoversDialog = await backgroundMenu.evaluate(element => {
            const rect = element.getBoundingClientRect();
            const hitTarget = document.elementFromPoint(
                rect.left + rect.width / 2,
                rect.top + rect.height / 2,
            );
            return hitTarget ? element.contains(hitTarget) : false;
        });

        expect(backgroundMenuCoversDialog).toBe(false);

        await dialog.getByRole('combobox').click();
        const nestedSelect = page.locator('[data-slot="select-content"]');

        await expect(nestedSelect).toBeVisible();
        await expectFloatingLayerAboveModal(page, nestedSelect);
        await page.getByRole('option', { name: 'Choose select option' }).click();
        await expect(page.getByTestId('overlay-last-action')).toHaveText('Select selected');
    });

    test('a result dialog opens from a horizontally scrolled table on a narrow viewport', async ({
        page,
    }) => {
        await page.locator('[data-slot="dialog-close"]').click();
        await page.setViewportSize({ width: 332, height: 640 });

        const scrollContainer = page.getByTestId('result-table-scroll-container');
        await scrollContainer.evaluate(element => {
            element.scrollLeft = element.scrollWidth;
        });
        await scrollContainer.getByRole('button', { name: 'View result' }).click();

        const dialog = page.getByRole('dialog', { name: 'Layering dialog' });
        await expect(dialog).toBeVisible();
        await expect(dialog).toBeInViewport();
    });
});
