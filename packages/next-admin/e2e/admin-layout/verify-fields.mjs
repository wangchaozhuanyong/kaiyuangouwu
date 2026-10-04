import { chromium, expect } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const origin = process.env.ADMIN_TEST_ORIGIN ?? 'http://127.0.0.1:5354';
const output = fileURLToPath(new URL('./results/inline-fields/', import.meta.url));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const previous = process.env.ADMIN_TEST_RESUME
    ? JSON.parse(await readFile(`${output}/progress.json`, 'utf8'))
    : { receipts: [], completed: [] };
const receipts = previous.receipts;
const completed = previous.completed;
const errors = [];
const allViews = [
    'fields',
    'cardpool',
    'product',
    'draft',
    'allocation',
    'assets',
    'aftersales',
    'sales',
    'reviews',
    'catalog',
    'suppliers',
    'paymentSettings',
    'profit',
    'translations',
    'jobs',
    'usdt',
    'plugins',
    'copy',
    'categories',
    'purchases',
    'stores',
    'team',
];
const representative = [
    'fields',
    'cardpool',
    'product',
    'suppliers',
    'paymentSettings',
    'usdt',
    'categories',
    'purchases',
    'stores',
    'copy',
];

async function measure(page, scene, mode) {
    const dimensions = await page.evaluate(() => {
        const rect = element => element.getBoundingClientRect();
        const fields = [...document.querySelectorAll('[data-admin-field]')].flatMap(field => {
            const row = field.querySelector(':scope > .admin-field-row');
            const label = row?.querySelector(':scope > .admin-field-label');
            const control = row?.querySelector(':scope > .admin-field-control');
            if (!row || !label || !control || !rect(field).width || !rect(field).height) return [];
            const stacked =
                field.dataset.adminField === 'stacked' ||
                Boolean(row.querySelector('textarea,input[type=file],[data-admin-field=stacked]'));
            const horizontal = rect(field).width >= 320 && !stacked;
            return [
                {
                    caption: label.textContent.trim().slice(0, 80),
                    width: rect(field).width,
                    horizontal,
                    columns: getComputedStyle(row).gridTemplateColumns,
                    aligned: horizontal
                        ? rect(label).right <= rect(control).left + 1 &&
                          rect(label).top < rect(control).bottom &&
                          rect(control).top < rect(label).bottom
                        : rect(label).bottom <= rect(control).top + 1,
                    controlWidth: rect(control).width,
                    overflow: rect(control).right > rect(field).right + 1,
                },
            ];
        });
        const controls = [...document.querySelectorAll('.admin-control')].filter(
            element => rect(element).width && rect(element).height,
        );
        return {
            documentWidth: document.documentElement.scrollWidth,
            viewport: innerWidth,
            fields,
            touchSmall: controls.filter(element => parseFloat(getComputedStyle(element).minHeight) < 44)
                .length,
        };
    });
    expect(dimensions.documentWidth, `${scene}: document overflow`).toBeLessThanOrEqual(
        dimensions.viewport + 1,
    );
    expect(
        dimensions.fields.filter(field => !field.aligned || field.overflow || field.controlWidth < 80),
        `${scene}: field layout`,
    ).toEqual([]);
    if (mode.touch) expect(dimensions.touchSmall, `${scene}: touch controls`).toBe(0);
    receipts.push({ scene, width: mode.width, theme: mode.theme, ...dimensions });
}

try {
    for (const mode of [
        { width: 1440, theme: 'light', touch: false, views: allViews },
        { width: 1440, theme: 'dark', touch: false, views: representative },
        { width: 390, theme: 'light', touch: true, views: representative },
        { width: 390, theme: 'dark', touch: true, views: representative },
        { width: 1024, theme: 'light', touch: true, views: ['fields', 'cardpool', 'usdt', 'stores'] },
    ]) {
        const context = await browser.newContext({
            viewport: { width: mode.width, height: 1000 },
            hasTouch: mode.touch,
        });
        const page = await context.newPage();
        page.setDefaultTimeout(10_000);
        page.on('pageerror', error => errors.push(error.message));
        for (const view of mode.views) {
            const key = `${view}-${mode.width}-${mode.theme}`;
            if (completed.includes(key)) continue;
            console.log(`Checking ${view} ${mode.width} ${mode.theme}`);
            await page.goto(
                `${origin}/e2e/admin-layout/index.html?view=${view}&multi${mode.theme === 'light' ? '&light' : ''}`,
                { waitUntil: 'networkidle' },
            );
            await expect(page.locator('[data-admin-page]')).toBeVisible();
            await expect(page.locator('[data-layout-fixture-error]')).toHaveCount(0);
            await expect(page.getByText('当前页面暂时无法显示', { exact: true })).toHaveCount(0);
            await measure(page, view, mode);
            if (['fields', 'cardpool', 'stores'].includes(view))
                await page.screenshot({
                    path: `${output}/${view}-${mode.width}-${mode.theme}.png`,
                    animations: 'disabled',
                });
            if (view === 'fields') {
                await page.getByText('店铺名称', { exact: true }).click();
                const input = page.getByRole('textbox', { name: /店铺名称/ });
                await expect(input).toBeFocused();
                await input.fill('新布局草稿');
                await expect(page.locator('[data-field-values]')).toContainText('新布局草稿');
                await page.getByRole('combobox', { name: '销售状态' }).selectOption('enabled');
                await expect(page.locator('[data-field-values]')).toContainText('enabled');
                const search = page.locator('[data-field-width="500"] input[type=search]');
                await search.fill('中文 SKU');
                await search.press('Enter');
                await expect(page.locator('[data-field-values]')).toContainText('中文 SKU');
            }
            if (view === 'suppliers') {
                await page.getByRole('button', { name: '新增供货商', exact: true }).click();
                await expect(page.getByRole('dialog')).toBeVisible();
                await measure(page, 'supplier-dialog', mode);
                await page.getByRole('button', { name: '取消', exact: true }).click();
            }
            if (view === 'categories') {
                await page.getByRole('button', { name: '新增分类', exact: true }).click();
                await expect(page.getByRole('dialog')).toBeVisible();
                await measure(page, 'category-dialog', mode);
                await page.getByRole('button', { name: '取消', exact: true }).click();
            }
            completed.push(key);
            await writeFile(`${output}/progress.json`, JSON.stringify({ receipts, completed }, null, 2));
        }
        await context.close();
    }
    expect(errors).toEqual([]);
    await writeFile(
        `${output}/receipt.json`,
        JSON.stringify({ scenarios: receipts.length, errors, receipts }, null, 2),
    );
    console.log(
        `Passed ${receipts.length} field-layout/browser scenarios; screenshots and receipt: ${output}`,
    );
} finally {
    await browser.close();
}
