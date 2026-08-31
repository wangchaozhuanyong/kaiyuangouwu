import { expect, test } from '@playwright/test';

import { createCrudTestSuite } from '../../utils/crud-test-factory.js';
import { expectProductEditorOpen } from '../../utils/product-test-helpers.js';
import { VendureAdminClient } from '../../utils/vendure-admin-client.js';

createCrudTestSuite({
    entityName: 'option group',
    entityNamePlural: 'option groups',
    listPath: '/option-groups',
    listTitle: 'Option Groups',
    newButtonLabel: 'New option group',
    newPageTitle: 'New option group',
    createFields: [{ label: 'Name', value: 'E2E Test Material' }],
    afterFillCreate: async (page, detail) => {
        await page.getByText('Details and configuration', { exact: true }).click();
        // Click the "Edit slug manually" button to unlock the Code field,
        // then fill it explicitly. This avoids timing issues with the
        // SlugInput's async auto-generation via API + useEffect.
        const codeItem = detail.formItem('Code');
        await codeItem.getByRole('button', { name: 'Edit slug manually' }).click();
        await codeItem.getByRole('textbox').fill('e2e-test-material');
    },
});

test.describe('specification template product links', () => {
    test('shows linked product names in the library and opens the product', async ({ page }) => {
        const client = new VendureAdminClient(page);
        await client.login();
        const result = await client.gql(`
            query {
                products(options: { filter: { name: { eq: "Laptop" } }, take: 1 }) {
                    items {
                        id
                        name
                        optionGroups { id name }
                    }
                }
            }
        `);
        const product = result.products.items[0];
        const optionGroup = product.optionGroups[0];

        await page.goto('/option-groups');
        await expect(page.locator('table')).toBeVisible();
        await page.getByTestId('dt-search-input').fill(optionGroup.name);
        await page.waitForResponse(response => response.url().includes('/admin-api') && response.ok());

        const row = page.locator('table tbody tr').filter({ hasText: optionGroup.name }).first();
        const productLink = row.getByRole('link', { name: `Open product ${product.name}` });
        await expect(productLink).toBeVisible();
        await productLink.click();
        await expectProductEditorOpen(page, product.id);
    });
});
