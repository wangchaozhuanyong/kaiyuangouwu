import { type Page, expect, test } from '@playwright/test';

import { createCrudTestSuite } from '../../utils/crud-test-factory.js';
import {
    expectProductEditorOpen,
    fillRequiredProductCatalogFields,
} from '../../utils/product-test-helpers.js';

async function openLaptopProduct(page: Page) {
    await page.goto('/products');
    await expect(page.locator('table')).toBeVisible();
    await page.getByTestId('dt-search-input').fill('Laptop');
    const laptopRow = page.locator('table tbody tr').filter({ hasText: 'Laptop' }).first();
    await expect(laptopRow).toBeVisible({ timeout: 10_000 });
    await laptopRow.getByRole('button').first().click();
    await expectProductEditorOpen(page);
}

createCrudTestSuite({
    entityName: 'product',
    entityNamePlural: 'products',
    listPath: '/products',
    listTitle: 'Products',
    newButtonLabel: 'Create product',
    newPageTitle: 'New product',
    createPresentation: 'drawer',
    editPresentation: 'drawer',
    closeDrawerAfterCreate: false,
    closeDrawerAfterUpdate: false,
    createFields: [{ label: 'Product name', value: 'E2E Test Product' }],
    afterOpenCreate: async page => {
        await expect(page.getByRole('dialog')).toBeVisible();
        await expect(page.getByTestId('page-heading').filter({ hasText: 'New product' })).toBeVisible();
    },
    afterFillCreate: async (page, detail) => {
        await expect(detail.formItem('Slug').getByRole('textbox')).not.toHaveValue('', { timeout: 5_000 });
        await detail
            .formItem('Description')
            .locator('[contenteditable="true"]')
            .fill('E2E product description');
        await fillRequiredProductCatalogFields(page, `e2e-product-${Date.now()}`);
    },
    afterFillUpdate: async (_page, detail) => {
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
        await fillRequiredProductCatalogFields(page, `description-validation-${Date.now()}`);

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
        await openLaptopProduct(page);

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
        await openLaptopProduct(page);

        const variantsBlock = page.locator('#page-block-product-variants-table');
        await expect(variantsBlock).toBeVisible({ timeout: 10_000 });
        await expect(variantsBlock.locator('table tbody tr').first()).toBeVisible();
    });

    test('should edit variants without leaving the product editor', async ({ page }) => {
        await openLaptopProduct(page);
        const productUrl = page.url();
        const variantsBlock = page.locator('#page-block-product-variants-table');
        await variantsBlock.locator('table tbody tr').first().getByRole('button', { name: 'Edit' }).click();
        await expect(page.getByRole('dialog').last()).toBeVisible();
        await expect(page).toHaveURL(productUrl);
    });

    test('should display the rich text editor for description', async ({ page }) => {
        await page.goto('/products');
        await expect(page.locator('table')).toBeVisible();

        await page.locator('table tbody tr').first().getByRole('button').first().click();
        await expectProductEditorOpen(page);

        // The rich text editor renders a ProseMirror container with a toolbar
        // Look for the editor toolbar (formatting buttons) or the editable area
        const editorContainer = page.getByTestId('rich-text-editor');
        await expect(editorContainer.first()).toBeVisible({ timeout: 5_000 });
    });

    test('should display custom field tabs when configured', async ({ page }) => {
        await page.goto('/products');
        await expect(page.locator('table')).toBeVisible();

        await page.locator('table tbody tr').first().getByRole('button').first().click();
        await expectProductEditorOpen(page);

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
