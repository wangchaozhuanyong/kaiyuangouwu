import { chromium, expect } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { fixtureData } from './fixtures.mjs';

// Actual client routes with synthetic server responses; never sends a production write or charge.
const origin = process.env.CART_RECOVERY_PREVIEW_URL || 'http://127.0.0.1:5198';
const projectRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const output = process.env.CART_RECOVERY_OUTPUT_DIR
    ? resolve(process.env.CART_RECOVERY_OUTPUT_DIR)
    : resolve(projectRoot, 'artifacts/cart-recovery-20261008');
if (!output.startsWith(resolve(projectRoot) + sep)) throw new Error('Output must belong to this project.');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const onlyWidth = process.argv.find(argument => argument.startsWith('--width='))?.split('=')[1];
const onlyScenario = process.argv.find(argument => argument.startsWith('--scenario='))?.split('=')[1];
const language = process.argv.find(argument => argument.startsWith('--language='))?.split('=')[1] || 'zh';
const preset = process.argv.find(argument => argument.startsWith('--preset='))?.split('=')[1] || 'classic';
const isZh = language === 'zh';
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
            'buy-now-recovery',
            'checkout-recovery',
            'payment-recovery',
            'slow-payment-methods',
            'payment-methods-retry',
        ]) {
            if (onlyScenario && !onlyScenario.split(',').includes(scenario)) continue;
            const page = await browser.newPage({
                viewport: { width, height: 900 },
                locale: isZh ? 'zh-CN' : 'en-MY',
            });
            const fixture = structuredClone(fixtureData(preset));
            const cart = fixture.storefrontCart;
            const errors = [];
            const commands = [];
            const recoveries = [];
            const receipts = new Map();
            let recoverFails = scenario !== 'direct-purchase';
            let cartReadFails = false;
            let chargeRequests = 0;
            let cartReads = 0;
            let paymentMethodRequests = 0;
            let paymentMethodsResolved = false;
            let paymentMethodsFail = scenario === 'payment-methods-retry';
            let staleReadOnce = false;
            const timings = {};
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
                    if (query.includes('query EligibleStorefrontPaymentMethods')) {
                        paymentMethodRequests++;
                        if (paymentMethodsFail) return fail(route);
                        if (scenario === 'slow-payment-methods')
                            await new Promise(done => setTimeout(done, 10_000));
                        paymentMethodsResolved = true;
                        return route.fulfill({
                            json: {
                                data: {
                                    eligiblePaymentMethods:
                                        scenario === 'payment-methods-retry'
                                            ? [
                                                  {
                                                      id: 'synthetic-card',
                                                      code: 'synthetic-card',
                                                      name: 'Synthetic local method',
                                                      description: '',
                                                      isEligible: true,
                                                      eligibilityMessage: null,
                                                  },
                                              ]
                                            : [],
                                },
                            },
                        });
                    }
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
                        if (
                            (initial && scenario === 'acknowledged-read-failure') ||
                            (input.buyNow && scenario === 'buy-now-recovery') ||
                            (input.beginCheckout && scenario === 'checkout-recovery') ||
                            (input.preparePayment && scenario === 'payment-recovery')
                        )
                            cartReadFails = true;
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
                    if (query.includes('query StorefrontCart')) {
                        cartReads++;
                        if (staleReadOnce) {
                            staleReadOnce = false;
                            return route.fulfill({
                                json: {
                                    data: {
                                        ...fixture,
                                        storefrontCart: {
                                            ...cart,
                                            revision: cart.revision - 1,
                                            projectedRevision: cart.revision - 1,
                                        },
                                    },
                                },
                            });
                        }
                        if (cartReadFails) return fail(route);
                    }
                    return route.fulfill({ json: { data: fixture } });
                }
                if (!['127.0.0.1', 'localhost'].includes(url.hostname)) return route.abort();
                if (url.pathname.includes('storefront-realtime'))
                    return route.fulfill({ status: 204, body: '' });
                return route.continue();
            });
            const checkout = page.locator('.cart-checkout-bar > button');
            const reviewName = isZh ? '核对购物车' : 'Review cart';
            if (
                scenario === 'direct-purchase' ||
                scenario === 'buy-now-recovery' ||
                scenario === 'slow-payment-methods' ||
                scenario === 'payment-recovery' ||
                scenario === 'payment-methods-retry'
            ) {
                await page.goto(`${origin}/product?id=product-1`);
                await page.getByRole('button', { name: isZh ? '立即购买' : 'Buy now', exact: true }).click();
                if (scenario === 'buy-now-recovery') {
                    const review = page.getByRole('button', { name: reviewName, exact: true });
                    await expect(review).toBeEnabled({ timeout: 15000 });
                    expect(commands.filter(command => command.buyNow)).toHaveLength(1);
                    await review.click();
                    await expect(page).toHaveURL(/\/cart/);
                    await expect(page.locator('.cart-recovery-panel')).toBeVisible();
                    cartReadFails = false;
                    await review.click();
                }
                await expect(page).toHaveURL(/\/purchase/);
                await expect.poll(() => commands.some(command => command.buyNow)).toBe(true);
                const submit = page.getByRole('button', {
                    name: isZh ? /确认并支付|提交订单/ : /Confirm and pay|Place order/,
                });
                await expect(submit).toBeEnabled({
                    timeout: 15000,
                });
                const start = performance.now();
                await submit.click();
                if (scenario === 'payment-recovery') {
                    const reconcile = page.getByRole('button', {
                        name: isZh ? '重新核对购物车' : 'Reconcile cart',
                    });
                    await expect(reconcile).toBeEnabled();
                    const readsBefore = cartReads;
                    cartReadFails = false;
                    await reconcile.click();
                    await expect(page).toHaveURL(/\/payment/, { timeout: 15000 });
                    expect(cartReads - readsBefore).toBe(1);
                }
                await expect(page).toHaveURL(/\/payment/, { timeout: 15000 });
                await expect(page.locator('.payment-page')).toBeVisible();
                timings.submitToPaymentMs = Math.round(performance.now() - start);
                if (scenario === 'slow-payment-methods') {
                    expect(timings.submitToPaymentMs).toBeLessThan(5000);
                    expect(paymentMethodsResolved).toBe(false);
                    await expect(
                        page.getByText(isZh ? '正在加载支付方式' : 'Loading payment methods', {
                            exact: true,
                        }),
                    ).toBeVisible();
                    await expect.poll(() => paymentMethodsResolved, { timeout: 15000 }).toBe(true);
                    expect(paymentMethodRequests).toBe(1);
                }
                if (scenario === 'payment-methods-retry') {
                    const retry = page
                        .locator('.payment-method-section')
                        .getByRole('button', { name: isZh ? '重试' : 'Retry', exact: true });
                    await expect(retry).toBeEnabled({ timeout: 15000 });
                    const writesBeforeRetry = commands.length;
                    paymentMethodsFail = false;
                    await retry.click();
                    await expect.poll(() => paymentMethodsResolved).toBe(true);
                    await expect(retry).toHaveCount(0);
                    expect(commands).toHaveLength(writesBeforeRetry);
                }
                expect(commands.filter(command => command.buyNow)).toHaveLength(1);
                expect(commands.some(command => command.prepareShipping)).toBe(true);
                expect(commands.some(command => command.preparePayment)).toBe(true);
                expect(commands.filter(command => command.preparePayment)).toHaveLength(1);
            } else {
                await page.goto(`${origin}/cart`);
                await expect(checkout).toBeEnabled({ timeout: 15000 });
                if (scenario === 'checkout-recovery') await checkout.click();
                else
                    await page
                        .getByRole('button', {
                            name: isZh ? '增加 日常随行杯 数量' : 'Increase 日常随行杯 quantity',
                            exact: true,
                        })
                        .click();
                const review = page.getByRole('button', { name: reviewName, exact: true });
                await expect(review).toBeEnabled({ timeout: 15000 });
                await expect(checkout).toBeDisabled();
                await expect(page.locator('.cart-checkout-bar strong')).not.toHaveText('计算中…');
                expect(commands).toHaveLength(1);
                if (scenario === 'acknowledged-read-failure' || scenario === 'checkout-recovery') {
                    await expect(page.locator('.cart-recovery-panel')).toContainText(
                        isZh ? '操作结果已确认' : 'The result is confirmed',
                    );
                    await expect(
                        page.getByRole('button', {
                            name: isZh ? '取消待确认操作' : 'Cancel pending operation',
                            exact: true,
                        }),
                    ).toHaveCount(0);
                    await review.click();
                    await expect(review).toBeEnabled();
                    await expect(page.locator('.cart-recovery-panel')).toContainText(
                        isZh ? '操作结果已确认' : 'The result is confirmed',
                    );
                    // A stale first read must not unlock a newer, acknowledged command.
                    staleReadOnce = true;
                    cartReadFails = true;
                    await page.reload();
                    await expect(review).toBeEnabled();
                    await expect(page.locator('.cart-recovery-panel')).toContainText(
                        isZh ? '操作结果已确认' : 'The result is confirmed',
                    );
                }
                if (scenario === 'lost-response') {
                    await review.click();
                    await expect(review).toBeEnabled();
                    await expect(checkout).toBeDisabled();
                    // Failed receipt recovery retains the last confirmed view; it does not run an extra read.
                    await expect(page.locator('.cart-page .quantity-control output')).toHaveText('1');
                    await page.reload();
                    await expect(review).toBeEnabled();
                    expect(commands).toHaveLength(1);
                }
                await page.screenshot({
                    path: `${output}/${scenario}-${width}-${language}-${preset}-pending.png`,
                });
                if (scenario === 'cancel-not-found')
                    await page
                        .getByRole('button', {
                            name: isZh ? '取消待确认操作' : 'Cancel pending operation',
                            exact: true,
                        })
                        .click();
                else {
                    recoverFails = false;
                    cartReadFails = false;
                    await review.click();
                    if (scenario === 'checkout-recovery') {
                        await expect(page).toHaveURL(/\/checkout/);
                    }
                }
                if (scenario !== 'checkout-recovery') {
                    await expect(checkout).toBeEnabled();
                    await expect(page.locator('.cart-recovery-panel')).toHaveCount(0);
                    if (scenario === 'lost-response')
                        await expect(page.locator('.cart-page .quantity-control output')).toHaveText('2');
                }
                if (scenario === 'checkout-recovery')
                    expect(commands.filter(command => command.beginCheckout)).toHaveLength(1);
                else expect(commands).toHaveLength(1);
                if (scenario === 'cancel-not-found') expect(recoveries.some(call => call.cancel)).toBe(true);
                if (scenario !== 'checkout-recovery') await checkout.click();
                await expect(page).toHaveURL(/\/checkout/);
                await expect(page.locator('.checkout-page')).toBeVisible({ timeout: 15000 });
                await expect(
                    page.getByRole('button', {
                        name: isZh ? /确认并支付|提交订单/ : /Confirm and pay|Place order/,
                    }),
                ).toBeEnabled({ timeout: 15000 });
            }
            expect(chargeRequests).toBe(0);
            expect(errors).toEqual([]);
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
                true,
            );
            await page.screenshot({
                path: `${output}/${scenario}-${width}-${language}-${preset}-resolved.png`,
            });
            const result = {
                scenario,
                width,
                language,
                preset,
                clientEntryAsset: await page.evaluate(
                    () => document.querySelector('script[type="module"][src]')?.getAttribute('src') ?? null,
                ),
                commands: commands.map(command =>
                    Object.keys(command).filter(
                        key => !['commandId', 'cartId', 'expectedRevision'].includes(key),
                    ),
                ),
                recoveryCalls: recoveries.length,
                cartReads,
                paymentMethodRequests,
                timings,
                chargeRequests,
                pageErrors: errors,
                passed: true,
            };
            const previous = results.findIndex(
                item =>
                    item.width === width &&
                    item.scenario === scenario &&
                    item.language === language &&
                    item.preset === preset,
            );
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
