import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { startSeoFixtureServer } from '../seo-public/preview-server.mjs';

const baseline = process.env.AUTH_OPENING_BASELINE === '1';
const idleOnly = process.env.AUTH_OPENING_PHASE === 'idle';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const output = path.join(
    root,
    '.runtime/auth-opening-20261029',
    baseline ? 'before' : idleOnly ? 'idle' : 'after',
);
await mkdir(output, { recursive: true });
const server = await startSeoFixtureServer(0, {
    readOnly: true,
    transformPage(page, { url }) {
        page.visualPreset.presetId = url.searchParams.get('preset') ?? 'classic';
    },
});
const origin = `http://127.0.0.1:${server.port}`;
const browser = await chromium.launch({ headless: true });
const results = [];
const errors = [];
const dialogCode = /\/auth-overlay-(?!navigation|surface|preload)[\w-]+\.js$/;
const formCode = /\/auth-pages-[\w-]+\.js$/;

async function setup(width, language, preset, failure = false) {
    const page = await browser.newPage({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' });
    page.on('pageerror', error => {
        if (!failure) errors.push(error.message);
    });
    let releaseDialog;
    let releaseForm;
    const dialogGate = new Promise(resolve => {
        releaseDialog = resolve;
    });
    const formGate = new Promise(resolve => {
        releaseForm = resolve;
    });
    const started = [];
    await page.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.origin !== origin) return route.abort();
        if (dialogCode.test(url.pathname)) {
            started.push('dialog');
            await dialogGate;
            if (failure) return route.abort('failed');
        }
        if (formCode.test(url.pathname)) {
            started.push('form');
            await formGate;
        }
        await route.continue().catch(() => undefined);
    });
    await page.addInitScript(() => {
        localStorage.setItem('storefront-analytics-opt-out:v1', '1');
        window.__authOpening = {};
        document.addEventListener(
            'click',
            event => {
                if (event.target.closest('.proto-login-btn, .storefront-bottom-nav a[href="/account"]'))
                    window.__authOpening.click = performance.now();
            },
            true,
        );
        new MutationObserver(() => {
            const timing = window.__authOpening;
            if (!timing.click) return;
            if (!timing.feedback && document.querySelector('.storefront-query-feedback[role="status"]'))
                timing.feedback = performance.now();
            if (!timing.dialog && document.querySelector('.auth-dialog')) timing.dialog = performance.now();
            if (
                !timing.form &&
                document.querySelector('.auth-dialog input[name="emailAddress"]:not(:disabled)')
            )
                timing.form = performance.now();
        }).observe(document, { childList: true, subtree: true });
    });
    await page.goto(`${origin}/${language}/services?preset=${preset}`);
    await expect(page.locator('html')).toHaveAttribute('data-storefront-app-owned', '');
    const trigger = page.locator(
        width < 1024 ? '.storefront-bottom-nav a[href="/account"]' : '.proto-login-btn',
    );
    return { page, trigger, started, releaseDialog, releaseForm };
}

