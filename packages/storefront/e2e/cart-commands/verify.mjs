import { chromium, expect, webkit } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { fixtureData } from './fixtures.mjs';

const output = fileURLToPath(new URL('../../../../artifacts/cart-commands/', import.meta.url));
await mkdir(output, { recursive: true });
const results = [];
for (const [engine, browserType] of [
    ['chromium', chromium],
    ['webkit', webkit],
]) {
    const browser = await browserType.launch({ headless: true });
    try {
        for (const latency of [1200, 3000]) {
            const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'zh-CN' });
            const fixture = structuredClone(fixtureData('classic'));
            const cart = fixture.storefrontCart;
            const template = cart.lines[0];
            cart.lines = ['商品一', '商品二', '商品三', '商品四'].map((name, index) => ({
                ...structuredClone(template),
                id: `line-${index}`,
                quantity: index + 1,
                selected: true,
                productVariant: {
                    ...structuredClone(template.productVariant),
                    id: `variant-${index}`,
                    name,
                    customFields: { fulfillmentType: 'digital' },
                    product: { ...template.productVariant.product, name },
                },
            }));
            const refresh = () => {
                const selected = cart.lines.filter(line => line.selected);
                cart.totalQuantity = cart.lines.reduce((sum, line) => sum + line.quantity, 0);
                cart.selectedQuantity = selected.reduce((sum, line) => sum + line.quantity, 0);
                cart.selectedLineCount = selected.length;
                cart.selectionState = !selected.length
                    ? 'NONE'
                    : selected.length === cart.lines.length
                      ? 'ALL'
                      : 'PARTIAL';
                cart.checkoutOrder.totalWithTax = selected.reduce(
                    (sum, line) => sum + line.quantity * line.productVariant.priceWithTax,
                    0,
                );
                cart.checkoutOrder.subTotalWithTax = cart.checkoutOrder.totalWithTax;
            };
            refresh();
            let active = 0;
            let maxConcurrent = 0;
            let failNext = false;
            let loseNext = false;
            let holdNext = false;
            const commands = [];
            const receipts = new Map();
            const errors = [];
            const injectedNetworkErrors = [];
            let expectedNetworkFaults = 0;
            page.on('pageerror', error => {
                if (
                    expectedNetworkFaults > 0 &&
                    error.message.includes('127.0.0.1:5198/shop-api') &&
                    error.message.endsWith('due to access control checks.')
                ) {
                    expectedNetworkFaults--;
                    injectedNetworkErrors.push(error.message);
                } else errors.push(error.message);
            });
            await page.route('**/*', async route => {
                const url = new URL(route.request().url());
                if (url.pathname.includes('shop-api')) {
                    const { query, variables } = route.request().postDataJSON() ?? {};
                    if (query?.includes('mutation ApplyStorefrontCartCommand')) {
                        const input = variables.input;
                        commands.push(input);
                        active++;
                        maxConcurrent = Math.max(maxConcurrent, active);
                        await new Promise(resolve => setTimeout(resolve, latency));
                        const status = failNext ? 'REJECTED' : 'APPLIED';
                        failNext = false;
                        if (!receipts.has(input.commandId)) {
                            if (status === 'APPLIED') {
                                const changes = input.changes ?? {};
                                for (const update of changes.lines ?? [])
                                    Object.assign(
                                        cart.lines.find(line => line.id === update.lineId),
                                        update,
                                    );
                                cart.lines = cart.lines.filter(line => !changes.remove?.includes(line.id));
                                cart.revision++;
                                cart.projectedRevision = cart.revision;
                                refresh();
                            }
                            receipts.set(input.commandId, {
                                commandId: input.commandId,
                                status,
                                appliedRevision: cart.revision,
                                errorCode: status === 'REJECTED' ? 'CART_INPUT_REJECTED' : null,
                                message: status === 'REJECTED' ? '测试库存不足' : null,
                            });
                        }
                        active--;
                        if (holdNext) {
                            expectedNetworkFaults++;
                            holdNext = false;
                            await new Promise(resolve => setTimeout(resolve, 2000));
                            return route.abort('failed');
                        }
                        if (loseNext) {
                            expectedNetworkFaults++;
                            loseNext = false;
                            return route.abort('failed');
                        }
                        return route.fulfill({
                            json: {
                                data: {
                                    applyStorefrontCartCommand: {
                                        ...receipts.get(input.commandId),
                                        cart,
                                        session: null,
                                    },
                                },
                            },
                        });
                    }
                    if (query?.includes('mutation RecoverStorefrontCartCommand')) {
                        return route.fulfill({
                            json: {
                                data: {
                                    recoverStorefrontCartCommand: {
                                        commandId: variables.commandId,
                                        status: 'NOT_FOUND',
                                        appliedRevision: null,
                                        errorCode: null,
                                        message: null,
                                        ...receipts.get(variables.commandId),
                                        cart,
                                        session: null,
                                    },
                                },
                            },
                        });
                    }
                    return route.fulfill({ json: { data: fixture } });
                }
                if (!['127.0.0.1', 'localhost'].includes(url.hostname)) return route.abort();
                if (url.pathname.includes('storefront-realtime'))
                    return route.fulfill({ status: 204, body: '' });
                return route.continue();
            });
            await page.goto('http://127.0.0.1:5198/cart');
            const checkbox = page.locator('.cart-line input[type=checkbox]').first();
            const toggle = page.locator('.cart-line .round-check').first();
            const checkout = page.locator('.cart-checkout-bar > button');
            await expect(checkbox).toBeChecked();
            const timings = [];
            for (let index = 0; index < 20; index++) {
                const start = performance.now();
                await toggle.click();
                await expect(checkbox).toBeChecked({ checked: index % 2 === 1 });
                timings.push(performance.now() - start);
            }
            await expect(checkout).toBeDisabled();
            await expect(page.locator('.cart-checkout-bar strong')).toHaveText('计算中…');
            await page.screenshot({
                animations: 'disabled',
                path: `${output}/${engine}-${latency}-pending.png`,
            });
            await expect(checkout).toBeEnabled({ timeout: 20000 });
            expect(cart.lines[0].selected).toBe(true);
            expect(maxConcurrent).toBe(1);
            expect(commands.length).toBeLessThan(20);
            const increment = page.getByRole('button', { name: '增加 商品一 数量', exact: true });
            const quantityStart = performance.now();
            await increment.click();
            await expect(page.locator('.cart-line').first().locator('.cart-line-actions span')).toHaveText(
                '2',
            );
            const quantityFeedbackMs = performance.now() - quantityStart;
            await expect(increment).toBeEnabled();
            await expect(checkout).toBeEnabled({ timeout: 20000 });
            expect(cart.lines[0].quantity).toBe(2);
            failNext = true;
            await toggle.click();
            await expect(checkbox).not.toBeChecked();
            await expect(checkbox).toBeChecked({ timeout: 20000 });
            await expect(checkout).toBeEnabled();
            loseNext = true;
            const countBeforeLoss = commands.length;
            await toggle.click();
            await expect(checkout).toBeEnabled({ timeout: 20000 });
            await expect(checkbox).not.toBeChecked();
            expect(commands.length).toBe(countBeforeLoss + 1);
            // Refresh recovers from the persisted identity using the server receipt and never resends the command body.
            holdNext = true;
            await toggle.click();
            await expect.poll(() => commands.length).toBe(countBeforeLoss + 2);
            await expect.poll(() => cart.lines[0].selected, { timeout: 20000 }).toBe(true);
            await page.reload();
            await expect(checkbox).toBeChecked({ timeout: 20000 });
            await expect(checkout).toBeEnabled({ timeout: 20000 });
            await page.getByRole('button', { name: '减少 商品一 数量', exact: true }).click();
            await expect(page.locator('.cart-line').first().locator('.cart-line-actions span')).toHaveText(
                '1',
            );
            const deletionStart = performance.now();
            await page.getByRole('button', { name: '减少 商品一 数量并删除商品', exact: true }).click();
            await expect(page.locator('.cart-line')).toHaveCount(3);
            const deletionFeedbackMs = performance.now() - deletionStart;
            await expect(checkout).toBeEnabled({ timeout: 20000 });
            expect(cart.lines).toHaveLength(3);
            expect(maxConcurrent).toBe(1);
            timings.sort((a, b) => a - b);
            expect(errors).toEqual([]);
            expect(timings[18]).toBeLessThanOrEqual(100);
            expect(timings[19]).toBeLessThanOrEqual(200);
            expect(quantityFeedbackMs).toBeLessThanOrEqual(100);
            expect(deletionFeedbackMs).toBeLessThanOrEqual(100);
            const result = {
                engine,
                viewport: '390x844',
                simulatedApiLatencyMs: latency,
                feedbackP95Ms: Math.round(timings[18]),
                feedbackP99Ms: Math.round(timings[19]),
                quantityFeedbackMs: Math.round(quantityFeedbackMs),
                deletionFeedbackMs: Math.round(deletionFeedbackMs),
                maxConcurrent,
                commandCount: commands.length,
                continuousClicks: 20,
                pageErrors: errors,
                injectedNetworkErrors,
            };
            results.push(result);
            process.stdout.write(JSON.stringify(result) + '\n');
            await page.screenshot({
                animations: 'disabled',
                path: `${output}/${engine}-${latency}-confirmed.png`,
            });
            await page.close();
        }
    } finally {
        await browser.close();
    }
}
await writeFile(`${output}/browser-results.json`, JSON.stringify(results, null, 2));
