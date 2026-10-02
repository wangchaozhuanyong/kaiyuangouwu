import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const output = process.env.PREVIEW_TEST_OUTPUT;
if (!output?.startsWith('/')) throw new Error('Set an absolute project-owned PREVIEW_TEST_OUTPUT');
const base = process.env.PREVIEW_TEST_URL ?? 'http://127.0.0.1:5316';
const builtBase = process.env.STOREFRONT_BUILD_TEST_URL ?? 'http://127.0.0.1:5322';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors = [];
const receipts = [];
const watch = page => page.on('pageerror', error => errors.push(error.message));
const measure = (body, account) => {
    const doc = body.ownerDocument;
    const box = query => {
        const element = doc.querySelector(query);
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        const css = getComputedStyle(element);
        return {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            objectFit: css.objectFit,
            position: css.position,
        };
    };
    const selector = account ? '.account-identity-artwork img' : '.hero-rich-backdrop';
    const image = doc.querySelector(selector);
    return {
        viewport: doc.defaultView.innerWidth,
        image: box(selector),
        imageFrame: box(account ? '.account-identity-artwork' : '.hero-rich-image-link'),
        native: { width: image.naturalWidth, height: image.naturalHeight },
        copy: box('.hero-rich-content'),
        trust: box('.hero-service-overlay'),
        media: box('.hero-rich-media'),
        identity: box('.account-identity-card'),
        gallery: box('.quick-grid'),
        pagerCount: doc.querySelectorAll('.hero-carousel-controls').length,
        overflow: doc.documentElement.scrollWidth - doc.defaultView.innerWidth,
    };
};
const completeArtwork = result => {
    expect(result.image.objectFit).toBe('contain');
    expect(
        Math.abs(result.image.height - (result.image.width * result.native.height) / result.native.width),
    ).toBeLessThan(1);
    expect(result.overflow).toBeLessThanOrEqual(1);
    expect(Math.abs(result.imageFrame.height - result.image.height)).toBeLessThan(1);
};
const inside = (child, parent) => {
    expect(child.x).toBeGreaterThanOrEqual(parent.x - 1);
    expect(child.y).toBeGreaterThanOrEqual(parent.y - 1);
    expect(child.x + child.width).toBeLessThanOrEqual(parent.x + parent.width + 1);
    expect(child.y + child.height).toBeLessThanOrEqual(parent.y + parent.height + 1);
};
try {
    const admin = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' });
    const client = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
    const builtClient = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
    let builtData;
    await builtClient.route('**/shop-api**', route => route.fulfill({ json: builtData }));
    await builtClient.route('**/storefront-realtime**', route => route.fulfill({ status: 204 }));
    await builtClient.route('**/assets/*carousel.svg*', async route => {
        const path = new URL(route.request().url()).pathname;
        const response = await fetch(`${base}${path}`);
        await route.fulfill({ contentType: 'image/svg+xml', body: await response.text() });
    });
    watch(admin);
    watch(client);
    watch(builtClient);
    await admin.goto(`${base}/e2e/carousel/index.html?parity&managedImages&gallery&preset=neo-minimalist`);
    const preview = admin.getByRole('region', { name: '客户端装修预览', exact: true });
    await expect(preview.frameLocator('iframe').locator('.hero-rich-backdrop')).toHaveJSProperty(
        'naturalWidth',
        1600,
    );
    for (const account of [false, true]) {
        if (account) await preview.getByLabel('预览页面').selectOption('/account');
        const frame = preview.frameLocator('iframe[title="客户端装修效果"]');
        for (const width of [1440, 390]) {
            const mobile = width < 1024;
            await preview.getByRole('button', { name: mobile ? '手机' : '电脑', exact: true }).click();
            await expect
                .poll(() => frame.locator('body').evaluate(body => body.ownerDocument.defaultView.innerWidth))
                .toBe(width);
            await client.setViewportSize({ width, height: mobile ? 844 : 900 });
            await client.goto(
                `${base}/${account ? 'account' : ''}?parityClient&managedImages&gallery&preset=neo-minimalist${account ? '&accountArtwork' : ''}`,
            );
            const imageSelector = account ? '.account-identity-artwork img' : '.hero-rich-backdrop';
            await expect(client.locator(imageSelector)).toHaveJSProperty('naturalWidth', 1600);
            await expect(frame.locator(imageSelector)).toHaveJSProperty('naturalWidth', 1600);
            builtData = await client.evaluate(async () => (await fetch('/shop-api')).json());
            await builtClient.setViewportSize({ width, height: mobile ? 844 : 900 });
            await builtClient.goto(`${builtBase}/${account ? 'account' : ''}`);
            await expect(builtClient.locator(imageSelector)).toHaveJSProperty('naturalWidth', 1600);
            const actual = await client.locator('body').evaluate(measure, account);
            const draft = await frame.locator('body').evaluate(measure, account);
            const productionArtifact = await builtClient.locator('body').evaluate(measure, account);
            completeArtwork(actual);
            completeArtwork(draft);
            completeArtwork(productionArtifact);
            expect(draft.viewport).toBe(width);
            for (const dimension of ['width', 'height']) {
                expect(Math.abs(draft.image[dimension] - actual.image[dimension])).toBeLessThan(1);
                expect(Math.abs(draft.image[dimension] - productionArtifact.image[dimension])).toBeLessThan(
                    1,
                );
            }
            if (account) {
                expect(actual.identity.y).toBeGreaterThanOrEqual(actual.image.y + actual.image.height - 1);
                expect(actual.identity.y - actual.image.y - actual.image.height).toBeLessThanOrEqual(16);
                await expect(client.locator('.account-identity-promotion')).toBeVisible();
                await expect(frame.locator('.account-identity-promotion')).toBeVisible();
                await expect(builtClient.locator('.account-identity-promotion')).toBeVisible();
                if (mobile) {
                    await expect(frame.locator('.account-service-grid')).toHaveCSS('display', 'grid');
                    await expect(builtClient.locator('.account-service-grid')).toHaveCSS('display', 'grid');
                }
                await expect(client.getByRole('heading', { name: '我的订单', exact: true })).toBeVisible();
            } else {
                inside(actual.trust, actual.media);
                inside(draft.trust, draft.media);
                if (mobile) {
                    expect(
                        Math.abs(
                            actual.trust.x + actual.trust.width / 2 - actual.media.x - actual.media.width / 2,
                        ),
                    ).toBeLessThan(1);
                    expect(actual.copy.y).toBeGreaterThanOrEqual(actual.media.y + actual.media.height - 1);
                    expect(actual.pagerCount).toBe(0);
                } else {
                    expect(actual.trust.x - actual.media.x).toBeLessThan(50);
                    expect(actual.gallery.x).toBeGreaterThan(actual.media.x + actual.media.width);
                    expect(actual.copy.y + actual.copy.height).toBeLessThanOrEqual(actual.trust.y - 4);
                }
            }
            const name = `${account ? 'account' : 'home'}-${mobile ? 'mobile' : 'desktop'}`;
            await client.screenshot({ path: `${output}/${name}-client.png`, fullPage: true });
            await preview.screenshot({ path: `${output}/${name}-admin.png` });
            await builtClient.screenshot({
                path: `${output}/${name}-production-artifact.png`,
                fullPage: true,
            });
            receipts.push({ name, client: actual, admin: draft, productionArtifact });
        }
    }
    expect(errors).toEqual([]);
    await writeFile(
        `${output}/managed-images-parity.json`,
        JSON.stringify({ receipts, errors, realStoreWrites: 0, realTransactions: 0 }, null, 2),
    );
    process.stdout.write('Complete artwork, responsive composition and Admin/client parity passed.\n');
} finally {
    await browser.close();
}