try {
    for (const preset of idleOnly ? [] : baseline ? ['classic'] : ['classic', 'neo-minimalist']) {
        for (const language of baseline ? ['zh'] : ['zh', 'en']) {
            for (const width of baseline ? [1440] : [1440, 390]) {
                const { page, trigger, started, releaseDialog, releaseForm } = await setup(
                    width,
                    language,
                    preset,
                );
                try {
                    await trigger.click();
                    if (baseline) {
                        // Explicitly sample the unresponsive interval while network gates stay closed.
                        await page.waitForTimeout(350);
                        results.push({
                            phase: 'blocked-code',
                            dialog: await page.locator('.auth-dialog').count(),
                            feedback: await page.locator('.storefront-query-feedback[role="status"]').count(),
                        });
                        assert.equal(await page.locator('.auth-dialog').count(), 0);
                    } else {
                        await expect(page.locator('.storefront-query-feedback[role="status"]')).toBeVisible();
                        await expect
                            .poll(() => started.includes('dialog') && started.includes('form'))
                            .toBe(true);
                        const timing = await page.evaluate(() => window.__authOpening);
                        assert.ok(
                            timing.feedback - timing.click < 250,
                            'Immediate feedback while both downloads are held',
                        );
                        results.push({
                            preset,
                            language,
                            width,
                            phase: 'cold-feedback',
                            ms: timing.feedback - timing.click,
                        });
                    }
                    releaseDialog();
                    const dialog = page.locator('.auth-dialog');
                    await expect(dialog).toBeVisible();
                    await expect(dialog.locator('.auth-overlay-loading')).toBeVisible();
                    const loadingBox = await dialog.boundingBox();
                    releaseForm();
                    const email = dialog.locator('input[name="emailAddress"]');
                    await expect(email).toBeEnabled();
                    const formBox = await dialog.boundingBox();
                    results.push({
                        preset,
                        language,
                        width,
                        phase: 'form-ready',
                        heightDelta: formBox.height - loadingBox.height,
                    });
                    if (!baseline)
                        assert.ok(
                            Math.abs(formBox.height - loadingBox.height) < 4,
                            'Skeleton and form preserve dialog size',
                        );
                    await page.screenshot({ path: path.join(output, `${preset}-${language}-${width}.png`) });
                    await page.keyboard.press('Escape');
                    await expect(dialog).toHaveCount(0);
                    await page.evaluate(() => {
                        window.__authOpening = {};
                    });
                    await trigger.click();
                    await expect(email).toBeEnabled();
                    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
                    const reopened = await page.evaluate(() => window.__authOpening);
                    const warmMs = reopened.form - reopened.click;
                    if (!baseline)
                        assert.ok(warmMs < 500, `Warm dialog should not download code again (${warmMs}ms)`);
                    await email.fill('preview@example.invalid');
                    await dialog.locator('.auth-switch button').click();
                    await expect(dialog.locator('input[name="emailAddress"]')).toHaveValue(
                        'preview@example.invalid',
                    );
                    await page.keyboard.press('Escape');
                    results.push({ preset, language, width, phase: 'warm-open-register-close', ms: warmMs });
                } finally {
                    releaseDialog();
                    releaseForm();
                    await page.close();
                }
            }
        }
    }
    if (!baseline && !idleOnly) {
        for (const failure of [false, true]) {
            const { page, trigger, releaseDialog, releaseForm } = await setup(1440, 'zh', 'classic', failure);
            try {
                await trigger.click();
                if (failure) {
                    releaseDialog();
                    releaseForm();
                    await expect(page.locator('.storefront-query-feedback[role="alert"]')).toBeVisible();
                } else await expect(page.locator('.storefront-query-feedback[role="status"]')).toBeVisible();
                await page.locator('.storefront-query-feedback button').last().click();
                await expect(page).not.toHaveURL(/[?&]auth=/);
                releaseDialog();
                releaseForm();
                await expect(page.locator('.auth-dialog')).toHaveCount(0);
                await expect(trigger).toBeVisible();
                results.push({ phase: failure ? 'failed-code-cancel' : 'pending-code-cancel' });
            } finally {
                releaseDialog();
                releaseForm();
                await page.close();
            }
        }
    }
    if (!baseline) {
        for (const width of [1440, 390]) {
            const { page, trigger, started, releaseDialog, releaseForm } = await setup(
                width,
                'zh',
                'classic',
            );
            try {
                await expect.poll(() => started.includes('dialog') && started.includes('form')).toBe(true);
                assert.equal(await page.locator('.auth-dialog').count(), 0);
                const loaded = Promise.all([
                    page.waitForResponse(response => dialogCode.test(new URL(response.url()).pathname)),
                    page.waitForResponse(response => formCode.test(new URL(response.url()).pathname)),
                ]);
                releaseDialog();
                releaseForm();
                await Promise.all((await loaded).map(response => response.finished()));
                await trigger.click();
                await expect(page.locator('.auth-dialog input[name="emailAddress"]')).toBeEnabled();
                const timing = await page.evaluate(() => window.__authOpening);
                const elapsed = timing.form - timing.click;
                assert.ok(
                    elapsed < 250,
                    `Idle preparation should make the first opening responsive (${elapsed}ms)`,
                );
                results.push({ phase: 'idle-prepared-first-open', width, ms: elapsed });
            } finally {
                releaseDialog();
                releaseForm();
                await page.close();
            }
        }
    }
    assert.deepEqual(errors, []);
} finally {
    await browser.close();
    await server.close();
    await writeFile(
        path.join(output, 'results.json'),
        JSON.stringify(
            {
                source: 'Actual SSR/application with synthetic local data and controlled code-download gates. No authentication submitted.',
                results,
                errors,
            },
            null,
            2,
        ) + '\n',
    );
}
process.stdout.write(
    `Authentication opening: ${results.length} checks passed (${baseline ? 'baseline' : 'fixed'}).\n`,
);
