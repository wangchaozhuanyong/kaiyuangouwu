/** Isolated browser fixtures. Bind localhost only; never forwards a request or charges a customer. */
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { fixtureData } from './fixtures.mjs';

const dist = fileURLToPath(new URL('../../dist/', import.meta.url));
const port = Number(process.env.CART_RECOVERY_PORT || 5198);
const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.svg': 'image/svg+xml',
    '.json': 'application/json',
};
let scenario;
let fixture;
let customer;
let receipts;
let commands;
let recoveryCalls;
let reads;
let payments;
let transientReads;
let blockedReads;
function reset(name, preset = 'classic') {
    scenario = name;
    fixture = structuredClone(fixtureData(preset));
    customer = fixture.activeCustomer;
    if (name === 'login') fixture.activeCustomer = null;
    const address = {
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
    };
    customer.addresses = [address];
    fixture.eligibleShippingMethods = [
        {
            id: 'delivery-1',
            code: 'delivery',
            name: '本地配送',
            description: '',
            priceWithTax: 800,
            metadata: {},
        },
    ];
    fixture.eligiblePaymentMethods = [
        {
            id: 'local-payment',
            code: 'local-fixture',
            name: '本地模拟支付（无真实收费）',
            description: 'Synthetic fixture only',
            isEligible: true,
            eligibilityMessage: null,
        },
    ];
    // Another cart item must survive buy-now but must not appear in its checkout order.
    fixture.storefrontCart.lines.push({
        ...structuredClone(fixture.storefrontCart.lines[0]),
        id: 'other-cart-line',
        quantity: 2,
        productVariant: { ...structuredClone(fixture.product.variants[0]), id: 'other-variant' },
    });
    fixture.storefrontCart.totalQuantity = 3;
    if (name === 'digital') {
        const order = fixture.storefrontCart.checkoutOrder;
        fixture.product.customFields.fulfillmentType = 'digital';
        fixture.product.variants[0].customFields.fulfillmentType = 'digital';
        fixture.storefrontCart.lines[0].productVariant.customFields.fulfillmentType = 'digital';
        order.lines[0].customFields.fulfillmentTypeSnapshot = 'digital';
        order.checkoutFulfillment = {
            fulfillmentType: 'DIGITAL',
            containsPhysicalProducts: false,
            containsDigitalProducts: true,
            requiresShippingAddress: false,
            requiresShippingMethod: false,
        };
        fixture.myDeliveryEmails = [{ id: 'email-1', emailAddress: 'qa@example.invalid', isDefault: true }];
    }
    receipts = new Map();
    commands = [];
    recoveryCalls = 0;
    reads = 0;
    payments = 0;
    transientReads = 0;
    blockedReads = false;
}
reset('normal');
function json(res, value, status = 200) {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(value));
}
const failure = res =>
    json(res, {
        data: null,
        errors: [
            { message: 'Synthetic cart detail read failure', extensions: { code: 'INTERNAL_SERVER_ERROR' } },
        ],
    });
