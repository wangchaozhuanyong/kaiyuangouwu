import { expect, type Page, test } from '@playwright/test';

// Global Settings is a single detail page (not a list) with:
// - Available languages (LanguageSelector)
// - Global out of stock threshold (NumberInput)
// - Track inventory by default (Switch)

async function submitGlobalSettings(page: Page) {
    const updateButton = page.getByRole('button', { name: 'Update' });
    const updateResponse = page.waitForResponse(
        response =>
            response.url().includes('/admin-api') &&
            response.status() === 200 &&
            (response.request().postData() ?? '').includes('UpdateGlobalSettings'),
    );
    await updateButton.click();
    await updateResponse;
    await expect(updateButton).toBeDisabled({ timeout: 10_000 });
}

test.describe('Global Settings', () => {
    // These tests update the same singleton. Running them concurrently can let one test restore
    // a value while another is still verifying its own update.
    test.describe.configure({ mode: 'serial' });

    test('should display the global settings page', async ({ page }) => {
        await page.goto('/global-settings');
        await expect(page.getByTestId('page-heading')).toBeVisible({
            timeout: 10_000,
        });
    });

    test('should show the settings form fields', async ({ page }) => {
        await page.goto('/global-settings');
        await expect(page.getByTestId('page-heading')).toBeVisible({
            timeout: 10_000,
        });
        await expect(page.getByText('Available languages')).toBeVisible();
        await expect(page.getByText('Global out of stock threshold')).toBeVisible();
        await expect(page.getByText('Track inventory by default')).toBeVisible();
    });

    test('should have an Update button', async ({ page }) => {
        await page.goto('/global-settings');
        await expect(page.getByTestId('page-heading')).toBeVisible({ timeout: 10_000 });
        await expect(page.getByRole('button', { name: 'Update' })).toBeVisible();
    });

    test('should update out of stock threshold and persist', async ({ page }) => {
        await page.goto('/global-settings');
        await expect(page.getByTestId('page-heading')).toBeVisible({
            timeout: 10_000,
        });

        // Find the threshold input via its label
        const thresholdField = page.locator('[data-slot="field"]').filter({
            has: page
                .locator('[data-slot="field-label"]')
                .getByText('Global out of stock threshold', { exact: true }),
        });
        const thresholdInput = thresholdField.getByRole('spinbutton');
        await expect(thresholdInput).toBeVisible();

        // Store original value
        const originalValue = await thresholdInput.inputValue();

        // Set a new value
        const newValue = originalValue === '-5' ? '-10' : '-5';
        await thresholdInput.fill(newValue);

        await submitGlobalSettings(page);

        // Reload and verify persistence
        await page.reload();
        await expect(page.getByTestId('page-heading')).toBeVisible({
            timeout: 10_000,
        });

        const reloadedField = page.locator('[data-slot="field"]').filter({
            has: page
                .locator('[data-slot="field-label"]')
                .getByText('Global out of stock threshold', { exact: true }),
        });
        await expect(reloadedField.getByRole('spinbutton')).toHaveValue(newValue, { timeout: 10_000 });

        // Reset to original value
        await reloadedField.getByRole('spinbutton').fill(originalValue);
        await submitGlobalSettings(page);
    });

    test('should toggle track inventory and persist', async ({ page }) => {
        await page.goto('/global-settings');
        await expect(page.getByTestId('page-heading')).toBeVisible({
            timeout: 10_000,
        });
        // Wait for form data to fully load: Update button disabled = form is clean with server data
        await page.waitForLoadState('networkidle');
        await expect(page.getByRole('button', { name: 'Update' })).toBeDisabled({ timeout: 10_000 });

        // Find the track inventory switch via its label
        const trackField = page.locator('[data-slot="field"]').filter({
            has: page
                .locator('[data-slot="field-label"]')
                .getByText('Track inventory by default', { exact: true }),
        });
        const trackSwitch = trackField.getByRole('switch');
        await expect(trackSwitch).toBeVisible();

        // Store original state
        const wasChecked = await trackSwitch.isChecked();

        // Toggle the switch
        await trackSwitch.click();

        await submitGlobalSettings(page);

        // Reload and verify persistence
        await page.reload();
        await expect(page.getByTestId('page-heading')).toBeVisible({
            timeout: 10_000,
        });
        await page.waitForLoadState('networkidle');
        await expect(page.getByRole('button', { name: 'Update' })).toBeDisabled({ timeout: 10_000 });

        const reloadedField = page.locator('[data-slot="field"]').filter({
            has: page
                .locator('[data-slot="field-label"]')
                .getByText('Track inventory by default', { exact: true }),
        });
        const reloadedSwitch = reloadedField.getByRole('switch');
        if (wasChecked) {
            await expect(reloadedSwitch).not.toBeChecked();
        } else {
            await expect(reloadedSwitch).toBeChecked();
        }

        // Reset to original state
        await reloadedSwitch.click();
        await submitGlobalSettings(page);
    });
});
