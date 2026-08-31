import { expect, test } from '@playwright/test';

import { BaseDetailPage } from '../../page-objects/detail-page.base.js';
import { BaseListPage } from '../../page-objects/list-page.base.js';
import {
    expectProductEditorOpen,
    fillRequiredProductCatalogFields,
} from '../../utils/product-test-helpers.js';

test.describe('Product editor title should update after entity mutation', () => {
    test.describe.configure({ mode: 'serial' });

    const productName = 'Breadcrumb Original Name';
    const updatedName = 'Breadcrumb Updated Name';

    const listConfig = {
        path: '/products',
        title: 'Products',
        newButtonLabel: 'Create product',
    };

    const detailConfig = {
        newPath: '/products/new',
        pathPrefix: '/products/',
        newTitle: 'New product',
    };

    test('should update the editor title after renaming a product', async ({ page }) => {
        test.setTimeout(30_000);

        const listPage = new BaseListPage(page, listConfig);
        const detail = new BaseDetailPage(page, detailConfig);

        // Create a product to test with
        await detail.gotoNew();
        await detail.expectNewPageLoaded();
        await detail.fillFields([{ label: 'Product name', value: productName }]);
        await detail.fillRichText('Description', 'Product used to test breadcrumb updates');
        await expect(detail.formItem('Slug').getByRole('textbox')).not.toHaveValue('', { timeout: 5_000 });
        await fillRequiredProductCatalogFields(page, `breadcrumb-product-${Date.now()}`);
        await detail.clickCreate();
        await detail.expectSuccessToast(/created/i);
        await expectProductEditorOpen(page);

        // The list remains the route context, while the product heading identifies the open editor.
        await expect(page.getByRole('heading', { name: productName, exact: true })).toBeVisible();

        // Rename the product
        await detail.fillInput('Product name', updatedName);
        await expect(detail.formItem('Slug').getByRole('textbox')).not.toHaveValue('', { timeout: 5_000 });
        await detail.clickUpdate();
        await detail.expectSuccessToast(/updated/i);

        // The editor heading should now show the updated name without leaving the list.
        await expect(page.getByRole('heading', { name: updatedName, exact: true })).toBeVisible({
            timeout: 5_000,
        });
        await expect(page.getByRole('heading', { name: productName, exact: true })).toHaveCount(0);

        // Cleanup: delete the product via the list page
        await listPage.goto();
        await listPage.expectLoaded();
        await listPage.search(updatedName);
        await expect(listPage.getRows().first()).toBeVisible();
        await listPage.bulkDelete([0]);
        await listPage.expectSuccessToast();
    });
});
