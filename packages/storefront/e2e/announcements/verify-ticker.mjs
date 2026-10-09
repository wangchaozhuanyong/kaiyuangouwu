import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const output = fileURLToPath(new URL('../../../../tmp/notice-ticker-20261010/browser/', import.meta.url));
await mkdir(output, { recursive: true });
const base = process.env.ANNOUNCEMENTS_PREVIEW_URL || 'http://127.0.0.1:5310/e2e/announcements/index.html';
const focusOnly = process.env.TICKER_FOCUS_ONLY === '1';
const browser = await chromium.launch({ headless: true });
const report = {
    source: 'Actual HomePage, HomeNoticeTicker, shared styles, router and announcement center; synthetic read-only data',
    cases: [],
    errors: [],
};
const page = await browser.newPage();
page.on('pageerror', error => report.errors.push(error.message));
// Match only API endpoint paths; Vite source modules can contain "shop-api" in their names.
await page.route('**/*', route => {
    const path = new URL(route.request().url()).pathname;
    return /(?:^|\/)shop-api\/?$/u.test(path) ? route.abort('blockedbyclient') : route.continue();
});
const track = () => page.locator('.notice-strip-track');
const title = () => page.locator('.notice-strip-title');
const open = async (query = '') => {
    await page.mouse.move(0, 0);
    await page.goto(`${base}?view=home&lang=zh&skin=classic${query}`);
    await page.locator('.home-page').waitFor();
};
const animationState = () =>
    track().evaluate(element => {
        const animation = element.getAnimations()[0];
        return {
            duration: animation?.effect.getTiming().duration,
            currentTime: animation?.currentTime,
            playState: animation?.playState,
            x: new DOMMatrix(getComputedStyle(element).transform).m41,
        };
    });
const waitAnimation = () =>
    page.waitForFunction(() => !!document.querySelector('.notice-strip-track')?.getAnimations()[0]);
const seek = time =>
    track().evaluate((element, seekTime) => {
        element.getAnimations()[0].currentTime = seekTime;
    }, time);
