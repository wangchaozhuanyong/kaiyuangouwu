import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const directory = fileURLToPath(new URL('.', import.meta.url));
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ headless: true });
const measurements = [];
const errors = [];
try {
    for (const width of [390, 1440]) {
        const context = await browser.newContext({
            viewport: { width, height: width === 390 ? 844 : 1000 },
            hasTouch: width === 390,
        });
        const page = await context.newPage();
        page.on('pageerror', error => errors.push(error.message));
        await page.goto('http://127.0.0.1:5338/e2e/admin-layout/index.html?view=performance&light', {
            waitUntil: 'domcontentloaded',
        });
        await page.getByRole('button', { name: '准备 8 个干净页 + 2 个草稿', exact: true }).click();
        await expect(page.getByTestId('tour-state')).toHaveText('准备完成');
        await expect(page.getByTestId('cache-count')).toHaveText('挂载 10 · 干净 8 · 草稿 2');
        const samples = [];
        for (let run = 0; run < 20; run++) {
            const targetPage = run % 2 ? '12' : '11';
            const elapsed = await page.evaluate(async target => {
                const button = [...document.querySelectorAll('button')].find(
                    candidate => candidate.textContent.trim() === `第 ${target} 页`,
                );
                const start = performance.now();
                button.click();
                await new Promise(resolve => {
                    const ready = () => {
                        if (
                            document.querySelector(
                                `.admin-tab-page:not([hidden]) [data-performance-page="${target}"]`,
                            )
                        )
                            requestAnimationFrame(() => requestAnimationFrame(resolve));
                        else requestAnimationFrame(ready);
                    };
                    ready();
                });
                return performance.now() - start;
            }, targetPage);
            samples.push(elapsed);
        }
        const sorted = [...samples].sort((a, b) => a - b);
        const p95 = sorted[Math.ceil(samples.length * 0.95) - 1];
        expect(p95).toBeLessThan(150);
        await page.getByRole('button', { name: '第 1 页', exact: true }).click();
        await expect(page.getByRole('textbox', { name: '第 1 页草稿', exact: true })).toHaveValue(
            '作用域 A 未保存草稿 1',
        );
        await page.getByRole('button', { name: '打开页面弹层', exact: true }).click();
        await expect(page.getByRole('dialog', { name: '第 1 页弹层', exact: true })).toBeVisible();
        await page
            .getByRole('dialog', { name: '第 1 页弹层', exact: true })
            .getByRole('button', { name: '打开全局确认', exact: true })
            .click();
        await expect(
            page.getByRole('alertdialog', { name: '全局确认（本地模拟）', exact: true }),
        ).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(
            page.getByRole('alertdialog', { name: '全局确认（本地模拟）', exact: true }),
        ).toHaveCount(0);
        await expect(page.getByRole('dialog', { name: '第 1 页弹层', exact: true })).toBeVisible();
        await page.getByRole('button', { name: '暂存弹层并切至下一页', exact: true }).click();
        await expect(page.getByRole('dialog', { name: '第 1 页弹层', exact: true })).toBeHidden();
        await page.getByRole('button', { name: '第 1 页', exact: true }).click();
        await expect(page.getByRole('dialog', { name: '第 1 页弹层', exact: true })).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.getByRole('textbox', { name: '第 1 页草稿', exact: true })).toHaveValue(
            '作用域 A 未保存草稿 1',
        );
        await page.screenshot({ path: `${directory}/admin-performance-${width}.png` });
        await page.getByRole('button', { name: '确认切换作用域并清空本地草稿', exact: true }).click();
        await expect(page.getByRole('textbox', { name: '第 1 页草稿', exact: true })).toHaveValue(
            '作用域 B 第 1 页',
        );
        await expect(page.getByTestId('cache-count')).toHaveText('挂载 1 · 干净 1 · 草稿 0');
        await context.setOffline(true);
        await expect(page.getByText('网络已断开，已加载的内容仍可查看', { exact: true })).toBeVisible();
        await expect(page.getByRole('textbox', { name: '第 1 页草稿', exact: true })).toHaveValue(
            '作用域 B 第 1 页',
        );
        measurements.push({
            width,
            samplesMilliseconds: samples.map(value => Number(value.toFixed(2))),
            p95Milliseconds: Number(p95.toFixed(2)),
            retainedDirtyPages: 2,
            cleanCacheLimit: 8,
            hiddenOverlayPreserved: true,
            nestedEscapePreservedLowerLayer: true,
            scopeClearedDrafts: true,
            offlineContentRetained: true,
        });
        await context.close();
    }
    expect(errors).toEqual([]);
    await writeFile(
        `${directory}/admin-browser-check.json`,
        JSON.stringify(
            {
                at: new Date().toISOString(),
                source: 'actual public runtime components, Chromium, synthetic fixtures; no backend or business writes',
                measurements,
                errors,
            },
            null,
            2,
        ),
    );
    writeDiagnostic(JSON.stringify({ passed: measurements.length, measurements, errors }));
} finally {
    await browser.close();
}

function writeDiagnostic(...values) {
    process.stdout.write(
        values.map(value => (typeof value === 'string' ? value : JSON.stringify(value))).join(' ') + '\n',
    );
}
