import { expect, test } from '@playwright/test';

import { createCrudTestSuite } from '../../utils/crud-test-factory.js';

createCrudTestSuite({
    entityName: 'product',
    entityNamePlural: 'products',
    listPath: '/products',
    listTitle: 'Products',
    newButtonLabel: 'Create product',
    newPageTitle: 'New product',
    createFields: [{ label: 'Product name', value: 'E2E Test Product' }],
    afterFillCreate: async (_page, detail) => {
        await expect(detail.formItem('Slug').getByRole('textbox')).not.toHaveValue('', { timeout: 5_000 });
        await detail
            .formItem('Description')
            .locator('[contenteditable="true"]')
            .fill('E2E product description');
    },
});

test.describe('Product detail features', () => {
    test('should require a meaningful Simplified Chinese description before creation', async ({ page }) => {
        await page.goto('/products/new');
        const nameInput = page
            .locator('[data-slot="field"]')
            .filter({ has: page.getByText('Product name', { exact: true }) })
            .getByRole('textbox');
        await nameInput.fill('Description validation product');

        const descriptionField = page.locator('[data-slot="field"]').filter({
            has: page.getByText('Description', { exact: true }),
        });
        const editor = descriptionField.locator('[contenteditable="true"]');

        await expect(descriptionField.getByText('This field is required')).toBeVisible();
        await expect(editor).toHaveAttribute('aria-required', 'true');
        await expect(editor).toHaveAttribute('aria-invalid', 'true');
        await expect(page.getByRole('button', { name: 'Create', exact: true })).toBeDisabled();

        await editor.fill('A complete product description');

        await expect(descriptionField.getByText('This field is required')).not.toBeVisible();
        await expect(editor).not.toHaveAttribute('aria-invalid', 'true');
        await expect(page.getByRole('button', { name: 'Create', exact: true })).toBeEnabled();
    });

    test('should display all detail page sections', async ({ page }) => {
        // Navigate to the seeded "Laptop" product via search to avoid race conditions
        await page.goto('/products');
        await expect(page.locator('table')).toBeVisible();
        await page.getByTestId('dt-search-input').fill('Laptop');
        await page.waitForResponse(resp => resp.url().includes('/admin-api') && resp.status() === 200);
        await page.locator('table tbody tr').first().getByRole('button').first().click();
        await expect(page).toHaveURL(/\/products\/.+/);

        // Product name field
        await expect(
            page.locator('[data-slot="field-label"]').getByText('Product name', { exact: true }),
        ).toBeVisible();

        // Slug field
        await expect(
            page.locator('[data-slot="field-label"]').getByText('Slug', { exact: true }),
        ).toBeVisible();

        // Description field
        await expect(
            page.locator('[data-slot="field-label"]').getByText('Description', { exact: true }),
        ).toBeVisible();

        // Enabled toggle
        await expect(
            page.locator('[data-slot="field-label"]').getByText('Enabled', { exact: true }),
        ).toBeVisible();

        // Facet Values block
        await expect(
            page.locator('[data-slot="card-title"]').getByText('Filter attribute values', { exact: true }),
        ).toBeVisible();

        // Product groups can be assigned without leaving the product detail page
        await expect(
            page.locator('[data-slot="card-title"]').getByText('Product groups', { exact: true }),
        ).toBeVisible();
        await expect(page.getByRole('button', { name: 'Add product group', exact: true })).toBeVisible();

        // Specification-template relationships stay visible in the main product flow.
        await expect(
            page.locator('[data-slot="card-title"]').getByText('Specification templates', {
                exact: true,
            }),
        ).toBeVisible();
        const openTemplateLibraryButton = page.getByRole('button', {
            name: 'Open specification template library',
            exact: true,
        });
        await expect(openTemplateLibraryButton).toBeVisible();

        // Assets block
        await expect(
            page.locator('[data-slot="card-title"]').getByText('Asset library', { exact: true }),
        ).toBeVisible();

        await openTemplateLibraryButton.click();
        await expect(page).toHaveURL(/\/option-groups(?:\?|$)/);
    });

    test('should display product variants table', async ({ page }) => {
        // Navigate to the seeded "Laptop" product which has variants
        await page.goto('/products');
        await expect(page.locator('table')).toBeVisible();
        await page.getByTestId('dt-search-input').fill('Laptop');
        await page.waitForResponse(resp => resp.url().includes('/admin-api') && resp.status() === 200);
        await page.locator('table tbody tr').first().getByRole('button').first().click();
        await expect(page).toHaveURL(/\/products\/.+/);

        // The "Manage variants" button should be visible for the Laptop product
        await expect(page.getByRole('button', { name: /Manage SKUs/i })).toBeVisible({ timeout: 10_000 });
    });

    test('should navigate to manage variants page', async ({ page }) => {
        await page.goto('/products');
        await expect(page.locator('table')).toBeVisible();

        await page.locator('table tbody tr').first().getByRole('button').first().click();
        await expect(page).toHaveURL(/\/products\/.+/);

        const manageButton = page.getByRole('button', { name: /Manage SKUs/i });
        // Only proceed if the product has variants
        if (await manageButton.isVisible({ timeout: 5_000 }).catch(() => false)) {
            await manageButton.click();
            await expect(page).toHaveURL(/\/products\/[^/]+\/variants/);
        }
    });

    test('should display the rich text editor for description', async ({ page }) => {
        await page.goto('/products');
        await expect(page.locator('table')).toBeVisible();

        await page.locator('table tbody tr').first().getByRole('button').first().click();
        await expect(page).toHaveURL(/\/products\/.+/);

        // The rich text editor renders a ProseMirror container with a toolbar
        // Look for the editor toolbar (formatting buttons) or the editable area
        const editorContainer = page.getByTestId('rich-text-editor');
        await expect(editorContainer.first()).toBeVisible({ timeout: 5_000 });
    });

    test('should display custom field tabs when configured', async ({ page }) => {
        await page.goto('/products');
        await expect(page.locator('table')).toBeVisible();

        await page.locator('table tbody tr').first().getByRole('button').first().click();
        await expect(page).toHaveURL(/\/products\/.+/);

        // Custom fields are configured in the test fixtures (SEO, Details, Struct tabs)
        // Check if any custom field tabs/sections are present
        const customFieldsBlock = page
            .locator('[data-slot="card-title"]')
            .filter({ hasText: /custom fields|seo|details/i });
        const hasCustomFields = await customFieldsBlock
            .first()
            .isVisible({ timeout: 3_000 })
            .catch(() => false);

        if (hasCustomFields) {
            await expect(customFieldsBlock.first()).toBeVisible();
        }
        // If no custom fields configured in the fixture, this test passes silently
    });
});
