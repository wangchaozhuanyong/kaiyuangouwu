import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const output = fileURLToPath(
    new URL('../../../../tmp/storefront-back-navigation-20261010/browser/', import.meta.url),
);
await mkdir(output, { recursive: true });
const base = process.env.ANNOUNCEMENTS_PREVIEW_URL || 'http://127.0.0.1:5310/e2e/announcements/index.html';
const browser = await chromium.launch({ headless: true });
const report = {
    source: 'Shared production navigation and UI; synthetic announcements only',
    cases: [],
    errors: [],
};

async function pageFor(query, width = 390) {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    page.on('pageerror', error => report.errors.push(error.message));
    await page.goto(`${base}?${query}`);
    return page;
}

async function routeIs(page, name, { id, page: number } = {}) {
    await page.waitForFunction(
        ({ name: expectedName, id: expectedId, number: expectedNumber }) => {
            const route = window.fixtureNavigation?.route;
            return route?.name === expectedName && route.id === expectedId && route.page === expectedNumber;
        },
        { name, id, number },
    );
    await page.locator(`[data-route="${name}"]`).waitFor();
}

async function indexOf(page) {
    return page.evaluate(() => window.fixtureNavigation.index);
}

async function returnFromDetail(page, zh, desktop) {
    if (desktop)
        await page
            .getByRole('button', { name: zh ? '返回全部公告' : 'Back to announcements', exact: true })
            .click();
    else await page.locator('.subpage-header button').click();
}

async function returnFromList(page) {
    await page.locator('.subpage-header button').click();
}

try {
    // Real shared UI in both layouts/languages/skins, starting from both entry points.
    for (const skin of ['classic', 'neo-minimalist'])
        for (const lang of ['zh', 'en'])
            for (const width of [390, 1440]) {
                const zh = lang === 'zh';
                const source = width === 390 ? 'account' : 'home';
                const page = await pageFor(
                    `view=${source}&skin=${skin}&lang=${lang}${width >= 1024 ? '&nativeHistory=1' : ''}`,
                    width,
                );
                await routeIs(page, source);
                const sourceIndex = await indexOf(page);
                if (source === 'home')
                    await page
                        .getByRole('button', {
                            name: zh ? '查看全部公告' : 'View all announcements',
                            exact: true,
                        })
                        .click();
                else
                    await page
                        .locator('.account-service-grid')
                        .getByRole('button', { name: zh ? '系统公告' : 'Notices', exact: true })
                        .click();
                const rows = page.locator('.notification-list > button');
                await rows.first().waitFor();
                await page
                    .locator('.announcement-pagination')
                    .getByRole('button', { name: zh ? '下一页' : 'Next', exact: true })
                    .click();
                await routeIs(page, 'announcements', { page: 2 });
                await rows.first().filter({ hasText: '13' }).waitFor();
                const listIndex = await indexOf(page);
                for (const id of ['13', '14']) {
                    await rows.nth(Number(id) - 13).click();
                    await routeIs(page, 'announcements', { id, page: 2 });
                    await page.locator('.announcement-article h1').waitFor();
                    await returnFromDetail(page, zh, width >= 1024);
                    await routeIs(page, 'announcements', { page: 2 });
                    assert.equal(
                        await indexOf(page),
                        listIndex,
                        'Return must consume the existing list entry',
                    );
                }
                if (width >= 1024) {
                    // Desktop hides the mobile subheader; use the browser's back action.
                    await page.goBack();
                    await routeIs(page, 'announcements');
                    await page.goBack();
                } else await returnFromList(page);
                await routeIs(page, source);
                assert.equal(
                    await indexOf(page),
                    sourceIndex,
                    'Leaving the list must skip pagination and exit to its source',
                );
                assert.equal(
                    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
                    false,
                );
                if (skin === 'classic' && lang === 'zh' && width === 390)
                    await page.screenshot({ path: `${output}/returned-to-account.png` });
                report.cases.push({
                    label: `${skin}-${lang}-${width}`,
                    checks: ['two details return to existing page 2', 'list exits to source', 'no overflow'],
                    status: 'pass',
                });
                await page.close();
            }

    // Native browser history uses the same tracker; the hash only keeps the fixture document URL intact.
    for (const source of ['home', 'account']) {
        const page = await pageFor(`view=${source}&lang=zh&skin=classic&nativeHistory=1`);
        await routeIs(page, source);
        if (source === 'home') await page.getByRole('button', { name: '查看全部公告', exact: true }).click();
        else
            await page
                .locator('.account-service-grid')
                .getByRole('button', { name: '系统公告', exact: true })
                .click();
        await routeIs(page, 'announcements');
        await page.locator('.notification-list > button').first().click();
        await routeIs(page, 'announcements', { id: '1' });
        await page.goBack();
        await routeIs(page, 'announcements');
        await page.goForward();
        await routeIs(page, 'announcements', { id: '1' });
        await returnFromDetail(page, true, false);
        await routeIs(page, 'announcements');
        await returnFromList(page);
        await routeIs(page, source);
        await page.goForward();
        await routeIs(page, 'announcements');
        await page.locator('.notification-list > button').nth(1).click();
        await routeIs(page, 'announcements', { id: '2' });
        await page.reload();
        await routeIs(page, 'announcements', { id: '2' });
        const refreshedIndex = await indexOf(page);
        await returnFromDetail(page, true, false);
        await routeIs(page, 'announcements');
        assert.equal(
            await indexOf(page),
            refreshedIndex,
            'Refresh has no trusted previous document; fallback replaces',
        );
        await returnFromList(page);
        await routeIs(page, 'home');
        assert.equal(await indexOf(page), refreshedIndex);
        report.cases.push({
            label: `native-${source}`,
            checks: ['browser back/forward', 'new forward branch', 'reload detail', 'safe exit after reload'],
            status: 'pass',
        });
        await page.close();
    }

    for (const id of ['27', 'missing']) {
        const page = await pageFor(`id=${id}&page=3&lang=zh&skin=classic&nativeHistory=1`);
        await routeIs(page, 'announcements', { id, page: 3 });
        if (id === 'missing')
            await page
                .getByRole('button', { name: '返回全部公告', exact: true })
                .filter({ visible: true })
                .click();
        else await returnFromDetail(page, true, false);
        await routeIs(page, 'announcements', { page: 3 });
        await page.locator('.notification-list > button').first().filter({ hasText: '25' }).waitFor();
        await returnFromList(page);
        await routeIs(page, 'home');
        assert.equal(await indexOf(page), 0);
        report.cases.push({
            label: `direct-${id}`,
            checks: ['shared detail/missing item', 'preserves page 3', 'list exits to home without push'],
            status: 'pass',
        });
        await page.close();
    }
    assert.deepEqual(report.errors, []);
} catch (error) {
    report.failure = String(error.stack || error);
    process.exitCode = 1;
} finally {
    await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
    await browser.close();
    process.stdout.write(
        JSON.stringify({ cases: report.cases.length, errors: report.errors, failure: report.failure }) + '\n',
    );
}
