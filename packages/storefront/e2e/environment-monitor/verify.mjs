import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const output = fileURLToPath(new URL('../../../../reports/environment-monitor-20261101/', import.meta.url));
await mkdir(output, { recursive: true });
const base = 'http://127.0.0.1:5193/e2e/environment-monitor/';
const browser = await chromium.launch({ headless: true });
const evidence = [];
try {
    for (const [name, width, query] of [
        ['mobile-zh', 390, '?fail&slow'],
        ['small-zh', 320, ''],
        ['mobile-en', 390, '?en&skin=neo-minimalist'],
        ['desktop-zh', 1440, ''],
        ['desktop-en', 1180, '?en&skin=neo-minimalist'],
        ['mobile-basic-zh', 390, '?basic'],
        ['desktop-basic-en', 1440, '?en&basic'],
        ['mobile-ipqs-zh', 390, '?ipqs'],
        ['mobile-ipv6-zh', 390, '?ipv6'],
        ['desktop-ipv6-en', 1440, '?ipv6&en&skin=neo-minimalist'],
        ['mobile-dual-zh', 360, '?dual'],
    ]) {
        const page = await browser.newPage({
            viewport: { width, height: 900 },
            timezoneId: 'Asia/Kuala_Lumpur',
            locale: 'zh-CN',
        });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        const en = new URLSearchParams(query.replace(/^\?/, '')).has('en');
        await page.goto(`${base}${query}`);
        await expect(
            page.getByRole('button', { name: en ? 'Start check' : '开始检测', exact: true }),
        ).toBeVisible();
        const actionStyle = await page.locator('.environment-primary').evaluate(node => {
            const css = getComputedStyle(node);
            return { background: css.backgroundColor, foreground: css.color };
        });
        assert.notEqual(
            actionStyle.background,
            'rgba(0, 0, 0, 0)',
            'primary action uses the actual skin accent',
        );
        assert.notEqual(actionStyle.background, actionStyle.foreground, 'primary action text is visible');
        assert.equal(await page.evaluate(() => document.documentElement.dataset.networkCalls), undefined);
        await expect(page.locator('.environment-ipv6-notice')).toHaveCount(0);
        const externalCheck = page.getByRole('link', {
            name: en ? 'Claude AI IP check' : 'Claude AI IP 检测',
            exact: true,
        });
        await expect(externalCheck).toHaveAttribute('href', 'https://ip.net.coffee/claude/');
        await expect(externalCheck).toHaveAttribute('target', '_blank');
        await expect(externalCheck).toHaveAttribute('rel', 'noopener noreferrer');
        await page.screenshot({ path: `${output}${name}-initial.png`, fullPage: true });
        const heading = await page.locator('.environment-network .environment-section-heading').boundingBox();
        const status = await page
            .locator('.environment-network .environment-section-heading > .environment-state')
            .boundingBox();
        assert.ok(status.x > heading.x + heading.width / 2, 'status stays on the right');
        await expect(page.getByRole('switch')).toHaveCount(0);
        await page.getByRole('button', { name: en ? 'Start check' : '开始检测', exact: true }).click();
        await expect(
            page.getByRole('button', { name: en ? 'Check again' : '重新检测', exact: true }),
        ).toBeEnabled();
        const score = page.locator('.environment-gauge-value strong');
        await expect(score).not.toHaveText('—');
        if (query.includes('ipv6') || query.includes('dual')) {
            const notice = page.locator('.environment-ipv6-notice');
            await expect(notice).toBeVisible();
            await expect(notice).toContainText(en ? 'IPv6 was detected' : '当前为 IPv6 环境');
            await expect(notice.getByRole('link')).toHaveAttribute(
                'href',
                'https://ip.net.coffee/claude/ipv6.html',
            );
            const primaryBox = await page.locator('.environment-primary').boundingBox();
            const noticeBox = await notice.boundingBox();
            const externalBox = await externalCheck.boundingBox();
            assert.ok(noticeBox.y >= primaryBox.y + primaryBox.height);
            assert.ok(externalBox.y >= noticeBox.y + noticeBox.height);
            assert.ok(Math.abs(primaryBox.width - noticeBox.width) < 1);
            assert.ok(Math.abs(primaryBox.width - externalBox.width) < 1);
        } else {
            await expect(page.locator('.environment-ipv6-notice')).toHaveCount(0);
        }
        if (query.includes('fail')) {
            await expect(page.getByRole('button', { name: '仅重试网络', exact: true })).toBeVisible();
            const original = await score.innerText();
            await page.evaluate(() => scrollTo(0, 0));
            await page.screenshot({ path: `${output}${name}-network-failure.png`, fullPage: true });
            await page.getByRole('button', { name: '仅重试网络', exact: true }).click();
            await expect(
                page.locator('.environment-network-rows').filter({ hasText: 'Test network provider' }),
            ).toBeVisible();
            assert.equal(await score.innerText(), original);
        } else if (!query.includes('basic')) {
            await expect(
                page.locator('.environment-network-rows').filter({ hasText: 'Test network provider' }),
            ).toBeVisible();
        }
        const report = page.locator('.environment-network');
        if (query.includes('basic')) {
            await expect(report).toContainText('198.51.100.24');
            await expect(page.locator('.environment-network-score-line')).toContainText(
                en ? 'Unknown' : '未知',
            );
            await expect(
                page.getByRole('button', { name: en ? 'Retry network only' : '仅重试网络', exact: true }),
            ).toBeVisible();
        } else {
            await expect(page.locator('.environment-network-score-line')).toContainText('0');
            await expect(report).toContainText(en ? 'Unknown' : '未知');
            await expect(report).toContainText(query.includes('ipqs') ? 'IPQS' : 'IP-DB');
        }
        await expect(page.locator('.environment-check-card')).toHaveCount(12);
        await page.locator('.environment-check-card summary').nth(1).click();
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
        assert.ok(overflow <= 1, `No horizontal overflow (${name}): ${overflow}`);
        const rows = await page
            .locator('.environment-network-row dd')
            .evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().right));
        assert.ok(Math.max(...rows) - Math.min(...rows) < 1, 'detail values share right rail');
        await page.evaluate(() => scrollTo(0, 0));
        await page.screenshot({ path: `${output}${name}-results.png`, fullPage: true });
        assert.deepEqual(errors, []);
        const calls = await page.evaluate(() => Number(document.documentElement.dataset.networkCalls));
        await page.reload();
        await expect(
            page.getByRole('button', { name: en ? 'Start check' : '开始检测', exact: true }),
        ).toBeVisible();
        assert.equal(
            await page.evaluate(() => document.documentElement.dataset.networkCalls),
            undefined,
            'reload must not query network',
        );
        evidence.push({
            name,
            width,
            overflow,
            calls,
            result: 'passed',
            source: query.includes('basic')
                ? 'real browser collector + synthetic connection metadata'
                : query.includes('ipqs')
                  ? 'real browser collector + synthetic IPQS transport'
                  : 'real browser collector + synthetic IPDB transport',
        });
        await page.close();
    }
    await writeFile(`${output}browser-results.json`, JSON.stringify(evidence, null, 2) + '\n');
    process.stdout.write(JSON.stringify(evidence) + '\n');
} finally {
    await browser.close();
}
