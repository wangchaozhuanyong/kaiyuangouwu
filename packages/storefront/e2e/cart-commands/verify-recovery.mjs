import { chromium, expect } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { fixtureData } from './fixtures.mjs';

// Actual client routes with synthetic server responses; never sends a production write or charge.
const origin = process.env.CART_RECOVERY_PREVIEW_URL || 'http://127.0.0.1:5198';
const output = fileURLToPath(new URL('../../../../artifacts/cart-recovery-20261008/', import.meta.url));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const onlyWidth = process.argv.find(argument => argument.startsWith('--width='))?.split('=')[1];
const onlyScenario = process.argv.find(argument => argument.startsWith('--scenario='))?.split('=')[1];
const results =
    onlyWidth || onlyScenario
        ? await readFile(`${output}/browser-results.json`, 'utf8')
              .then(JSON.parse)
              .catch(() => [])
        : [];
try {
    for (const width of [320, 390, 1440]) {
        if (onlyWidth && width !== Number(onlyWidth)) continue;
        for (const scenario of [
            'lost-response',
            'cancel-not-found',
            'acknowledged-read-failure',
            'direct-purchase',
        ]) {
            if (onlyScenario && onlyScenario !== scenario) continue;
            const page = await browser.newPage({ viewport: { width, height: 900 }, locale: 'zh-CN' });
            const fixture = structuredClone(fixtureData('classic'));
            const cart = fixture.storefrontCart;
            const errors = [];
            const commands = [];
            const recoveries = [];
            const receipts = new Map();
            let recoverFails = scenario !== 'direct-purchase';
            let cartReadFails = false;
            let chargeRequests = 0;
            const methods = [
                {
                    id: 'delivery-1',
                    code: 'delivery',
                    name: '本地配送',
                    description: '',
                    priceWithTax: 800,
                    metadata: {},
                },
            ];
            fixture.eligibleShippingMethods = methods;
            fixture.activeCustomer.addresses = [
                {
                    id: 'address-1',
                    fullName: '本地测试用户',
                    phoneNumber: '0100000000',
                    streetLine1: 'Local QA address',
                    streetLine2: '',
                    city: 'Kuala Lumpur',
                    province: 'Kuala Lumpur',
                    postalCode: '50000',
                    defaultShippingAddress: true,
                    defaultBillingAddress: true,
                    country: { code: 'MY', name: 'Malaysia' },
                },
            ];
            page.on('pageerror', error => errors.push(error.message));
            const fail = route =>
                route.fulfill({
                    json: {
                        data: null,
                        errors: [
                            {
                                message: 'Synthetic read failure',
                                extensions: { code: 'INTERNAL_SERVER_ERROR' },
                            },
                        ],
                    },
                });
            const refresh = () => {
                const selected = cart.lines.filter(line => line.selected);
                cart.selectedQuantity = selected.reduce((sum, line) => sum + line.quantity, 0);
                cart.totalQuantity = cart.lines.reduce((sum, line) => sum + line.quantity, 0);
                cart.selectedLineCount = selected.length;
                cart.checkoutOrder.totalQuantity = cart.selectedQuantity;
                cart.checkoutOrder.subTotalWithTax = selected.reduce(
                    (sum, line) => sum + line.quantity * line.productVariant.priceWithTax,
                    0,
                );
                cart.checkoutOrder.totalWithTax =
                    cart.checkoutOrder.subTotalWithTax + cart.checkoutOrder.shippingWithTax;
                cart.checkoutOrder.lines[0].quantity = cart.lines[0].quantity;
                cart.checkoutOrder.lines[0].linePriceWithTax = cart.checkoutOrder.subTotalWithTax;
            };
            await page.route('**/*', async route => {
                const url = new URL(route.request().url());
                if (url.pathname === '/_storefront/page-data')
                    return route.fulfill({ status: 404, json: {} });
                if (url.pathname === '/shop-api') {
                    const { query = '', variables = {} } = route.request().postDataJSON() || {};
                    if (
                        query.includes('addPaymentToOrder') ||
                        query.includes('createStorefrontUsdtCheckoutQuote')
                    ) {
                        chargeRequests++;
                        return fail(route);
                    }
                    if (query.includes('mutation SetStorefrontPaymentCurrency'))
                        return route.fulfill({
                            json: { data: { setStorefrontPaymentCurrency: cart.checkoutOrder } },
                        });
                    if (query.includes('mutation ApplyStorefrontCartCommand')) {
                        const input = variables.input;
                        commands.push(input);
                        const initial = input.commandId === commands[0].commandId;
                        if (!receipts.has(input.commandId) && !(initial && scenario === 'cancel-not-found')) {
                            for (const update of input.changes?.lines || [])
                                Object.assign(
                                    cart.lines.find(line => line.id === update.lineId),
                                    update,
                                );
                            if (input.buyNow) cart.lines[0].quantity = input.buyNow.quantity;
                            if (input.prepareShipping || input.order?.shippingMethodId)
                                cart.checkoutOrder.shippingWithTax = 800;
                            if (input.preparePayment) {
                                cart.state = 'PAYMENT_PENDING';
                                cart.checkoutOrder.state = 'ArrangingPayment';
                            }
                            cart.revision++;
                            cart.projectedRevision = cart.revision;
                            refresh();
                            const session =
                                input.buyNow || input.beginCheckout || input.preparePayment
                                    ? {
                                          order: { id: cart.checkoutOrder.id },
                                          checkout: input.preparePayment
                                              ? {
                                                    id: 'checkout-1',
                                                    cartRevision: cart.revision,
                                                    state: 'PREPARED',
                                                    completedAt: null,
                                                }
                                              : null,
                                      }
                                    : null;
                            receipts.set(input.commandId, {
                                commandId: input.commandId,
                                status: 'APPLIED',
                                appliedRevision: cart.revision,
                                errorCode: null,
                                message: null,
                                cart: { id: cart.id, revision: cart.revision },
                                session,
                                shippingMethods: input.prepareShipping ? methods : null,
                                selectedShippingMethodId: input.prepareShipping ? 'delivery-1' : null,
                            });
                        }
                        if (initial && scenario === 'acknowledged-read-failure') cartReadFails = true;
                        if (initial && (scenario === 'lost-response' || scenario === 'cancel-not-found'))
                            return fail(route);
                        return route.fulfill({
                            json: { data: { applyStorefrontCartCommand: receipts.get(input.commandId) } },
                        });
                    }
                    if (query.includes('mutation RecoverStorefrontCartCommand')) {
                        recoveries.push(variables);
                        if (
                            recoverFails &&
                            !variables.cancel &&
                            variables.commandId === commands[0]?.commandId
                        )
                            return fail(route);
                        if (variables.cancel && !receipts.has(variables.commandId))
                            receipts.set(variables.commandId, {
                                commandId: variables.commandId,
                                status: 'CANCELLED',
                                appliedRevision: cart.revision,
                                errorCode: 'CART_COMMAND_CANCELLED',
                                message: null,
                                cart: { id: cart.id, revision: cart.revision },
                                session: null,
                            });
                        return route.fulfill({
                            json: {
                                data: { recoverStorefrontCartCommand: receipts.get(variables.commandId) },
                            },
                        });
                    }
                    if (query.includes('query StorefrontCart') && cartReadFails) return fail(route);
                    return route.fulfill({ json: { data: fixture } });
                }
                if (!['127.0.0.1', 'localhost'].includes(url.hostname)) return route.abort();
                if (url.pathname.includes('storefront-realtime'))
                    return route.fulfill({ status: 204, body: '' });
                return route.continue();
            });
            const checkout = page.locator('.cart-checkout-bar > button');
            if (scenario === 'direct-purchase') {
                await page.goto(`${origin}/product?id=product-1`);
                await page.getByRole('button', { name: '立即购买', exact: true }).click();
                await expect(page).toHaveURL(/\/purchase/);
                await expect.poll(() => commands.some(command => command.buyNow)).toBe(true);
                await expect(page.getByRole('button', { name: /确认并支付|提交订单/ })).toBeEnabled({
                    timeout: 15000,
                });
                await page.getByRole('button', { name: /确认并支付|提交订单/ }).click();
                await expect(page).toHaveURL(/\/payment/, { timeout: 15000 });
                expect(commands.filter(command => command.buyNow)).toHaveLength(1);
                expect(commands.some(command => command.prepareShipping)).toBe(true);
                expect(commands.some(command => command.preparePayment)).toBe(true);
            } else {
                await page.goto(`${origin}/cart`);
                await expect(checkout).toBeEnabled({ timeout: 15000 });
                await page.getByRole('button', { name: '增加 日常随行杯 数量', exact: true }).click();
                const review = page.getByRole('button', { name: '核对购物车', exact: true });
                await expect(review).toBeEnabled({ timeout: 15000 });
                await expect(checkout).toBeDisabled();
                await expect(page.locator('.cart-checkout-bar strong')).not.toHaveText('计算中…');
                expect(commands).toHaveLength(1);
                if (scenario === 'lost-response') {
                    await review.click();
                    await expect(review).toBeEnabled();
                    await expect(checkout).toBeDisabled();
                    await expect(page.locator('.cart-page .quantity-control output')).toHaveText('2');
                    await page.reload();
                    await expect(review).toBeEnabled();
                    expect(commands).toHaveLength(1);
                }
                await page.screenshot({ path: `${output}/${scenario}-${width}-pending.png` });
                if (scenario === 'cancel-not-found')
                    await page.getByRole('button', { name: '取消待确认操作', exact: true }).click();
                else {
                    recoverFails = false;
                    cartReadFails = false;
                    await review.click();
                }
                await expect(checkout).toBeEnabled();
                await expect(page.locator('.cart-recovery-panel')).toHaveCount(0);
                expect(commands).toHaveLength(1);
                if (scenario === 'acknowledged-read-failure') expect(recoveries).toHaveLength(0);
                if (scenario === 'cancel-not-found') expect(recoveries.some(call => call.cancel)).toBe(true);
                await checkout.click();
                await expect(page).toHaveURL(/\/checkout/);
            }
            expect(chargeRequests).toBe(0);
            expect(errors).toEqual([]);
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
                true,
            );
            await page.screenshot({ path: `${output}/${scenario}-${width}-resolved.png` });
            const result = {
                scenario,
                width,
                commands: commands.map(command =>
                    Object.keys(command).filter(
                        key => !['commandId', 'cartId', 'expectedRevision'].includes(key),
                    ),
                ),
                recoveryCalls: recoveries.length,
                chargeRequests,
                pageErrors: errors,
                passed: true,
            };
            const previous = results.findIndex(item => item.width === width && item.scenario === scenario);
            if (previous < 0) results.push(result);
            else results[previous] = result;
            process.stdout.write(JSON.stringify(result) + '\n');
            await page.close();
        }
    }
} finally {
    await browser.close();
    await writeFile(`${output}/browser-results.json`, JSON.stringify(results, null, 2));
}
