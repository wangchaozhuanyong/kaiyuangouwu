import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const origin = process.env.ADMIN_TEST_ORIGIN ?? 'http://127.0.0.1:5348';
const output = fileURLToPath(new URL('./results/overlay-layering/', import.meta.url));
const promotionPath = '/marketing/promotions/generic';
const checks = [];
const errors = [];
const artifacts = [];
let failure = null;
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });

function fixtureUrl(theme) {
    const url = new URL('/e2e/admin-layout/index.html', origin);
    url.searchParams.set('view', 'tabs');
    url.searchParams.set('presentation', '');
    url.searchParams.set('settingsFixture', '');
    url.searchParams.set('platform', '');
    url.searchParams.set('path', '/dashboard');
    if (theme === 'light') url.searchParams.set('light', '');
    return url.href;
}

async function screenshot(page, filename) {
    const path = `${output}/${filename}.png`;
    await page.screenshot({ path });
    artifacts.push(path);
}

async function chromeHits(dialog) {
    return dialog.evaluate(element => {
        const backdrop = element.parentElement;
        return ['.admin-app-header', '.admin-tab-strip'].map(selector => {
            const chrome = document.querySelector(selector);
            if (!chrome) throw new Error(`Missing AppShell chrome: ${selector}`);
            const rect = chrome.getBoundingClientRect();
            const point = {
                x: Math.min(innerWidth - 8, rect.right - 16),
                y: Math.min(innerHeight - 1, Math.max(0, rect.top + rect.height / 2)),
            };
            const hit = document.elementFromPoint(point.x, point.y);
            return {
                selector,
                point,
                coveredByOverlay: Boolean(hit && backdrop?.contains(hit)),
                chromeOnTop: Boolean(hit && chrome.contains(hit)),
                hitTag: hit?.tagName ?? null,
                hitClass: typeof hit?.className === 'string' ? hit.className : null,
            };
        });
    });
}

async function activePageLayer(page) {
    return page.locator('#main-content .admin-tab-page:not([hidden])').evaluate(element => ({
        layer: getComputedStyle(element).zIndex,
        isolation: getComputedStyle(element).isolation,
        modalMarkers: element.querySelectorAll('[data-admin-modal-active]').length,
    }));
}

async function navigateFixture(page, path) {
    await page.evaluate(target => window.fixtureNavigate(target), path);
    await expect.poll(() => page.evaluate(() => window.fixtureLocation)).toBe(path);
}

async function verifyOverlayChrome(page, dialog, scene) {
    await expect(dialog).toBeVisible();
    await expect.poll(async () => (await activePageLayer(page)).layer).toBe('50');
    const layer = await activePageLayer(page);
    expect(layer.isolation, `${scene}: preserve page stacking isolation`).toBe('isolate');
    const hits = await chromeHits(dialog);
    expect(
        hits.every(hit => hit.coveredByOverlay),
        `${scene}: modal must cover header and tabs`,
    ).toBe(true);
    const title = dialog.getByRole('heading', { name: '新建通用促销', exact: true });
    await expect(title).toBeVisible();
    const titleHit = await title.evaluate(element => {
        const rect = element.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return Boolean(hit && element.contains(hit));
    });
    expect(titleHit, `${scene}: modal title is unobscured`).toBe(true);
    checks.push({ scene, check: 'promotion-covers-header-and-tabs', layer, hits, titleHit });
}

async function verifyScroll(page, dialog, scene, mobile) {
    const scroller = dialog.locator(':scope > .overflow-y-auto').last();
    const initial = await scroller.evaluate(element => ({
        maximum: element.scrollHeight - element.clientHeight,
        clientHeight: element.clientHeight,
        overflowY: getComputedStyle(element).overflowY,
    }));
    expect(initial.clientHeight, `${scene}: visible modal body`).toBeGreaterThan(0);
    expect(initial.overflowY).toBe('auto');
    if (mobile) expect(initial.maximum, `${scene}: mobile form has a scrollable body`).toBeGreaterThan(0);
    if (initial.maximum > 0) {
        await scroller.hover();
        await page.mouse.wheel(0, 1000);
        await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    }
    const after = await scroller.evaluate(element => ({
        scrollTop: element.scrollTop,
        maximum: element.scrollHeight - element.clientHeight,
    }));
    await expect(dialog.getByRole('button', { name: '关闭', exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: '取消', exact: true })).toBeVisible();
    checks.push({ scene, check: 'promotion-body-scroll-with-visible-close-and-cancel', initial, after });
}

