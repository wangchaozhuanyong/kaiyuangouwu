import { chromium, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const output = fileURLToPath(new URL('.', import.meta.url));
const source = fileURLToPath(new URL('./fixture.html', import.meta.url));
const browser = await chromium.launch({ headless: true });
const report = {
    environment:
        'Local actual production React components; synthetic business data; no production writes. Safe area and keyboard geometry are simulated.',
    cases: [],
    errors: [],
};
const near = (a, b) => Math.abs(a - b) <= 1;
const checks = (label, values) => {
    for (const [name, pass] of Object.entries(values)) if (!pass) report.errors.push(`${label}: ${name}`);
};
try {
    for (const width of [320, 390, 768, 1024, 1440])
        for (const preset of ['classic', 'neo-minimalist'])
            for (const lang of ['zh', 'en'])
                for (const store of ['a', 'b']) {
                    const context = await browser.newContext({
                        viewport: { width, height: width < 1024 ? 844 : 900 },
                        hasTouch: width < 1024,
                        reducedMotion: 'reduce',
                    });
                    await context.addInitScript(() => {
                        window.__shareCalls = 0;
                        Object.defineProperty(navigator, 'canShare', {
                            configurable: true,
                            value: () => true,
                        });
                        Object.defineProperty(navigator, 'share', {
                            configurable: true,
                            value: () => {
                                window.__shareCalls++;
                                return Promise.reject(new DOMException('Cancelled', 'AbortError'));
                            },
                        });
                    });
                    const page = await context.newPage();
                    const label = `${width}/${preset}/${lang}/${store}`;
                    page.on('pageerror', error => report.errors.push(`${label}: ${error.message}`));
                    page.on('console', message => {
                        if (message.type() === 'error')
                            report.errors.push(`${label}: ${message.text().slice(0, 500)}`);
                    });
                    for (const view of ['home', 'referral', 'studio', 'support']) {
                        await page.goto(
                            `http://127.0.0.1:5296/@fs${source}?view=${view}&skin=${preset}&lang=${lang}&store=${store}`,
                        );
                        const selector =
                            view === 'home'
                                ? '.hero-carousel'
                                : view === 'referral'
                                  ? '.referral-overview'
                                  : view === 'studio'
                                    ? '.ai-studio-fixed-generate'
                                    : '.support-channel-row';
                        await page.locator(selector).waitFor({ timeout: 15000 });
                        await page.evaluate(
                            () =>
                                new Promise(resolve =>
                                    requestAnimationFrame(() => requestAnimationFrame(resolve)),
                                ),
                        );
                        const common = await page.evaluate(() => ({
                            overflow: document.documentElement.scrollWidth > innerWidth + 1,
                            paddingBottom: parseFloat(
                                getComputedStyle(document.querySelector('.page')).paddingBottom,
                            ),
                            clearance: document
                                .querySelector('.page')
                                .style.getPropertyValue('--page-bottom-measured-clearance'),
                        }));
                        checks(`${label}/${view}`, { noHorizontalOverflow: !common.overflow });
                        const result = { label, view, ...common };
                        if (view === 'home') {
                            const geometry = await page.evaluate(() => {
                                const hero = document.querySelector('.hero');
                                const active = document.querySelector(
                                    '.hero-carousel-slide:not(.is-neighbor)',
                                );
                                const controls = active.querySelector('.hero-overlay-controls');
                                const first = document.querySelector('.homepage-modules');
                                const quick = document.querySelector('.quick-grid');
                                const h = hero.getBoundingClientRect();
                                const c = controls.getBoundingClientRect();
                                return {
                                    buttons: [...controls.querySelectorAll('button')].map(b => ({
                                        width: b.getBoundingClientRect().width,
                                        height: b.getBoundingClientRect().height,
                                    })),
                                    right: h.right - c.right,
                                    bottom: h.bottom - c.bottom,
                                    top: hero.getBoundingClientRect().top - first.getBoundingClientRect().top,
                                    after: quick
                                        ? quick.getBoundingClientRect().top -
                                          document.querySelector('.hero-carousel').getBoundingClientRect()
                                              .bottom
                                        : null,
                                    gap: parseFloat(getComputedStyle(first).gap),
                                };
                            });
                            result.geometry = geometry;
                            checks(`${label}/home`, {
                                ordinaryGap: near(geometry.gap, width < 1024 ? 16 : 24),
                                controls44: geometry.buttons.every(b => b.width >= 44 && b.height >= 44),
                                mobileRight: width >= 1024 || near(geometry.right, 12),
                                mobileBottom: width >= 1024 || near(geometry.bottom, 12),
                                mobileTopGap: width >= 1024 || near(geometry.top, 16),
                                mobileAfterGap: width >= 1024 || near(geometry.after, 16),
                            });
                            await page
                                .locator('.hero-carousel-slide:not(.is-neighbor) .hero-page-picker button')
                                .nth(2)
                                .click();
                            await expect(
                                page
                                    .locator(
                                        '.hero-carousel-slide:not(.is-neighbor) .hero-page-picker button',
                                    )
                                    .nth(2),
                            ).toHaveAttribute('aria-current', 'true');
                        } else if (view === 'referral') {
                            const colors = await page.evaluate(() =>
                                Object.fromEntries(
                                    ['invite', 'overview', 'records'].map(name => {
                                        const el = document.querySelector(`.referral-${name}`);
                                        const style = getComputedStyle(el);
                                        return [
                                            name,
                                            {
                                                background: style.backgroundColor,
                                                color: style.color,
                                                padding: parseFloat(style.paddingTop),
                                            },
                                        ];
                                    }),
                                ),
                            );
                            result.colors = colors;
                            checks(`${label}/referral`, {
                                forestInvite: colors.invite.background === 'rgb(23, 61, 57)',
                                adaptedReward:
                                    colors.overview.background ===
                                    (preset === 'classic' ? 'rgb(244, 241, 233)' : 'rgb(36, 59, 54)'),
                                campaignRecords: colors.records.background === colors.overview.background,
                                cardPadding:
                                    colors.invite.padding === (width < 1024 ? 16 : 24) &&
                                    colors.overview.padding === (width < 1024 ? 16 : 24),
                            });
                        } else if (view === 'studio') {
                            const bar = await page.locator('.ai-studio-fixed-generate').evaluate(el => ({
                                height: el.getBoundingClientRect().height,
                                position: getComputedStyle(el).position,
                            }));
                            result.bar = bar;
                            checks(`${label}/studio`, {
                                sharedBottomGap: near(
                                    common.paddingBottom,
                                    bar.position === 'fixed' ? bar.height + 16 : 16,
                                ),
                            });
                            if (width < 1024) {
                                await page.evaluate(() => {
                                    document.documentElement.style.setProperty('--safe-bottom', '34px');
                                    window.dispatchEvent(new Event('resize'));
                                });
                                await page.evaluate(
                                    () =>
                                        new Promise(resolve =>
                                            requestAnimationFrame(() => requestAnimationFrame(resolve)),
                                        ),
                                );
                                await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
                                const safe = await page.evaluate(() => {
                                    const safeBar = document.querySelector('.ai-studio-fixed-generate');
                                    const panel = document.querySelector('.ai-studio-create-panel');
                                    const last = panel
                                        .querySelector('.ai-studio-terms-row')
                                        .closest('section');
                                    return {
                                        height: safeBar.getBoundingClientRect().height,
                                        padding: parseFloat(
                                            getComputedStyle(document.querySelector('.page')).paddingBottom,
                                        ),
                                        gap:
                                            safeBar.getBoundingClientRect().top -
                                            last.getBoundingClientRect().bottom,
                                    };
                                });
                                result.safeArea = safe;
                                checks(`${label}/studio/safe`, {
                                    oneSafeArea: near(safe.height, 110),
                                    sharedPadding: near(safe.padding, safe.height + 16),
                                    lastContentGap: near(safe.gap, 16),
                                });
                                await page.locator('textarea').focus();
                                await page.evaluate(() => {
                                    Object.defineProperty(visualViewport, 'height', {
                                        configurable: true,
                                        value: innerHeight - 300,
                                    });
                                    visualViewport.dispatchEvent(new Event('resize'));
                                });
                                await page.evaluate(
                                    () =>
                                        new Promise(resolve =>
                                            requestAnimationFrame(() => requestAnimationFrame(resolve)),
                                        ),
                                );
                                const keyboard = await page.evaluate(() => ({
                                    offset: getComputedStyle(document.documentElement).getPropertyValue(
                                        '--storefront-viewport-bottom-offset',
                                    ),
                                    padding: parseFloat(
                                        getComputedStyle(document.querySelector('.page')).paddingBottom,
                                    ),
                                }));
                                result.keyboard = keyboard;
                                checks(`${label}/studio/keyboard`, {
                                    keyboardOffset: parseFloat(keyboard.offset) === 300,
                                    noExtraDocumentPadding: near(keyboard.padding, safe.padding),
                                });
                                await page.evaluate(() => {
                                    document.activeElement.blur();
                                    delete visualViewport.height;
                                    visualViewport.dispatchEvent(new Event('resize'));
                                });
                                await page.evaluate(
                                    () =>
                                        new Promise(resolve =>
                                            requestAnimationFrame(() => requestAnimationFrame(resolve)),
                                        ),
                                );
                            }
                            await page.getByRole('tab').nth(1).click();
                            await page.locator('.ai-studio-history').waitFor();
                            await page.evaluate(
                                () =>
                                    new Promise(resolve =>
                                        requestAnimationFrame(() => requestAnimationFrame(resolve)),
                                    ),
                            );
                            result.history = await page.locator('.page').evaluate(el => ({
                                padding: parseFloat(getComputedStyle(el).paddingBottom),
                                clearance: el.style.getPropertyValue('--page-bottom-measured-clearance'),
                            }));
                            checks(`${label}/studio/history`, {
                                noPhantomBar: near(result.history.padding, 16),
                                noFixedClearance: result.history.clearance === '0px',
                            });
                        } else {
                            await page.locator('.support-channel-row[data-channel="wechat"]').click();
                            const dialog = page.getByRole('dialog');
                            await dialog.waitFor();
                            await dialog.locator('.support-qr-frame img').waitFor();
                            const qr = await dialog.evaluate(el => {
                                const img = el.querySelector('.support-qr-frame img');
                                return {
                                    overflow: el.scrollWidth > el.clientWidth + 1,
                                    imgSrc: img.getAttribute('src'),
                                    callout: getComputedStyle(img).webkitTouchCallout,
                                    locked: document.body.style.overflow,
                                    focused: el.contains(document.activeElement),
                                };
                            });
                            result.qr = qr;
                            checks(`${label}/support`, {
                                noDialogOverflow: !qr.overflow,
                                originalImage: qr.imgSrc.startsWith('data:image'),
                                focusInside: qr.focused,
                                scrollLocked: qr.locked === 'hidden',
                            });
                            if (width < 1024) {
                                await expect(dialog.locator('.support-qr-save')).toBeEnabled();
                                await dialog.locator('.support-qr-save').click();
                                await expect(dialog.locator('.support-qr-save-result')).toContainText(
                                    lang === 'zh' ? '分享已关闭' : 'Share closed',
                                );
                                checks(`${label}/support/share`, {
                                    oneGesture: await page.evaluate(() => window.__shareCalls === 1),
                                });
                            } else {
                                await expect(dialog.locator('.support-qr-save')).toContainText(
                                    lang === 'zh' ? '下载' : 'Download',
                                );
                            }
                            if (
                                (store === 'a' && lang === 'zh' && preset === 'classic') ||
                                (store === 'b' &&
                                    lang === 'en' &&
                                    preset === 'neo-minimalist' &&
                                    [390, 1440].includes(width))
                            )
                                await page.screenshot({
                                    path: `${output}accepted-${width}-${preset}-${lang}-${store}-qr.png`,
                                });
                            await page.keyboard.press('Escape');
                            await expect(dialog).toHaveCount(0);
                            await expect(
                                page.locator('.support-channel-row[data-channel="wechat"]'),
                            ).toBeFocused();
                            checks(`${label}/support/close`, {
                                scrollReleased: await page.evaluate(
                                    () => document.body.style.overflow !== 'hidden',
                                ),
                                focusReturned: await page
                                    .locator('.support-channel-row[data-channel="wechat"]')
                                    .evaluate(el => el === document.activeElement),
                            });
                        }
                        if (
                            (store === 'a' && lang === 'zh' && preset === 'classic') ||
                            (store === 'b' &&
                                lang === 'en' &&
                                preset === 'neo-minimalist' &&
                                [390, 1440].includes(width))
                        )
                            await page.screenshot({
                                path: `${output}accepted-${width}-${preset}-${lang}-${store}-${view}.png`,
                                fullPage: true,
                            });
                        report.cases.push(result);
                    }
                    await context.close();
                }
} catch (error) {
    report.errors.push(error.stack ?? String(error));
} finally {
    await browser.close();
    await writeFile(`${output}browser-matrix.json`, JSON.stringify(report, null, 2));
    writeDiagnostic(JSON.stringify({ cases: report.cases.length, errors: report.errors }, null, 2));
}
if (report.errors.length) process.exitCode = 1;

function writeDiagnostic(...values) {
    process.stdout.write(
        values.map(value => (typeof value === 'string' ? value : JSON.stringify(value))).join(' ') + '\n',
    );
}
