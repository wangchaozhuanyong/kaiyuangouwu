import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
page.on('pageerror', error => writeDiagnostic('PAGEERROR', error.message));
page.on('console', message => {
    if (message.type() === 'error') writeDiagnostic('CONSOLE', message.text());
});
const source = fileURLToPath(new URL('./fixture.html', import.meta.url));
for (const view of ['home', 'referral', 'studio', 'support']) {
    await page.goto('http://127.0.0.1:5296/@fs' + source + '?view=' + view);
    await page.locator('.page').waitFor({ timeout: 30000 });
    await page.waitForTimeout(400);
    writeDiagnostic(
        view,
        await page.evaluate(() => ({
            height: document.body.scrollHeight,
            hasPage: document.querySelector('.page')?.className,
            error: document.querySelector('[role=alert]')?.textContent,
            body: document.body.innerText.slice(0, 200),
        })),
    );
    await page.screenshot({
        path: fileURLToPath(new URL(`./smoke-${view}.png`, import.meta.url)),
        fullPage: true,
    });
}
await browser.close();

function writeDiagnostic(...values) {
    process.stdout.write(
        values.map(value => (typeof value === 'string' ? value : JSON.stringify(value))).join(' ') + '\n',
    );
}
