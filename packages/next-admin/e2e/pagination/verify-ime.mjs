import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Run against the existing isolated list fixture; no real API or customer records are used.
const base = process.env.IME_TEST_URL ?? 'http://127.0.0.1:5397/e2e/pagination/index.html';
const output = path.resolve(process.env.IME_TEST_OUTPUT ?? '../../../reports/chinese-input-20260907/browser');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const checks = [];
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const params = () => new URL(page.url()).searchParams;
const requests = name =>
    page.evaluate(
        name => window.paginationFixture.operations.filter(operation => operation.name === name),
        name,
    );

try {
    for (const [view, label, operation] of [
        ['products', '搜索商品', 'GetProducts'],
        ['sales', '搜索订单', 'GetSalesOrders'],
        ['customers', '搜索客户', 'AdminCustomers'],
    ]) {
        await page.goto(`${base}?view=${view}&page=3&pageSize=50&status=enabled`);
        const input = page.getByRole('textbox', { name: label, exact: true });
        await expect(page.locator('table tbody tr')).toHaveCount(50);
        await page.evaluate(() => {
            window.paginationFixture.delay = 250;
        });
        const initialRequests = (await requests(operation)).length;
        await input.focus();
        const originalInput = await input.elementHandle();
        const cdp = await page.context().newCDPSession(page);
        const compose = async text => {
            await cdp.send('Input.imeSetComposition', {
                text,
                selectionStart: text.length,
                selectionEnd: text.length,
            });
        };

        // Use Chromium's native composition engine. fill('中华') alone cannot reproduce this bug.
        for (const text of ['z', 'zh', 'zhong', 'zhonghua']) {
            await compose(text);
            await expect(input).toHaveValue(text);
            expect(params().has('search')).toBe(false);
            expect(params().get('page')).toBe('3');
            expect((await requests(operation)).length).toBe(initialRequests);
            expect(await originalInput.evaluate(element => document.activeElement === element)).toBe(true);
        }
        await cdp.send('Input.insertText', { text: '中华' });
        await expect(input).toHaveValue('中华');
        await expect.poll(() => params().get('search')).toBe('中华');
        await expect
            .poll(async () => JSON.stringify((await requests(operation)).at(-1)?.variables))
            .toContain('中华');
        expect((await requests(operation)).length).toBe(initialRequests + 1);
        expect(params().has('page')).toBe(false);
        expect(params().get('pageSize')).toBe('50');
        expect(params().get('status')).toBe('enabled');

        // A second composition and insertion in the middle must preserve the existing characters.
        await compose('cha');
        await expect(input).toHaveValue('中华cha');
        await cdp.send('Input.insertText', { text: '茶' });
        await expect(input).toHaveValue('中华茶');
        await input.evaluate(element => element.setSelectionRange(1, 1));
        await compose('guo');
        await expect(input).toHaveValue('中guo华茶');
        await cdp.send('Input.insertText', { text: '国' });
        await expect(input).toHaveValue('中国华茶');
        expect(await input.evaluate(element => element.selectionStart)).toBe(2);

        await input.press('End');
        await compose('quxiao');
        await compose('');
        await expect(input).toHaveValue('中国华茶');
        await input.pressSequentially('ABC123', { delay: 0 });
        await expect(input).toHaveValue('中国华茶ABC123');
        await input.press('Backspace');
        await expect(input).toHaveValue('中国华茶ABC12');
        await input.fill(' 中文 SKU-123 ');
        await expect(input).toHaveValue(' 中文 SKU-123 ');
        await expect.poll(() => params().get('search')).toBe(' 中文 SKU-123 ');
        await page.getByRole('button', { name: /清空.*搜索/, exact: true }).click();
        await expect(input).toHaveValue('');
        await expect.poll(() => params().has('search')).toBe(false);

        await input.fill('历史中文');
        await expect.poll(() => params().get('search')).toBe('历史中文');
        await page.evaluate(view => {
            const next = new URL(location.href);
            next.searchParams.set('view', view);
            next.searchParams.set('search', '另一个关键词');
            history.pushState(null, '', next);
            window.dispatchEvent(new PopStateEvent('popstate'));
        }, view);
        await expect(input).toHaveValue('另一个关键词');
        await page.goBack();
        await expect(input).toHaveValue('历史中文');
        await page.goForward();
        await expect(input).toHaveValue('另一个关键词');
        await page.reload();
        await expect(input).toHaveValue('另一个关键词');
        await cdp.detach();
        checks.push(
            `${view}: native Chinese composition, no partial queries, consecutive/middle insertion, cancellation, fast typing, deletion, paste, clear, history, reload, slow responses`,
        );
        if (view === 'products') {
            await page.screenshot({ path: path.join(output, 'catalog-desktop.png'), fullPage: false });
            await page.setViewportSize({ width: 390, height: 844 });
            await input.fill('中华');
            await expect(input).toHaveValue('中华');
            await page.screenshot({ path: path.join(output, 'catalog-mobile.png'), fullPage: false });
            await page.setViewportSize({ width: 1440, height: 1000 });
        }
    }

    // Verify a real text-entry dialog, including the keyCode=229 fallback.
    await page.getByRole('button', { name: '管理客户分组', exact: true }).click();
    const groupName = page.getByPlaceholder('输入新分组名称');
    await groupName.fill('中文分组');
    const operationCount = await page.evaluate(() => window.paginationFixture.operations.length);
    for (const options of [{ isComposing: true }, { isComposing: false, keyCode: 229 }]) {
        for (const key of ['Enter', 'Escape']) {
            await groupName.dispatchEvent('keydown', { key, bubbles: true, cancelable: true, ...options });
            await expect(groupName).toBeVisible();
            await expect(groupName).toHaveValue('中文分组');
            expect(await page.evaluate(() => window.paginationFixture.operations.length)).toBe(
                operationCount,
            );
        }
    }
    await groupName.press('Escape');
    await expect(groupName).toHaveCount(0);
    checks.push(
        'Customer group: candidate-confirming Enter does not create records; IME Escape does not close the dialog; normal Escape closes it',
    );
    expect(errors).toEqual([]);
    await writeFile(
        path.join(output, 'result.json'),
        JSON.stringify({ status: 'PASS', checks, errors }, null, 2),
    );
    console.log(JSON.stringify({ status: 'PASS', checks, output }, null, 2));
} finally {
    await browser.close();
}
