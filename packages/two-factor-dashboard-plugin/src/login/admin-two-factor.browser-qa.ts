import { expect as browserExpect, chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'vite';

import { totpAtStep } from './admin-two-factor.crypto';

/** Mount the actual changed React components against the real isolated Vendure API. */
export async function runAdminTwoFactorBrowserQa(apiUrl: string, username: string, password: string) {
    const root = path.resolve(__dirname, '../../../next-admin');
    const html = `<!doctype html><html lang="zh-CN"><head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head><body><div id="root"></div><script type="module">
        import React from 'react';
        import { createRoot } from 'react-dom/client';
        import { ApolloProvider } from '@apollo/client/react';
        import { BrowserRouter, Routes, Route } from 'react-router-dom';
        import { client } from '/src/apollo.ts';
        import { LoginModule } from '/src/pages/Auth/LoginModule.tsx';
        import { TwoFactorSecurityCard } from '/src/pages/Auth/TwoFactorSecurityCard.tsx';
        import { ThemeProvider } from '/src/theme/ThemeProvider.tsx';
        import '/src/index.css';
        const h = React.createElement;
        createRoot(document.getElementById('root')).render(h(ApolloProvider,{client},h(ThemeProvider,null,h(BrowserRouter,null,h(Routes,null,
            h(Route,{path:'/login',element:h(LoginModule)}),
            h(Route,{path:'/dashboard',element:h('main',{style:{maxWidth:800,margin:'32px auto',padding:16}},h(TwoFactorSecurityCard))})
        )))));
    </script></body></html>`;
    const vite = await createServer({
        root,
        configFile: path.join(root, 'vite.config.ts'),
        define: { 'import.meta.env.VITE_VENDURE_ADMIN_API_URL': JSON.stringify('/admin-api') },
        server: { host: '127.0.0.1', port: 0, proxy: { '/admin-api': new URL(apiUrl).origin } },
        plugins: [
            {
                name: 'isolated-admin-security-browser-fixture',
                configureServer(server) {
                    server.middlewares.use((req, res, next) => {
                        const requestUrl = req.url ?? '';
                        if (!['/login', '/dashboard'].includes(requestUrl)) return next();
                        res.setHeader('Content-Type', 'text/html');
                        void server
                            .transformIndexHtml(requestUrl, html)
                            .then(result => res.end(result))
                            .catch(next);
                    });
                },
            },
        ],
    });
    await vite.listen();
    const address = vite.httpServer?.address();
    if (!address || typeof address === 'string') throw new Error('Browser fixture did not start');
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const runtimeErrors: string[] = [];
    page.on('pageerror', error => runtimeErrors.push(error.message));
    const screenshotDir = process.env.ADMIN_2FA_QA_OUTPUT_DIR;
    const snapshot = async (name: string) => {
        if (!screenshotDir) return;
        await mkdir(screenshotDir, { recursive: true });
        await page.screenshot({ path: path.join(screenshotDir, name), fullPage: true });
    };
    try {
        await page.goto(`http://127.0.0.1:${address.port}/login`);
        await page.getByLabel('管理员账号', { exact: true }).fill(username);
        await page.getByLabel('登录密码', { exact: true }).fill(password);
        await page.getByRole('button', { name: '进入管理后台', exact: true }).click();
        await browserExpect(page.getByText('未开启', { exact: true })).toBeVisible();
        await page.getByRole('button', { name: '开启 2FA', exact: true }).click();
        await page.getByLabel('当前登录密码', { exact: true }).fill(password);
        await page.getByRole('button', { name: '下一步', exact: true }).click();
        await browserExpect(page.getByRole('img', { name: '用于添加后台登录验证器的二维码' })).toBeVisible();
        const secret = await page.locator('code').textContent();
        if (!secret) throw new Error('Setup secret was not rendered');
        await page
            .getByLabel('新验证器的 6 位动态码', { exact: true })
            .fill(totpAtStep(secret, Math.floor(Date.now() / 30000)));
        await page.getByRole('button', { name: '确认绑定', exact: true }).click();
        await browserExpect(page.getByRole('heading', { name: '请保存一次性恢复码' })).toBeVisible();
        const recoveryCodes = await page.getByRole('listitem').allTextContents();
        browserExpect(recoveryCodes).toHaveLength(10);
        browserExpect(
            await page.evaluate(() => JSON.stringify(localStorage) + JSON.stringify(sessionStorage)),
        ).not.toContain(secret);
        const download = page.waitForEvent('download');
        await page.getByRole('button', { name: '下载恢复码' }).click();
        browserExpect((await download).suggestedFilename()).toBe('vendure-2fa-recovery-codes.txt');
        await page.getByRole('checkbox', { name: '我已妥善保存恢复码' }).check();
        await page.getByRole('button', { name: '返回登录', exact: true }).click();
        await page.getByLabel('管理员账号', { exact: true }).fill(username);
        await page.getByLabel('登录密码', { exact: true }).fill(password);
        await page.getByRole('button', { name: '进入管理后台', exact: true }).click();
        await browserExpect(page.getByLabel('验证器 2FA 动态码', { exact: true })).toBeVisible();
        await page.setViewportSize({ width: 390, height: 844 });
        browserExpect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
            true,
        );
        await snapshot('login-two-factor-mobile.png');
        await page.getByRole('button', { name: '使用一次性恢复码', exact: true }).click();
        await page.getByLabel('一次性恢复码', { exact: true }).fill(recoveryCodes[0]);
        await page.getByRole('button', { name: '验证并登录', exact: true }).click();
        await browserExpect(page.getByText('已开启', { exact: true })).toBeVisible();
        await browserExpect(page.getByText('剩余恢复码：9 个')).toBeVisible();
        await snapshot('account-security-mobile.png');
        await page.setViewportSize({ width: 1280, height: 900 });
        await snapshot('account-security-desktop.png');
        await page.getByRole('button', { name: '关闭 2FA', exact: true }).click();
        await page.getByLabel('当前登录密码', { exact: true }).fill(password);
        await page.getByLabel('2FA 动态码或一次性恢复码', { exact: true }).fill(recoveryCodes[1]);
        await page.getByRole('button', { name: '确认关闭并退出登录' }).click();
        await browserExpect(page.getByLabel('管理员账号', { exact: true })).toBeVisible();
        browserExpect(runtimeErrors).toEqual([]);
    } finally {
        await browser.close();
        await vite.close();
    }
}
