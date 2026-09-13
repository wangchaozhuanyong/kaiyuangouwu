import { chromium, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

export async function verifyImageStudioApi({ backendOrigin, credentials, referencePath, outputDirectory }) {
    const storefront = fileURLToPath(new URL('../..', import.meta.url));
    const vite = await createServer({
        root: storefront,
        configFile: path.join(storefront, 'vite.config.ts'),
        define: {
            'import.meta.env.VITE_CLIENT_CHANNEL_SWITCHING': JSON.stringify('false'),
            'import.meta.env.VITE_SHOP_API_URL': JSON.stringify('/shop-api'),
        },
        server: {
            host: '127.0.0.1',
            port: 5186,
            strictPort: true,
            proxy: { '/shop-api': backendOrigin, '/image-generation': backendOrigin },
        },
    });
    let browser;
    let page;
    const observed = { operations: [], errors: [], createdIds: [], uploads: [] };
    try {
        await vite.listen();
        browser = await chromium.launch({ headless: true });
        page = await browser.newPage({
            viewport: { width: 1365, height: 1000 },
            acceptDownloads: true,
        });
        await page.addInitScript(value => {
            window.studioBootstrap = value;
        }, credentials);
        page.on('pageerror', error => observed.errors.push(error.message));
        page.on('response', async response => {
            if (!new URL(response.url()).pathname.endsWith('/shop-api')) return;
            try {
                const body = await response.json();
                if (body.errors) observed.errors.push(...body.errors.map(error => error.message));
                const data = body.data ?? {};
                observed.operations.push(...Object.keys(data).filter(key => key !== 'login'));
                if (data.createImageGeneration) observed.createdIds.push(data.createImageGeneration.id);
                if (data.uploadImageReference) observed.uploads.push(data.uploadImageReference.id);
            } catch {
                /* Navigations may abort unrelated reads. */
            }
        });
        await page.goto('http://127.0.0.1:5186/e2e/ai-image-studio/index.html');
        await expect(page.getByRole('button', { name: /付费优化/ })).toBeVisible({ timeout: 20000 });
        await page.locator('input[type="file"]').first().setInputFiles(referencePath);
        await expect(page.getByText('上传成功', { exact: true })).toBeVisible();
        await page.locator('textarea').first().fill('提取图1中的袋装咖啡做商品图，保留包装，去除人物和背景');
        await page.getByRole('button', { name: /付费优化/ }).click();
        await expect(page.getByRole('status').first()).toContainText('本次费用');
        await expect(page.locator('textarea').first()).toHaveValue(/袋装咖啡/);
        await expect(page.getByRole('button', { name: '开始生成', exact: true })).toBeEnabled();
        await page.getByRole('button', { name: '开始生成', exact: true }).click();
        await expect(page.locator('article .ai-generation-status').first()).toHaveText('成功', {
            timeout: 30000,
        });
        await page.screenshot({
            path: path.join(outputDirectory, 'browser-integrated-desktop.png'),
            animations: 'disabled',
        });
        await page.getByRole('button', { name: '查看生成详情', exact: true }).first().click();
        const downloadEvent = page.waitForEvent('download');
        await page.getByRole('button', { name: '下载', exact: true }).last().click();
        const download = await downloadEvent;
        expect(await download.failure()).toBeNull();
        const downloadPath = path.join(outputDirectory, 'browser-integrated-download.png');
        await download.saveAs(downloadPath);
        await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
        await page.getByRole('button', { name: '再次创作', exact: true }).first().click();
        await page
            .locator('textarea')
            .first()
            .fill((await page.locator('textarea').first().inputValue()) + '，背景改为浅灰色');
        await expect(page.getByRole('button', { name: '开始生成', exact: true })).toBeEnabled();
        await page.getByRole('button', { name: '开始生成', exact: true }).click();
        await expect(page.locator('article .ai-generation-status')).toHaveText(['成功', '成功'], {
            timeout: 30000,
        });
        await page.setViewportSize({ width: 390, height: 844 });
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({
            path: path.join(outputDirectory, 'browser-integrated-mobile.png'),
            animations: 'disabled',
        });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
        expect(observed.errors).toEqual([]);
        expect(observed.createdIds).toHaveLength(2);
        expect(observed.uploads).toHaveLength(1);
        for (const operation of [
            'activeCustomer',
            'uploadImageReference',
            'optimizeImagePrompt',
            'previewImageGenerationPrompt',
            'createImageGeneration',
            'myImageGenerationJob',
            'imageStudioWallet',
        ]) {
            expect(observed.operations).toContain(operation);
        }
        const result = {
            ...observed,
            mode: 'real Chromium + ShopApi + GraphQL + MySQL + private storage; provider mocked',
            downloadPath,
        };
        await writeFile(
            path.join(outputDirectory, 'browser-integrated-result.json'),
            JSON.stringify(result, null, 2) + '\n',
        );
        return result;
    } catch (error) {
        await writeFile(
            path.join(outputDirectory, 'browser-integrated-failure.json'),
            JSON.stringify(
                {
                    message: error.message,
                    errors: observed.errors,
                    body: await page
                        ?.locator('body')
                        .innerText()
                        .catch(() => ''),
                },
                null,
                2,
            ),
        );
        await page
            ?.screenshot({ path: path.join(outputDirectory, 'browser-integrated-failure.png') })
            .catch(() => undefined);
        throw error;
    } finally {
        await browser?.close();
        await vite.close();
    }
}