const server = createServer(async (req, res) => {
    try {
        const url = new URL(req.url, `http://127.0.0.1:${port}`);
        if (url.searchParams.has('qaScenario') && url.searchParams.get('qaScenario') !== scenario)
            reset(url.searchParams.get('qaScenario'), url.searchParams.get('qaPreset') || 'classic');
        if (url.pathname === '/_qa/state')
            return json(res, {
                scenario,
                commands: commands.map(c => ({
                    id: c.commandId,
                    buyNow: c.buyNow,
                    beginCheckout: c.beginCheckout,
                    preparePayment: c.preparePayment,
                })),
                recoveryCalls,
                reads,
                simulatedPayments: payments,
                cart: fixture.storefrontCart,
            });
        if (url.pathname === '/_qa/resolve') {
            blockedReads = false;
            res.writeHead(303, { location: '/_qa/controls' });
            return res.end();
        }
        if (url.pathname === '/_qa/controls') {
            res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
            return res.end(
                '<h1>本地购买恢复测试</h1><form method="post" action="/_qa/resolve"><button>恢复详情读取</button></form><a href="/_qa/state">测试状态</a>',
            );
        }
        if (url.pathname === '/_storefront/page-data') return json(res, {}, 404);
        if (url.pathname.includes('storefront-realtime')) {
            res.writeHead(204);
            return res.end();
        }
        if (url.pathname === '/shop-api') {
            let raw = '';
            for await (const chunk of req) raw += chunk;
            const { query = '', variables = {} } = JSON.parse(raw || '{}');
            const cart = fixture.storefrontCart;
            const order = cart.checkoutOrder;
            if (query.includes('mutation StorefrontLogin')) {
                fixture.activeCustomer = customer;
                return json(res, {
                    data: {
                        login: {
                            __typename: 'CurrentUser',
                            id: 'local-user',
                            identifier: 'qa@example.invalid',
                        },
                    },
                });
            }
            if (query.includes('mutation ApplyStorefrontCartCommand')) {
                const input = variables.input;
                commands.push(input);
                if (!receipts.has(input.commandId)) {
                    if (input.buyNow) {
                        cart.lines[0].quantity = input.buyNow.quantity;
                        cart.lines[0].selected = true;
                        cart.lines[1].selected = false;
                        order.lines[0].quantity = input.buyNow.quantity;
                    }
                    if (input.prepareShipping) {
                        order.shippingWithTax = 800;
                        order.shippingAddress = customer.addresses[0];
                        order.shippingLines = [
                            { shippingMethod: fixture.eligibleShippingMethods[0], priceWithTax: 800 },
                        ];
                    }
                    if (input.preparePayment) {
                        cart.state = 'PAYMENT_PENDING';
                        order.state = 'ArrangingPayment';
                    }
                    cart.revision++;
                    cart.projectedRevision = cart.revision;
                    cart.selectedQuantity = cart.lines
                        .filter(l => l.selected)
                        .reduce((n, l) => n + l.quantity, 0);
                    cart.selectedLineCount = cart.lines.filter(l => l.selected).length;
                    cart.totalQuantity = cart.lines.reduce((n, l) => n + l.quantity, 0);
                    cart.selectionState = 'PARTIAL';
                    order.totalQuantity = cart.selectedQuantity;
                    order.subTotalWithTax = cart.selectedQuantity * 2990;
                    order.totalWithTax = order.subTotalWithTax + order.shippingWithTax;
                    order.lines[0].linePriceWithTax = order.subTotalWithTax;
                    receipts.set(input.commandId, {
                        commandId: input.commandId,
                        status: 'APPLIED',
                        appliedRevision: cart.revision,
                        errorCode: null,
                        message: null,
                        cart: { id: cart.id, revision: cart.revision },
                        session:
                            input.buyNow || input.beginCheckout || input.preparePayment
                                ? {
                                      order: { id: order.id },
                                      checkout: input.preparePayment
                                          ? {
                                                id: 'checkout-1',
                                                cartRevision: cart.revision,
                                                state: 'PREPARED',
                                                completedAt: null,
                                            }
                                          : null,
                                  }
                                : null,
                        shippingMethods: input.prepareShipping ? fixture.eligibleShippingMethods : null,
                        selectedShippingMethodId: input.prepareShipping ? 'delivery-1' : null,
                    });
                    if (input.buyNow && ['auto-read', 'login'].includes(scenario)) transientReads = 1;
                    if (input.buyNow && ['manual', 'refresh'].includes(scenario)) blockedReads = true;
                    if (input.buyNow && scenario === 'timeout') {
                        setTimeout(() => {
                            if (!res.destroyed)
                                json(res, {
                                    data: { applyStorefrontCartCommand: receipts.get(input.commandId) },
                                });
                        }, 21_000);
                        return;
                    }
                }
                return json(res, { data: { applyStorefrontCartCommand: receipts.get(input.commandId) } });
            }
            if (query.includes('mutation RecoverStorefrontCartCommand')) {
                recoveryCalls++;
                return json(res, {
                    data: { recoverStorefrontCartCommand: receipts.get(variables.commandId) },
                });
            }
            if (query.includes('query StorefrontCart')) {
                reads++;
                if (blockedReads || transientReads-- > 0) return failure(res);
            }
            if (query.includes('mutation SetStorefrontPaymentCurrency'))
                return json(res, { data: { setStorefrontPaymentCurrency: order } });
            if (query.includes('mutation CreateStorefrontOrderConfirmationToken'))
                return json(res, {
                    data: {
                        createStorefrontOrderConfirmationToken: {
                            token: 'local-fixture-confirmation',
                            expiresAt: '2030-01-01T00:00:00Z',
                        },
                    },
                });
            if (query.includes('addPaymentToOrder')) {
                payments++;
                order.state = 'PaymentSettled';
                order.payments = [
                    {
                        id: 'local-payment-1',
                        method: 'local-fixture',
                        amount: order.totalWithTax,
                        state: 'Settled',
                        transactionId: 'local-only',
                        createdAt: new Date().toISOString(),
                        metadata: {},
                    },
                ];
                return json(res, { data: { addPaymentToOrder: order } });
            }
            if (query.includes('StorefrontOrderByConfirmationToken'))
                return json(res, { data: { storefrontOrderByConfirmationToken: order } });
            return json(res, { data: fixture });
        }
        let path = resolve(dist, '.' + decodeURIComponent(url.pathname));
        if (!path.startsWith(resolve(dist) + sep)) path = resolve(dist, 'index.html');
        const info = await stat(path).catch(() => null);
        if (!info?.isFile()) path = resolve(dist, 'index.html');
        res.writeHead(200, {
            'content-type': types[extname(path)] || 'application/octet-stream',
            'cache-control': 'no-store',
        });
        res.end(await readFile(path));
    } catch (error) {
        json(res, { error: String(error) }, 500);
    }
});
server.listen(port, '127.0.0.1', () =>
    process.stdout.write(`Local recovery fixture: http://127.0.0.1:${port}\n`),
);
