import { chromium, expect } from '@playwright/test';
import react from '@vitejs/plugin-react';
import { writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
const fixtureRequire = createRequire(
    new URL('../../../../packages/storefront/package.json', import.meta.url),
);
const { createElement } = fixtureRequire('react');
const { renderToStaticMarkup } = fixtureRequire('react-dom/server');
const out = fileURLToPath(new URL('.', import.meta.url));
const root = fileURLToPath(new URL('../../../../packages/storefront', import.meta.url));
const server = await createServer({
    configFile: false,
    root,
    plugins: [react()],
    resolve: { dedupe: ['react', 'react-dom'] },
    server: { middlewareMode: true },
});
const { SafeImage, SafeImageMediaProvider } = await server.ssrLoadModule('/src/safe-image.tsx');
const browser = await chromium.launch({ headless: true });
const report = {
    environment: 'Actual SafeImage SSR markup and production CSS. Browser runs no hydration JavaScript.',
    cases: [],
    errors: [],
};
try {
    const css = await (await fetch('http://127.0.0.1:5296/src/styles.css?direct')).text();
    for (const width of [320, 390, 768, 1024, 1440]) {
        const page = await browser.newPage({ viewport: { width, height: 600 }, javaScriptEnabled: false });
        const image =
            'data:image/svg+xml,' +
            encodeURIComponent(
                '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="#e53b40"/></svg>',
            );
        const preview =
            'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO6QZ1cAAAAASUVORK5CYII=';
        for (const hinted of [false, true]) {
            const descriptor = {
                identity: image,
                version: null,
                src: image,
                kind: 'icon',
                placeholder: { inlineData: preview },
            };
            const html = renderToStaticMarkup(
                createElement(
                    SafeImageMediaProvider,
                    { media: hinted ? [descriptor] : [] },
                    createElement(SafeImage, {
                        src: image,
                        alt: 'SSR paint',
                        imageKind: 'icon',
                        fetchPriority: 'high',
                        width: 96,
                        height: 96,
                    }),
                ),
            );
            await page.setContent(
                `<html><head><style>${css}</style></head><body><div style="width:96px;height:96px">${html}</div></body></html>`,
            );
            await expect(page.locator('img.safe-image')).toBeVisible();
            const state = await page.locator('img.safe-image').evaluate(img => ({
                complete: img.complete,
                loaded: img.classList.contains('is-loaded'),
                opacity: getComputedStyle(img).opacity,
                width: img.getBoundingClientRect().width,
                height: img.getBoundingClientRect().height,
                preview: document.querySelector('.safe-image-preview')?.getAttribute('src'),
            }));
            expect(state.complete).toBe(true);
            expect(state.loaded).toBe(false);
            expect(state.opacity).toBe('1');
            expect(state.width).toBe(96);
            expect(state.height).toBe(96);
            expect(Boolean(state.preview)).toBe(hinted);
            report.cases.push({ width, hinted, ...state });
            if (width === 390)
                await page.screenshot({ path: `${out}native-390-${hinted ? 'hint' : 'nohint'}.png` });
        }
        await page.close();
    }
} catch (error) {
    report.errors.push(error.stack ?? String(error));
} finally {
    await browser.close();
    await server.close();
    await writeFile(`${out}native-paint.json`, JSON.stringify(report, null, 2));
    process.stdout.write(
        JSON.stringify({ cases: report.cases.length, errors: report.errors }, null, 2) + '\n',
    );
}
if (report.errors.length) process.exitCode = 1;
