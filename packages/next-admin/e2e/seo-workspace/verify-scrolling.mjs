import { chromium, expect, webkit } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const output = path.resolve(
    process.env.SEO_ADMIN_OUTPUT_DIR ?? fileURLToPath(new URL('./artifacts/scrolling/', import.meta.url)),
);
await mkdir(output, { recursive: true });
const origin = process.env.SEO_ADMIN_TEST_ORIGIN ?? 'http://127.0.0.1:5342';
const active = '.admin-tab-page:not([hidden])';
const rootSelector = `${active} [data-storefront-seo-workspace], ${active} [data-storefront-seo-entity]`;
const routes = [
    ['overview', '/storefront/seo/overview', '搜索收录设置'],
    ['pages', '/storefront/seo/pages?targetType=PRODUCT&targetId=5909', '页面 SEO'],
    ['geo', '/storefront/seo/geo?targetId=local-guide-1', 'GEO 内容与证据'],
    ['redirects', '/storefront/seo/redirects', '网址重定向'],
    ['diagnostics', '/storefront/seo/diagnostics', '搜索诊断'],
    ['platforms', '/storefront/seo/platforms', '搜索平台与效果'],
    ['product', '/catalog/products/42/seo', '商品搜索优化'],
    ['collection', '/catalog/collections/42/seo', '分类搜索优化'],
];
const browsers = [];
const results = process.env.SEO_SCROLL_RESUME
    ? JSON.parse(await readFile(process.env.SEO_SCROLL_RESUME, 'utf8')).results
    : [];