async function verifyRoleConfirmation(page, scene) {
    await navigateFixture(page, '/settings/team/roles');
    const configure = page.getByRole('button', { name: '配置权限', exact: true });
    await expect(configure).toBeVisible({ timeout: 15_000 });
    await configure.click();
    const roleDialog = page.getByRole('dialog', { name: '配置角色权限', exact: true });
    await expect(roleDialog).toBeVisible();
    const roleLayer = await roleDialog.evaluate(element => getComputedStyle(element.parentElement).zIndex);
    expect(roleLayer, `${scene}: exercise the real settings modal at layer 200`).toBe('200');
    expect((await activePageLayer(page)).layer).toBe('50');
    await roleDialog.getByRole('textbox', { name: /^角色名称/ }).fill('本地弹层回归草稿');
    const save = roleDialog.getByRole('button', { name: '保存权限', exact: true });
    await save.click();
    const confirmation = page.getByRole('alertdialog');
    await expect(confirmation).toBeVisible();
    await expect(confirmation.getByRole('heading')).toContainText('保存角色');
    const confirmationState = await confirmation.evaluate(element => {
        const rect = element.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return {
            receivesFocus: element.contains(document.activeElement),
            isOnTop: Boolean(hit && element.contains(hit)),
            wrapperLayer: getComputedStyle(element.parentElement).zIndex,
            owningPage: element.closest('.admin-tab-page')?.className ?? null,
        };
    });
    expect(confirmationState.receivesFocus, `${scene}: global confirmation receives focus`).toBe(true);
    expect(confirmationState.isOnTop, `${scene}: global confirmation is above settings modal`).toBe(true);
    expect(confirmationState.wrapperLayer).toBe('100');
    expect(confirmationState.owningPage).toBeNull();
    await screenshot(page, `${scene}-settings-global-confirmation`);
    await page.keyboard.press('Escape');
    await expect(confirmation).toHaveCount(0);
    await expect(roleDialog).toBeVisible();
    await expect(roleDialog.getByRole('textbox', { name: /^角色名称/ })).toHaveValue('本地弹层回归草稿');
    await expect(save).toBeFocused();
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');
    await page.keyboard.press('Escape');
    await expect(roleDialog).toHaveCount(0);
    await expect.poll(async () => (await activePageLayer(page)).layer).toBe('auto');
    expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
    const writes = await page.evaluate(() => ({
        completed: window.mutationReceipts,
        blocked: window.blockedMutations,
    }));
    expect(writes.completed, `${scene}: no synthetic mutation executed`).toEqual([]);
    expect(writes.blocked, `${scene}: confirmation did not attempt a mutation`).toEqual([]);
    checks.push({
        scene,
        check: 'real-settings-modal-global-confirmation-focus-and-escape',
        roleLayer,
        confirmationState,
        writes,
    });
}

