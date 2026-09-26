import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { fixtureData } from './fixtures.mjs';

const output = path.resolve('artifacts/shared-mobile-header');
const baseUrl = process.env.STOREFRONT_VISUAL_BASE_URL || 'http://127.0.0.1:5189';
const results = [];
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
    for (const preset of ['classic', 'modern-oriental', 'neo-minimalist']) {
        for (const width of [320, 390]) {
            for (const language of ['zh', 'en']) {
                const page = await browser.newPage({
                    viewport: { width, height: 844 },
                    locale: language === 'zh' ? 'zh-CN' : 'en-GB',
                    reducedMotion: 'reduce',
                });
                await page.addInitScript(() => localStorage.setItem('storefront-analytics-opt-out:v1', '1'));
                await page.route('**/*', async route => {
                    const url = new URL(route.request().url());
                    if (url.pathname.includes('shop-api')) {
                        return route.fulfill({ json: { data: fixtureData(preset) } });
                    }
                    if (url.pathname.includes('storefront-realtime')) {
                        return route.fulfill({ status: 204, body: '' });
                    }
                    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) return route.abort();
                    return route.continue();
                });
                let homeStyle;
                for (const [name, route] of [
                    ['home', '/'],
                    ['services', '/services'],
                    ['account', '/account'],
                ]) {
                    await page.goto(baseUrl + route);
                    const header = page.locator('.mobile-page-header');
                    await expect(header).toBeVisible();
                    const signature = await header.evaluate(element => {
                        const style = target => {
                            const computed = getComputedStyle(target);
                            const bounds = target.getBoundingClientRect();
                            return Object.fromEntries([
                                ['height', bounds.height],
                                ...[
                                    'paddingLeft',
                                    'paddingRight',
                                    'backgroundColor',
                                    'backgroundImage',
                                    'borderTopWidth',
                                    'borderRightWidth',
                                    'borderBottomWidth',
                                    'borderLeftWidth',
                                    'borderRadius',
                                    'boxShadow',
                                    'color',
                                    'fontSize',
                                    'fontWeight',
                                    'gap',
                                ].map(key => [key, computed[key]]),
                            ]);
                        };
                        return {
                            header: style(element),
                            logo: style(element.querySelector('.brand-mark')),
                            title: style(element.querySelector('.brand strong')),
                            preferences: style(element.querySelector('.locale-preferences-trigger')),
                            notification: style(element.querySelector('.notice-button')),
                        };
                    });
                    if (name === 'home') homeStyle = signature;
                    else
                        expect(signature, `${preset}/${width}/${language}/${name} matches home`).toEqual(
                            homeStyle,
                        );
                    expect(signature.header.height).toBe(52);
                    expect(signature.header.paddingLeft).toBe('16px');
                    expect(signature.header.borderBottomWidth).toBe('0px');
                    for (const key of ['preferences', 'notification']) {
                        expect(signature[key].height).toBe(44);
                        expect(signature[key].borderTopWidth).toBe('0px');
                    }
                    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(
                        0,
                    );
                    await header.screenshot({
                        path: path.join(output, `${preset}-${width}-${language}-${name}.png`),
                    });
                    await header.locator('.locale-preferences-trigger').click();
                    await expect(page.locator('.locale-preferences-sheet')).toBeVisible();
                    await page.keyboard.press('Escape');
                    await expect(page.locator('.locale-preferences-sheet')).toHaveCount(0);
                    if (name === 'account' && language === 'zh' && width === 390) {
                        await header.locator('.locale-preferences-trigger').click();
                        await page.getByRole('radio', { name: 'English', exact: true }).click();
                        await page.getByRole('button', { name: '保存设置', exact: true }).click();
                        await expect(header.locator('.locale-preferences-trigger')).toContainText('EN');
                    }
                    await header.locator('.notice-button').click();
                    await expect(page).toHaveURL(/\/notifications$/);
                    results.push({ preset, width, language, name, signature });
                }
                await page.unrouteAll({ behavior: 'wait' });
                await page.close();
            }
        }
    }
    await writeFile(path.join(output, 'header-results.json'), JSON.stringify(results, null, 2));
    process.stdout.write(
        `Shared mobile header checks passed: ${results.length} cases, identical styles and working actions\n`,
    );
} finally {
    await browser.close();
}
