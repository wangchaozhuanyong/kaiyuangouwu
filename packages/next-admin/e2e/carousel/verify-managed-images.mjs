import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const output = process.env.PREVIEW_TEST_OUTPUT;
if (!output?.startsWith('/')) throw new Error('Set an absolute project-owned PREVIEW_TEST_OUTPUT');
const base = process.env.PREVIEW_TEST_URL ?? 'http://127.0.0.1:5316';
const builtBase = process.env.STOREFRONT_BUILD_TEST_URL ?? 'http://127.0.0.1:5322';
const scenario = process.env.HERO_COPY_SCENARIO ?? 'long-copy';
const scenarioQuery =
    scenario === 'stats' ? '&heroStats' : scenario === 'tall-stats' ? '&heroStats&tallHero' : '';
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
    const copyElements = Array.from(
        doc.querySelectorAll(
            '.hero-rich-pill, .hero-rich-pill svg, .hero-rich-title, .hero-rich-desc, .hero-rich-cta-btn, .hero-stat-badge .stat-num, .hero-stat-badge .stat-lbl',
        ),
    ).map(element => {
        const rect = element.getBoundingClientRect();
        const plain = r => ({ x: r.x, y: r.y, width: r.width, height: r.height });
        const glyphs = [];
        const walker = doc.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
            if (!walker.currentNode.textContent.trim()) continue;
            const range = doc.createRange();
            range.selectNodeContents(walker.currentNode);
            glyphs.push(...Array.from(range.getClientRects(), plain));
        }
        return {
            tag: element.classList.value,
            text: element.textContent,
            box: plain(rect),
            glyphs,
            fontSize: getComputedStyle(element).fontSize,
        };
    });
    return {
        viewport: doc.defaultView.innerWidth,
        image: box(selector),
        imageFrame: box(account ? '.account-identity-artwork' : '.hero-rich-image-link'),
        native: { width: image.naturalWidth, height: image.naturalHeight },
        copy: box('.hero-rich-content'),
        scene: box('.hero'),
        copyLayout: doc.querySelector('.hero-scene-wrapper')?.getAttribute('data-copy-layout'),
        copyElements,
        statsCount: doc.querySelectorAll('.hero-stat-badge').length,
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
const readableCopy = result => {
    for (const text of [
        'FLASH CAST · HOME & LIVING',
        '为马来西亚的家，甄选舒适好物',
        '从卧室、客厅到餐厅与书房，为日常空间挑选耐看、实用的家具与家居。',
        '浏览家具',
    ]) {
        expect(result.copyElements.some(element => element.text === text)).toBe(true);
    }
    for (const element of result.copyElements) {
        inside(element.box, result.copy);
        inside(element.box, result.scene);
        for (const glyph of element.glyphs) {
            inside(glyph, result.copy);
            inside(glyph, result.scene);
        }
        if (result.copyLayout === 'overlay') {
            inside(element.box, result.media);
            expect(element.box.y + element.box.height).toBeLessThanOrEqual(result.trust.y - 4);
        }
    }
    if (result.copyLayout === 'below')
        expect(result.copy.y).toBeGreaterThanOrEqual(result.media.y + result.media.height - 1);
    expect(result.statsCount).toBe(scenario === 'long-copy' ? 0 : 8);
    expect(result.copyElements.find(element => element.tag === 'hero-rich-title').fontSize).toBe(
        result.viewport >= 1024 ? '36px' : '24px',
    );
    expect(result.copyElements.find(element => element.tag === 'hero-rich-desc').fontSize).toBe(
        result.viewport >= 1024 ? '15px' : '13px',
    );
};
try {
    const admin = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' });
    const client = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
    const builtClient = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
    let builtData;
    await builtClient.route('**/shop-api**', route => route.fulfill({ json: builtData }));
    await builtClient.route('**/storefront-realtime**', route => route.fulfill({ status: 204 }));
    await builtClient.route('**/assets/*carousel.svg*', async route => {
        const url = new URL(route.request().url());
        const path = url.pathname + url.search;
        const response = await fetch(`${base}${path}`);
        await route.fulfill({ contentType: 'image/svg+xml', body: await response.text() });
    });
    watch(admin);
    watch(client);
    watch(builtClient);
    await admin.goto(
        `${base}/e2e/carousel/index.html?parity&managedImages&gallery&preset=neo-minimalist${scenarioQuery}`,
    );
    const preview = admin.getByRole('region', { name: '客户端装修预览', exact: true });
    await expect(preview.frameLocator('iframe').locator('.hero-rich-backdrop')).toHaveJSProperty(
        'naturalWidth',
        1600,
    );
    for (const account of scenario === 'long-copy' ? [false, true] : [false]) {
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
                `${base}/${account ? 'account' : ''}?parityClient&managedImages&gallery&preset=neo-minimalist${scenarioQuery}${account ? '&accountArtwork' : ''}`,
            );
            const imageSelector = account ? '.account-identity-artwork img' : '.hero-rich-backdrop';
            await expect(client.locator(imageSelector)).toHaveJSProperty('naturalWidth', 1600);
            await expect(frame.locator(imageSelector)).toHaveJSProperty('naturalWidth', 1600);
            builtData = await client.evaluate(async () => (await fetch('/shop-api')).json());
            await builtClient.setViewportSize({ width, height: mobile ? 844 : 900 });
            await builtClient.goto(`${builtBase}/${account ? 'account' : ''}`);
            await expect(builtClient.locator(imageSelector)).toHaveJSProperty('naturalWidth', 1600);
            for (const body of [client.locator('body'), frame.locator('body'), builtClient.locator('body')]) {
                await body.evaluate(element => element.ownerDocument.fonts.ready);
            }
            if (!account) {
                const layout = !mobile && scenario === 'tall-stats' ? 'overlay' : 'below';
                for (const wrapper of [
                    client.locator('.hero-scene-wrapper'),
                    frame.locator('.hero-scene-wrapper'),
                    builtClient.locator('.hero-scene-wrapper'),
                ]) {
                    await expect(wrapper).toHaveAttribute('data-copy-layout', layout);
                }
            }
            const actual = await client.locator('body').evaluate(measure, account);
            const draft = await frame.locator('body').evaluate(measure, account);
            const productionArtifact = await builtClient.locator('body').evaluate(measure, account);
            const name = `${scenario}-${account ? 'account' : 'home'}-${mobile ? 'mobile' : 'desktop'}`;
            const receipt = { name, client: actual, admin: draft, productionArtifact };
            // Persist geometry and screenshots even when a subsequent glyph assertion fails.
            await writeFile(`${output}/${name}-measurements.json`, JSON.stringify(receipt, null, 2));
            await client.screenshot({ path: `${output}/${name}-client.png`, fullPage: true });
            await preview.screenshot({ path: `${output}/${name}-admin.png` });
            await builtClient.screenshot({
                path: `${output}/${name}-production-artifact.png`,
                fullPage: true,
            });
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
                for (const result of [actual, draft, productionArtifact]) {
                    inside(result.trust, result.media);
                    readableCopy(result);
                    expect(result.copyLayout).toBe(
                        !mobile && scenario === 'tall-stats' ? 'overlay' : 'below',
                    );
                }
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
                }
            }
            receipts.push(receipt);
        }
    }
    expect(errors).toEqual([]);
    await writeFile(
        `${output}/${scenario}-parity.json`,
        JSON.stringify({ receipts, errors, realStoreWrites: 0, realTransactions: 0 }, null, 2),
    );
    process.stdout.write('Complete artwork, responsive composition and Admin/client parity passed.\n');
} finally {
    await browser.close();
}
