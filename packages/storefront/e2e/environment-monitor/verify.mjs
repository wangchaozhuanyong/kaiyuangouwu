import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
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
        const cleanup = page.getByRole('button', {
            name: en ? 'Remove relay API variables' : '删除中转 API 变量',
            exact: true,
        });
        const [externalBounds, cleanupBounds] = await Promise.all([
            externalCheck.boundingBox(),
            cleanup.boundingBox(),
        ]);
        assert.ok(Math.abs(externalBounds.y - cleanupBounds.y) < 1, 'tool buttons share a row');
        assert.ok(Math.abs(externalBounds.width - cleanupBounds.width) < 1, 'tool buttons have equal width');
        if (name === 'small-zh' || name === 'desktop-en') {
            await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], {
                origin: new URL(base).origin,
            });
            await cleanup.click();
            const guide = page.getByRole('dialog', {
                name: en ? 'Remove relay API variables' : '删除中转 API 变量',
            });
            await expect(guide).toBeVisible();
            await expect(guide).toContainText(
                en ? '1.1 Follow the Windows or Mac instructions' : '1.1 根据windows或者mac电脑流程操作',
            );
            await expect(
                guide.getByRole('heading', {
                    name: en ? '1.2 How to tell if cleanup worked' : '1.2 怎么样算干净',
                }),
            ).toBeVisible();
            await expect(guide).toContainText(
                en ? 'Compare your sign-in screen' : '可以查看自己登录界面窗口是否删除干净',
            );
            const examples = guide.locator('.environment-proxy-examples img');
            await expect(examples).toHaveCount(2);
            await expect
                .poll(() =>
                    examples.evaluateAll(images =>
                        images.every(image => image.complete && image.naturalWidth > 0),
                    ),
                )
                .toBe(true);
            await expect(guide.locator('a:not([download])')).toHaveCount(0);
            for (const [zhLabel, enLabel, command] of [
                [
                    '复制 Windows 执行权限命令',
                    'Copy Windows execution policy command',
                    'Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass',
                ],
                [
                    '复制 Windows 命令',
                    'Copy Windows command',
                    '& "$env:USERPROFILE\\Desktop\\clean-claude-proxy.ps1"',
                ],
                ['复制 Windows 登录命令', 'Copy Windows sign-in command', 'claude'],
                [
                    '复制 macOS 执行权限命令',
                    'Copy macOS execute permission command',
                    'chmod +x ~/Downloads/clean-claude-proxy.sh',
                ],
                ['复制 macOS 命令', 'Copy macOS command', '~/Downloads/clean-claude-proxy.sh'],
                ['复制 macOS Bash 命令', 'Copy macOS Bash command', 'bash ~/Downloads/clean-claude-proxy.sh'],
                ['复制 macOS 登录命令', 'Copy macOS sign-in command', 'claude'],
                ['复制退出命令', 'Copy sign-out command', '/logout'],
            ]) {
                await guide.getByRole('button', { name: en ? enLabel : zhLabel, exact: true }).click();
                await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(command);
            }
            for (const filename of ['clean-claude-proxy.ps1', 'clean-claude-proxy.sh']) {
                const download = guide.locator(`a[download="${filename}"]`);
                await expect(download).toHaveAttribute('href', `/tools/claude-proxy/${filename}`);
                const [file] = await Promise.all([page.waitForEvent('download'), download.click()]);
                assert.equal(file.suggestedFilename(), filename);
                assert.equal(await file.failure(), null);
                const source = new URL(`../../public/tools/claude-proxy/${filename}`, import.meta.url);
                assert.deepEqual(await readFile(await file.path()), await readFile(source));
            }
            assert.ok(await guide.evaluate(element => element.scrollWidth <= element.clientWidth + 1));
            await page.screenshot({ path: `${output}${name}-proxy-guide.png` });
            await page.keyboard.press('Escape');
            await expect(guide).toHaveCount(0);
            await expect(cleanup).toBeFocused();
        }
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
            const toolsBox = await page.locator('.environment-tool-actions').boundingBox();
            assert.ok(noticeBox.y >= primaryBox.y + primaryBox.height);
            assert.ok(toolsBox.y >= noticeBox.y + noticeBox.height);
            assert.ok(Math.abs(primaryBox.width - noticeBox.width) < 1);
            assert.ok(Math.abs(primaryBox.width - toolsBox.width) < 1);
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