const next = async () => {
    const before = await title().innerText();
    await track().evaluate(element => element.getAnimations()[0].finish());
    await page.waitForFunction(
        expectedTitle => document.querySelector('.notice-strip-title')?.textContent !== expectedTitle,
        before,
    );
    await waitAnimation();
};
try {
    if (!focusOnly) {
        for (const skin of ['classic', 'neo-minimalist'])
            for (const lang of ['zh', 'en'])
                for (const width of [390, 1024, 1440]) {
                    const label = `${skin}-${lang}-${width}`;
                    await page.setViewportSize({ width, height: 900 });
                    await page.goto(`${base}?view=home&skin=${skin}&lang=${lang}`);
                    await waitAnimation();
                    const geometry = await page.locator('.notice-strip').evaluate(element => {
                        const box = element.getBoundingClientRect();
                        const nodes = ['.notice-strip-title', '.notice-strip-content', '.notice-strip-track'];
                        return {
                            height: box.height,
                            overflow: document.documentElement.scrollWidth > innerWidth,
                            nodes: nodes.map(selector => {
                                const node = element.querySelector(selector);
                                const style = getComputedStyle(node);
                                return {
                                    selector,
                                    height: node.getBoundingClientRect().height,
                                    lineHeight: parseFloat(style.lineHeight),
                                    whiteSpace: style.whiteSpace,
                                };
                            }),
                            controls: [...element.querySelectorAll('button')].map(node => ({
                                width: node.clientWidth,
                                height: node.clientHeight,
                            })),
                        };
                    });
                    assert.equal(geometry.overflow, false, label);
                    assert(geometry.height <= 60, `${label}: single compact strip`);
                    for (const node of geometry.nodes)
                        assert(node.height <= node.lineHeight + 1, `${label}: ${node.selector} single line`);
                    for (const control of geometry.controls)
                        assert(control.height >= 44, `${label}: touch target height`);
                    const titleBefore = await title().boundingBox();
                    await seek(2400);
                    const moved = await animationState();
                    await page.waitForTimeout(220);
                    const moving = await animationState();
                    assert(moving.x < moved.x - 3, `${label}: actual right-to-left motion`);
                    const titleAfter = await title().boundingBox();
                    assert.equal(titleBefore.x, titleAfter.x, `${label}: fixed title`);
                    assert.equal(titleBefore.y, titleAfter.y, `${label}: fixed title baseline`);
                    await page.screenshot({ path: `${output}/${label}.png`, fullPage: true });
                    report.cases.push({
                        label,
                        status: 'pass',
                        geometry,
                        checks: [
                            'actual shared HomePage',
                            'single line',
                            'no document overflow',
                            '44px controls',
                            'fixed title',
                            'real right-to-left motion',
                        ],
                    });
                }

        await page.setViewportSize({ width: 1440, height: 900 });
        await open();
        await waitAnimation();
        const firstTitle = await title().innerText();
        const firstContent = await track().innerText();
        await seek(3500);
        await page.locator('.notice-strip-control').dispatchEvent('click');
        const paused = await animationState();
        await page.waitForTimeout(220);
        const still = await animationState();
        assert.equal(still.playState, 'paused');
        assert(Math.abs(still.x - paused.x) < 1, 'Pause preserves current position');
        await page.locator('.notice-strip-control').dispatchEvent('click');
        await page.waitForTimeout(220);
        assert((await animationState()).x < still.x - 3, 'Resume continues from same position');
        report.cases.push({ label: 'pause-resume-in-place', status: 'pass' });

        const duration = (await animationState()).duration;
        await seek(duration - 1850);
        const tail = await animationState();
        await page.waitForTimeout(220);
        assert.equal(await title().innerText(), firstTitle, 'No early next notice');
        assert(Math.abs((await animationState()).x - tail.x) < 1, 'Final two seconds hold the last words');
        const endVisible = await track().evaluate(
            element =>
                element.getBoundingClientRect().right - element.parentElement.getBoundingClientRect().right,
        );
        assert(Math.abs(endVisible) < 2, 'Last words fully visible at end of movement');
        await seek(duration - 120);
        await page.waitForFunction(
            expectedTitle => document.querySelector('.notice-strip-title')?.textContent !== expectedTitle,
            firstTitle,
        );
        await waitAnimation();
        const secondTitle = await title().innerText();
        await next();
        const thirdTitle = await title().innerText();
        await next();
        assert.equal(await title().innerText(), firstTitle, 'Fourth record excluded from ticker loop');
        report.cases.push({
            label: 'tail-hold-complete-then-three-item-loop',
            status: 'pass',
            titles: [firstTitle, secondTitle, thirdTitle],
        });

        await page.locator('.notice-strip-open').click();
        await page.locator('.notice-detail-body').waitFor();
        assert.equal(
            (await page.locator('.notice-detail-body').innerText()).replace(/\s+/gu, ' '),
            firstContent,
        );
        assert.equal((await animationState()).playState, 'paused');
        await page.screenshot({ path: `${output}/complete-notice-detail.png`, fullPage: true });
        await page.keyboard.press('Escape');
        await page.locator('.notice-detail-body').waitFor({ state: 'detached' });
        await page.locator('.notice-strip-all').click();
        await page.locator('.notification-list > button').first().waitFor();
        assert.equal(await page.locator('.notification-list > button').count(), 12);
        assert(
            await page.locator('.notification-list').getByText('第四条历史公告', { exact: true }).isVisible(),
        );
        report.cases.push({ label: 'complete-detail-and-all-announcements', status: 'pass' });

        await open('&shortFirst&hold=7');
        await waitAnimation();
        const shortTitle = await title().innerText();
        assert.equal((await animationState()).duration, 7000, 'Admin short-notice hold setting used');
        await seek(6800);
        await page.waitForTimeout(70);
        assert.equal(await title().innerText(), shortTitle);
        assert.equal((await animationState()).x, 0, 'Fitting content stays still');
        await page.waitForFunction(
            expectedTitle => document.querySelector('.notice-strip-title')?.textContent !== expectedTitle,
            shortTitle,
        );
        report.cases.push({ label: 'fitting-notice-configured-seven-second-hold', status: 'pass' });

        await open('&count=2');
        await waitAnimation();
        const twoFirst = await title().innerText();
        await next();
        await next();
        assert.equal(await title().innerText(), twoFirst);
        report.cases.push({ label: 'two-notices-loop-without-missing-slot', status: 'pass' });

        await open('&count=1');
        await waitAnimation();
        const only = await title().innerText();
        await track().evaluate(element => element.getAnimations()[0].finish());
        await page.waitForTimeout(80);
        assert.equal(await title().innerText(), only);
        assert.equal((await animationState()).playState, 'running');
        await open('&count=1&shortFirst');
        await page.locator('.notice-strip-track').waitFor();
        assert.equal(await track().evaluate(element => element.getAnimations().length), 0);
        assert.equal(await page.locator('.notice-strip-control').count(), 0);
        report.cases.push({ label: 'one-notice-long-replay-and-short-static', status: 'pass' });

        await open('&state=empty');
        assert.equal(await page.locator('.notice-strip').count(), 0);
        report.cases.push({ label: 'no-announcements-no-empty-strip', status: 'pass' });

        await page.emulateMedia({ reducedMotion: 'reduce' });
        await open();
        await page.locator('.notice-strip-track').waitFor();
        assert.equal(await track().evaluate(element => element.getAnimations().length), 0);
        assert.equal(await page.locator('.notice-strip-control').count(), 0);
        await page.locator('.notice-strip-open').click();
        await page.locator('.notice-detail-body').waitFor();
        assert.equal(
            (await page.locator('.notice-detail-body').innerText()).replace(/\s+/gu, ' '),
            firstContent,
        );
        report.cases.push({ label: 'reduced-motion-static-complete-detail-accessible', status: 'pass' });
    }

    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.setViewportSize({ width: 1440, height: 900 });
    await open();
    await waitAnimation();
    await seek(3200);
    await page.locator('.notice-strip-open').click();
    await page.locator('.notice-detail-body').waitFor();
    const detailPause = await animationState();
    await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
    await page.locator('.notice-detail-body').waitFor({ state: 'detached' });
    await page.mouse.move(0, 0);
    await page.waitForFunction(
        () => document.querySelector('.notice-strip-track')?.getAnimations()[0]?.playState === 'running',
    );
    await page.waitForTimeout(160);
    assert((await animationState()).x < detailPause.x - 2, 'Pointer-opened detail closes then resumes');
    report.cases.push({ label: 'pointer-detail-close-resumes-after-leaving-strip', status: 'pass' });

    await page.locator('.notice-strip-open').focus();
    await page.keyboard.press('Enter');
    await page.locator('.notice-detail-body').waitFor();
    await page.waitForFunction(() => Boolean(document.activeElement?.closest('[role="dialog"]')));
    await page.keyboard.press('Escape');
    await page.locator('.notice-detail-body').waitFor({ state: 'detached' });
    await page.waitForFunction(
        () => document.querySelector('.notice-strip-track')?.getAnimations()[0]?.playState === 'paused',
    );
    const keyboardPause = await animationState();
    await page.waitForTimeout(160);
    assert(
        Math.abs((await animationState()).x - keyboardPause.x) < 1,
        'Keyboard focus retains reading pause',
    );
    await page.keyboard.press('Tab');
    await page.waitForFunction(
        () => document.querySelector('.notice-strip-track')?.getAnimations()[0]?.playState === 'running',
    );
    report.cases.push({
        label: 'keyboard-detail-close-stays-paused-until-focus-leaves-reader',
        status: 'pass',
    });

    await open('&state=empty&legacyManual');
    assert.equal(await page.locator('.notice-strip').count(), 0);
    assert.equal(await page.getByText('旧装修手填公告（本地样本）', { exact: true }).count(), 0);
    report.cases.push({ label: 'legacy-manual-content-not-used-as-published-announcement', status: 'pass' });
    assert.deepEqual(report.errors, []);
} catch (error) {
    report.failure = String(error.stack || error);
    process.exitCode = 1;
} finally {
    await writeFile(
        `${output}/${focusOnly ? 'focus-report' : 'report'}.json`,
        JSON.stringify(report, null, 2),
    );
    await browser.close();
    process.stdout.write(
        JSON.stringify({ cases: report.cases.length, errors: report.errors, failure: report.failure }) + '\n',
    );
}