try {
    for (const viewport of [
        { width: 1440, height: 900 },
        { width: 390, height: 844 },
    ]) {
        for (const theme of ['light', 'dark']) {
            const scene = `${viewport.width}px-${theme}`;
            const context = await browser.newContext({ viewport, colorScheme: theme });
            const page = await context.newPage();
            page.setDefaultTimeout(7000);
            page.on('pageerror', error => errors.push({ scene, message: error.message }));
            page.on('dialog', dialog => dialog.dismiss());
            try {
                await page.goto(fixtureUrl(theme), { waitUntil: 'domcontentloaded', timeout: 60_000 });
                await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
                await expect(page.locator('.admin-tab-strip a').first()).toBeVisible({
                    timeout: 15_000,
                });
                await navigateFixture(page, promotionPath);
                const create = page.getByRole('button', { name: '新建通用促销', exact: true });
                await expect(create).toBeVisible({ timeout: 15_000 });
                await create.click();
                const promotion = page.getByRole('dialog', { name: '新建通用促销', exact: true });
                await expect(promotion).toBeVisible();
                if (viewport.width === 1440 && theme === 'light') {
                    // Reproduce the former isolation layer without changing project source.
                    const baselineStyle = await page.addStyleTag({
                        content: '.admin-tab-page { z-index: auto !important; }',
                    });
                    const baselineHits = await chromeHits(promotion);
                    expect(
                        baselineHits.every(hit => hit.chromeOnTop),
                        'baseline: header and tab strip obscure the modal',
                    ).toBe(true);
                    await screenshot(page, '1440px-light-before-isolated-layer');
                    checks.push({
                        scene,
                        check: 'reproduced-original-header-and-tab-occlusion',
                        hits: baselineHits,
                    });
                    await baselineStyle.evaluate(element => element.remove());
                }
                await verifyOverlayChrome(page, promotion, scene);
                await screenshot(page, `${scene}-promotion-after`);
                await verifyScroll(page, promotion, scene, viewport.width < 768);
                await screenshot(page, `${scene}-promotion-scroll`);
                await promotion.getByRole('button', { name: '关闭', exact: true }).click();
                await expect(promotion).toHaveCount(0);
                await expect.poll(async () => (await activePageLayer(page)).layer).toBe('auto');
                checks.push({ scene, check: 'top-close-is-clickable-and-restores-page-layer' });

                await create.click();
                await expect(promotion).toBeVisible();
                const name = promotion.getByRole('textbox', { name: /^名称/ });
                const draft = `弹层草稿 ${scene}`;
                await name.fill(draft);
                await navigateFixture(page, '/catalog/list');
                const retained = page.locator('[role="dialog"][aria-label="新建通用促销"]');
                await expect(retained).toHaveCount(1);
                await expect(retained).toBeHidden();
                const hiddenState = await retained.evaluate(element => {
                    const owner = element.closest('.admin-tab-page');
                    return {
                        hidden: owner?.hasAttribute('hidden'),
                        inert: owner?.hasAttribute('inert'),
                        marker: element.hasAttribute('data-admin-modal-active'),
                    };
                });
                expect(hiddenState).toEqual({ hidden: true, inert: true, marker: false });
                expect((await activePageLayer(page)).layer).toBe('auto');
                expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
                await page.keyboard.press('Escape');
                await expect(retained).toHaveCount(1);
                await navigateFixture(page, promotionPath);
                await expect(promotion).toBeVisible();
                await expect(name).toHaveValue(draft);
                await verifyOverlayChrome(page, promotion, `${scene}-restored`);
                await screenshot(page, `${scene}-promotion-restored-draft`);
                await promotion.getByRole('button', { name: '取消', exact: true }).click();
                await expect(promotion).toHaveCount(0);
                await expect.poll(async () => (await activePageLayer(page)).layer).toBe('auto');
                checks.push({
                    scene,
                    check: 'hidden-tab-preserves-draft-releases-modal-and-cancel-restores-layer',
                    hiddenState,
                });

                await verifyRoleConfirmation(page, scene);
            } catch (error) {
                await screenshot(page, `${scene}-failure`).catch(() => {});
                throw error;
            } finally {
                await context.close();
            }
        }
    }
    expect(errors, 'no browser runtime errors').toEqual([]);
} catch (error) {
    failure = { message: error.message, stack: error.stack };
} finally {
    const report = {
        status: failure ? 'FAIL' : 'PASS',
        source: 'Local synthetic data with real AppShell, promotion editor, role editor and global confirmation. No production acceptance or business writes.',
        origin,
        checks,
        errors,
        artifacts,
        failure,
    };
    await writeFile(`${output}/checks.json`, JSON.stringify(report, null, 2));
    await browser.close();
    console.log(
        JSON.stringify({ status: report.status, passed: checks.length, errors, failure, output }, null, 2),
    );
}
if (failure) process.exitCode = 1;
