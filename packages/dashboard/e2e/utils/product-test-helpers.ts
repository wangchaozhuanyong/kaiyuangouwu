import { type Page, expect } from '@playwright/test';

/** Fill the catalog fields that are required when the product and its first SKU are created together. */
export async function fillRequiredProductCatalogFields(page: Page, sku: string) {
    const initialCatalogBlock = page.locator('#page-block-initial-catalog-variant');
    const addProductGroupButton = initialCatalogBlock.getByRole('button', {
        name: 'Add product group',
        exact: true,
    });
    await expect
        .poll(
            async () => {
                if (await addProductGroupButton.isVisible()) return 'ready';
                return (await initialCatalogBlock.count()) === 0 ? 'unavailable' : 'loading';
            },
            { timeout: 10_000 },
        )
        .not.toBe('loading');
    if ((await initialCatalogBlock.count()) === 0) return;

    await addProductGroupButton.click();
    const collectionOption = page.getByRole('checkbox', { name: /^Select / }).first();
    await expect(collectionOption).toBeVisible({ timeout: 10_000 });
    await collectionOption.click();
    await page.keyboard.press('Escape');

    const skuField = initialCatalogBlock.getByText('SKU code', { exact: true }).locator('..');
    await skuField.getByRole('textbox').fill(sku);
}

/** Wait for the in-context product editor and return the product ID stored in the list URL. */
export async function expectProductEditorOpen(page: Page, expectedProductId?: string) {
    await expect(page).toHaveURL(/\/products(?:\?|$)/);
    await expect(page.getByRole('dialog').first()).toBeVisible();
    await expect
        .poll(
            () => {
                const productId = new URL(page.url()).searchParams.get('editor');
                if (expectedProductId) return productId === expectedProductId ? productId : null;
                return productId && !['-1', 'new'].includes(productId) ? productId : null;
            },
            { timeout: 10_000 },
        )
        .toBeTruthy();

    const productId = new URL(page.url()).searchParams.get('editor');
    expect(productId).toBeTruthy();
    return productId as string;
}