let current;
async function open(browser, route, width) {
    const context = await browser.newContext({
        viewport: { width, height: width < 500 ? 844 : 900 },
        hasTouch: true,
    });
    const page = await context.newPage();
    current = page;
    const errors = [];
    const networkWrites = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', request => {
        const url = new URL(request.request().url());
        if (url.origin !== origin) return request.abort();
        if (request.request().method() !== 'GET') {
            networkWrites.push(url.pathname);
            return request.abort();
        }
        return request.continue();
    });
    const url = new URL('/e2e/seo-workspace/index.html', origin);
    url.search = new URLSearchParams({ shell: '', large: '', path: route }).toString();
    await page.goto(url.href);
    const region = page.locator(rootSelector);
    await expect(region).toBeVisible();
    await expect(region.locator('.admin-page-status').filter({ hasText: '正在读取当前店铺' })).toHaveCount(0);
    await expect
        .poll(() => region.evaluate(node => node.scrollHeight - node.clientHeight))
        .toBeGreaterThan(0);
    expect(await page.evaluate(() => innerWidth)).toBe(width);
    return { page, context, region, errors, networkWrites };
}
async function wheel(page, region, delta) {
    const box = await region.boundingBox();
    // Page padding avoids independently scrollable textareas and the bounded record selector.
    await page.mouse.move(box.x + box.width - 12, box.y + box.height * 0.6);
    await page.mouse.wheel(0, delta);
}
async function bottom(page, region) {
    await wheel(page, region, 100000);
    await expect
        .poll(() => region.evaluate(node => node.scrollHeight - node.clientHeight - node.scrollTop))
        .toBeLessThan(2);
}
async function top(page, region) {
    await wheel(page, region, -100000);
    await expect.poll(() => region.evaluate(node => node.scrollTop)).toBe(0);
}
try {
    const chrome = await chromium.launch({ headless: true });
    browsers.push(chrome);
    for (const width of [1440, 390])
        for (const [name, route, title] of routes) {
            if (
                results.some(
                    item => item.engine === 'chromium' && item.route === route && item.width === width,
                )
            )
                continue;
            const { page, context, region, errors, networkWrites } = await open(chrome, route, width);
            await expect(region.getByRole('heading', { name: new RegExp(`^${title}`, 'u') })).toBeVisible();
            const geometry = await region.evaluate(node => ({
                clientHeight: node.clientHeight,
                contentHeight: node.scrollHeight,
                overflow: getComputedStyle(node).overflowY,
            }));
            expect(geometry.overflow).toBe('auto');
            await bottom(page, region);
            const action =
                name === 'diagnostics'
                    ? region.getByRole('link', { name: '打开 Search Console' })
                    : region.getByRole('button', { name: '保存草稿', exact: true });
            await expect(action).toBeInViewport();
            expect(await page.evaluate(() => scrollY)).toBe(0);
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
            await page.screenshot({ path: path.join(output, `${name}-${width}-bottom.png`) });
            await top(page, region);
            await region.focus();
            await page.keyboard.press('PageDown');
            await expect.poll(() => region.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
            // Native keyboard paging animates; wait for its final position before reversing by wheel.
            await region.evaluate(
                node =>
                    new Promise(resolve => {
                        let previous = node.scrollTop,
                            stable = 0;
                        const frame = () => {
                            stable = previous === node.scrollTop ? stable + 1 : 0;
                            previous = node.scrollTop;
                            if (stable >= 8) resolve(undefined);
                            else requestAnimationFrame(frame);
                        };
                        requestAnimationFrame(frame);
                    }),
            );
            await top(page, region);
            if (name === 'pages' || name === 'geo') {
                const picker = region.locator('[data-seo-record-picker]');
                await expect(picker).not.toHaveAttribute('open', '');
                await expect(region.getByRole('textbox', { name: /^搜索标题/u })).toBeInViewport();
                await picker.locator('summary').click();
                const rows = picker.getByRole('group', { name: '已配置记录列表' });
                await expect(rows.locator('button')).toHaveCount(20);
                await picker.getByRole('button', { name: '下一页', exact: true }).click();
                await expect(picker).toContainText('2 /');
                const search = picker.getByRole('searchbox', { name: /^搜索已配置记录/u });
                await search.fill(name === 'pages' ? '6524' : 'local-guide-79');
                await search.press('Enter');
                await expect(rows.locator('button')).toHaveCount(1);
                await rows.locator('button').click();
                await expect(region.getByRole('textbox', { name: /^搜索标题/u })).toHaveValue(
                    name === 'pages' ? '本地测试 616' : '本地测试 80',
                );
                await search.fill('不存在的记录');
                await search.press('Enter');
                await expect(picker.getByRole('status')).toContainText('没有匹配的记录');
                await picker.locator('summary').click();
                await top(page, region);
            }
            expect(await page.evaluate(() => window.seoFixture.writes)).toBe(0);
            expect(networkWrites).toEqual([]);
            expect(errors).toEqual([]);
            results.push({
                engine: 'chromium',
                route,
                width,
                ...geometry,
                wheelAndKeyboard: true,
                bottomActionReachable: true,
                pickerSearchAndPaging: name === 'pages' || name === 'geo',
                errors,
                realWrites: 0,
            });
            await context.close();
        }
    // Real AppShell tabs keep the DOM, so editing drafts and native scroll positions survive switching.
    {
        const { page, context, region, errors } = await open(
            chrome,
            '/storefront/seo/pages?targetType=PRODUCT&targetId=5909',
            1440,
        );
        const title = region.getByRole('textbox', { name: /^搜索标题/u });
        await title.fill('本地未保存草稿');
        await wheel(page, region, 220);
        await expect.poll(() => region.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
        const savedY = await region.evaluate(node => node.scrollTop);
        const nav = page.locator('#app-sidebar');
        await nav.getByRole('link', { name: 'GEO 内容与证据', exact: true }).click();
        await expect(
            page.locator(rootSelector).getByRole('heading', { name: 'GEO 内容与证据', exact: true }),
        ).toBeVisible();
        await nav.getByRole('link', { name: '页面 SEO', exact: true }).click();
        await expect(title).toHaveValue('本地未保存草稿');
        await expect.poll(() => region.evaluate(node => node.scrollTop)).toBe(savedY);
        await bottom(page, region);
        const save = region.getByRole('button', { name: '保存草稿', exact: true });
        await expect(save).toBeInViewport();
        await save.click();
        await expect(region.getByText('页面草稿已保存，公开页面继续使用已发布版本。')).toBeVisible();
        expect(await page.evaluate(() => window.seoFixture.writes)).toBe(1);
        expect(errors).toEqual([]);
        results.push({
            engine: 'chromium',
            scenario: 'real-shell-tab-draft-scroll-and-local-save',
            width: 1440,
            preservedScrollY: savedY,
            localSimulatedWrites: 1,
        });
        await context.close();
    }
    {
        const { page, context, region, errors } = await open(chrome, '/storefront/seo/overview', 390);
        const session = await context.newCDPSession(page);
        const box = await region.boundingBox();
        await session.send('Input.synthesizeScrollGesture', {
            x: Math.round(box.x + box.width - 12),
            y: Math.round(box.y + box.height * 0.8),
            yDistance: -400,
            gestureSourceType: 'touch',
            preventFling: true,
            speed: 800,
        });
        await expect.poll(() => region.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
        expect(errors).toEqual([]);
        results.push({ engine: 'chromium', width: 390, scenario: 'native-touch-scroll' });
        await context.close();
    }
    const safari = await webkit.launch({ headless: true });
    browsers.push(safari);
    for (const [name, route] of routes.filter(([name]) => ['geo', 'product'].includes(name))) {
        const { page, context, region, errors } = await open(safari, route, 390);
        await bottom(page, region);
        await expect(region.getByRole('button', { name: '保存草稿', exact: true })).toBeInViewport();
        await top(page, region);
        expect(errors).toEqual([]);
        results.push({ engine: 'webkit', name, width: 390, scrollAndBottomAction: true });
        await context.close();
    }
    await writeFile(
        path.join(output, 'scrolling-result.json'),
        JSON.stringify(
            {
                status: 'PASS',
                source: 'actual AppShell / TabbedOutlet / AdminPageWorkspace with real SEO modules and synthetic local data',
                results,
                productionVerified: false,
            },
            null,
            2,
        ),
    );
    console.log(JSON.stringify({ status: 'PASS', scenarios: results.length }));
} catch (error) {
    await current?.screenshot({ path: path.join(output, 'scrolling-failure.png') }).catch(() => {});
    await writeFile(
        path.join(output, 'scrolling-failure.json'),
        JSON.stringify(
            {
                message: error.message,
                results,
                body: await current
                    ?.locator('body')
                    .innerText()
                    .catch(() => ''),
            },
            null,
            2,
        ),
    );
    throw error;
} finally {
    await Promise.all(browsers.map(browser => browser.close()));
}
