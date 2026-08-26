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

    test('a responsive width override expands on desktop and stays inside a narrow viewport', async ({
        page,
    }) => {
        const setStableViewport = async (width: number, height: number) => {
            await page.setViewportSize({ width, height });
            await page.waitForFunction(expectedWidth => window.innerWidth === expectedWidth, width);
            await page.waitForTimeout(150);
        };

        await page.locator('[data-slot="dialog-close"]').click();
        await setStableViewport(1440, 900);
        await page.getByRole('button', { name: 'Open wide dialog' }).click();

        const wideDialog = page.getByRole('dialog', { name: 'Wide dialog' });
        await expect(wideDialog).toBeVisible();
        await expect(wideDialog).toBeInViewport();
        await page.waitForTimeout(150);

        const desktopBox = await wideDialog.boundingBox();
        expect(desktopBox).not.toBeNull();
        expect(desktopBox?.width).toBeGreaterThan(1100);
        expect(desktopBox?.width).toBeLessThanOrEqual(1181);

        const formPane = page.getByTestId('wide-dialog-form-pane');
        const previewPane = page.getByTestId('wide-dialog-preview-pane');
        const footer = page.getByTestId('wide-dialog-footer');
        const desktopFormBox = await formPane.boundingBox();
        const desktopPreviewBox = await previewPane.boundingBox();
        expect(desktopFormBox).not.toBeNull();
        expect(desktopPreviewBox).not.toBeNull();
        expect(Math.abs((desktopFormBox?.y ?? 0) - (desktopPreviewBox?.y ?? 0))).toBeLessThan(6);
        await expect(footer).toBeInViewport();

        await setStableViewport(1024, 768);
        await expect
            .poll(async () => {
                const box = await wideDialog.boundingBox();
                return box
                    ? {
                          isWide: box.width > 980,
                          leftEdgeIsInViewport: box.x >= 15,
                          rightEdgeIsInViewport: box.x + box.width <= 1009,
                      }
                    : null;
            })
            .toEqual({
                isWide: true,
                leftEdgeIsInViewport: true,
                rightEdgeIsInViewport: true,
            });
        const landscapeFormBox = await formPane.boundingBox();
        const landscapePreviewBox = await previewPane.boundingBox();
        expect(Math.abs((landscapeFormBox?.y ?? 0) - (landscapePreviewBox?.y ?? 0))).toBeLessThan(6);
        await expect(footer).toBeInViewport();

        await setStableViewport(768, 1024);
        const tabletPortraitBox = await wideDialog.boundingBox();
        expect(tabletPortraitBox).not.toBeNull();
        expect(tabletPortraitBox?.width).toBeGreaterThan(735);
        expect(tabletPortraitBox?.width).toBeLessThanOrEqual(738);
        const portraitFormBox = await formPane.boundingBox();
        const portraitPreviewBox = await previewPane.boundingBox();
        expect(portraitPreviewBox?.y ?? 0).toBeGreaterThan(
            (portraitFormBox?.y ?? 0) + (portraitFormBox?.height ?? 0) - 1,
        );
        await expect(footer).toBeInViewport();

        await setStableViewport(375, 812);
        await expect(wideDialog).toBeInViewport();

        const mobileBox = await wideDialog.boundingBox();
        expect(mobileBox).not.toBeNull();
        expect(mobileBox?.width).toBeLessThanOrEqual(343);
        await expect(footer).toBeInViewport();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
            true,
        );

        // A 720 × 450 CSS viewport is equivalent to viewing 1440 × 900 at 200% browser zoom.
        await setStableViewport(720, 450);
        await expect(wideDialog).toBeInViewport();
        await expect(footer).toBeInViewport();
        const zoomedFormBox = await formPane.boundingBox();
        const zoomedPreviewBox = await previewPane.boundingBox();
        expect(zoomedPreviewBox?.y ?? 0).toBeGreaterThan(
            (zoomedFormBox?.y ?? 0) + (zoomedFormBox?.height ?? 0) - 1,
        );
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
            true,
        );
    });
});
