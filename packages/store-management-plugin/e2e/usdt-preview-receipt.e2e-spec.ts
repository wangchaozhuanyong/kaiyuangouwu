import { CatalogManagementPlugin } from '@vendure/catalog-management-plugin';
import { CheckoutResourcesService, CommerceFulfillmentPlugin } from '@vendure/commerce-fulfillment-plugin';
import { GlobalFlag } from '@vendure/common/lib/generated-types';
import { ContentTranslationPlugin } from '@vendure/content-translation-plugin';
import {
    ChannelService,
    CurrencyCode,
    Customer,
    LanguageCode,
    mergeConfig,
    Order,
    OrderService,
    Payment,
    PaymentMethod,
    PaymentMethodHandler,
    PaymentMethodService,
    ProductService,
    ProductVariantService,
    Refund,
    RequestContext,
    RequestContextService,
    TransactionalConnection,
    User,
} from '@vendure/core';
import { OperationsDashboardPlugin } from '@vendure/operations-dashboard-plugin';
import { StoreDomain, StoreDomainPlugin } from '@vendure/store-domain-plugin';
import { StorefrontActivationService, StoreManagementPlugin } from '@vendure/store-management-plugin';
import { StorefrontCartPlugin } from '@vendure/storefront-cart-plugin';
import { createTestEnvironment, testConfig } from '@vendure/testing';
import { randomBytes, randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { closureDatabase } from '../../commerce-fulfillment-plugin/e2e/order-closure-db';
import { DigitalVariantConfig } from '../../commerce-fulfillment-plugin/src/entities/digital-product.entity';
import { ManualDigitalDelivery } from '../../commerce-fulfillment-plugin/src/entities/manual-digital-delivery.entity';
import { ReferralAccount } from '../src/entities/referral-account.entity';
import { ReferralBalanceUse } from '../src/entities/referral-balance-use.entity';
import { ReferralLedgerEntry } from '../src/entities/referral-ledger-entry.entity';
import { ReferralWallet } from '../src/entities/referral-wallet.entity';
import { StoreProfile } from '../src/entities/store-profile.entity';
import { StoreUsdtManualRefund } from '../src/entities/store-usdt-manual-refund.entity';
import { StorefrontUsdtCheckoutQuote } from '../src/entities/storefront-usdt-checkout-quote.entity';
import { StorefrontUsdtPaymentIntent } from '../src/entities/storefront-usdt-payment-intent.entity';
import { ReferralService } from '../src/referral/referral.service';
import { StoreCurrencySettingsService } from '../src/store-currency-settings.service';
import { UsdtManualRefundService } from '../src/usdt/usdt-manual-refund.service';
import { USDT_TRC20_CONTRACT_ADDRESS } from '../src/usdt/usdt-payment.constants';
import { UsdtPaymentService } from '../src/usdt/usdt-payment.service';

// Every service, handler, SQL transaction and resource hook is native. Only the external TronGrid
// HTTP responses are synthetic. No wallet signs or sends transfers, and no SMTP provider is loaded.
const artifactDirectory = resolve(__dirname, '../artifacts/usdt-preview-receipt', randomUUID());
const walletAddress = USDT_TRC20_CONTRACT_ADDRESS;
const payerAddress = 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb';
let newRealHandlerCalls = 0;
const boundaryRealHandler = new PaymentMethodHandler({
    code: 'synthetic-usdt-boundary-real-handler',
    description: [{ languageCode: LanguageCode.en, value: 'Isolated real-payment boundary fixture' }],
    args: {},
    createPayment: (_ctx, _order, amount) => {
        newRealHandlerCalls++;
        return { amount, state: 'Settled', transactionId: `synthetic-${randomUUID()}`, metadata: {} };
    },
    settlePayment: () => ({ success: true }),
});
const envNames = [
    'DIGITAL_DELIVERY_ROOT',
    'DIGITAL_DELIVERY_SIGNING_SECRET',
    'AUTO_CARD_ENCRYPTION_KEY',
    'USDT_WALLET_ENCRYPTION_KEY',
    'USDT_PAYMENT_PROOF_SECRET',
    'STOREFRONT_USDT_TRC20_RECEIVING_ADDRESS',
    'STOREFRONT_USDT_TRC20_ADDRESS_SHA256',
    'USDT_REFUND_SENDER_ADDRESSES',
    'TRONGRID_API_KEY',
] as const;
const previousEnv = Object.fromEntries(envNames.map(name => [name, process.env[name]]));
process.env.DIGITAL_DELIVERY_ROOT = resolve(artifactDirectory, 'digital');
for (const name of [
    'DIGITAL_DELIVERY_SIGNING_SECRET',
    'AUTO_CARD_ENCRYPTION_KEY',
    'USDT_WALLET_ENCRYPTION_KEY',
    'USDT_PAYMENT_PROOF_SECRET',
]) {
    process.env[name] = randomBytes(32).toString('base64url');
}
process.env.STOREFRONT_USDT_TRC20_RECEIVING_ADDRESS = walletAddress;
delete process.env.STOREFRONT_USDT_TRC20_ADDRESS_SHA256;
process.env.USDT_REFUND_SENDER_ADDRESSES = walletAddress;
delete process.env.TRONGRID_API_KEY;
const { server } = createTestEnvironment(
    mergeConfig(testConfig, {
        apiOptions: { port: 37489, hostname: '127.0.0.1' },
        dbConnectionOptions: closureDatabase(resolve(artifactDirectory, 'database')),
        authOptions: { requireVerification: false },
        paymentOptions: { paymentMethodHandlers: [boundaryRealHandler] },
        plugins: [
            OperationsDashboardPlugin,
            CatalogManagementPlugin,
            StoreDomainPlugin,
            StorefrontCartPlugin,
            ContentTranslationPlugin.init({
                provider: {
                    name: 'synthetic-no-network',
                    isConfigured: () => false,
                    translate: () => {
                        throw new Error('External translation is disabled in this fixture');
                    },
                },
            }),
            StoreManagementPlugin.init({
                enabled: false,
                signingSecret: 'synthetic-receipt-signing-secret-at-least-32-characters',
            }),
            CommerceFulfillmentPlugin.init({
                testPaymentsEnabled: true,
                evidenceStorage: {
                    rootDirectory: resolve(artifactDirectory, 'evidence'),
                    signingSecret: randomUUID(),
                },
            }),
        ],
    }),
);
let connection: TransactionalConnection;
let ctx: RequestContext;
let adminCtx: RequestContext;
let customer: Customer;
let orders: OrderService;
let usdt: UsdtPaymentService;
let resources: CheckoutResourcesService;
let currency: StoreCurrencySettingsService;
let refunds: UsdtManualRefundService;
let variantId: string | number;
let closedPayment: Payment;
const transfers: Array<Record<string, unknown>> = [];
const receipts = new Map<string, Record<string, unknown>>();
const refundEvents = new Map<string, Record<string, unknown>>();
const realFetch = globalThis.fetch;
let externalRequests = 0;
const externalRequestPaths: string[] = [];

beforeAll(async () => {
    mkdirSync(artifactDirectory, { recursive: true });
    vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(
            typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
        );
        if (url.hostname === '127.0.0.1') return realFetch(input, init);
        if (url.origin !== 'https://api.trongrid.io')
            throw new Error('Unapproved external network in isolated receipt fixture');
        externalRequests++;
        externalRequestPaths.push(url.pathname);
        if (url.pathname.includes('/transactions/trc20')) {
            return Response.json({ success: true, data: transfers, meta: {} });
        }
        if (url.pathname === '/walletsolidity/gettransactioninfobyid') {
            if (typeof init?.body !== 'string')
                throw new Error('Synthetic receipt request requires a JSON body');
            const id = (JSON.parse(init.body) as { value: string }).value;
            return Response.json(receipts.get(id) ?? {});
        }
        const match = /^\/v1\/transactions\/([a-f0-9]{64})\/events$/u.exec(url.pathname);
        if (match)
            return Response.json({
                success: true,
                data: refundEvents.has(match[1]) ? [refundEvents.get(match[1])] : [],
            });
        throw new Error('Unexpected TronGrid route in isolated receipt fixture');
    });
    await server.init({
        initialData: { ...initialData, collections: [], paymentMethods: [] },
        customerCount: 1,
    });
    connection = server.app.get(TransactionalConnection);
    orders = server.app.get(OrderService);
    usdt = server.app.get(UsdtPaymentService);
    resources = server.app.get(CheckoutResourcesService);
    currency = server.app.get(StoreCurrencySettingsService);
    refunds = server.app.get(UsdtManualRefundService);
    const contexts = server.app.get(RequestContextService);
    const platform = await contexts.create({ apiType: 'admin' });
    const channel = await server.app.get(ChannelService).create(platform, {
        code: 'synthetic-usdt-receipt',
        token: 'synthetic-usdt-receipt',
        defaultLanguageCode: LanguageCode.en,
        currencyCode: CurrencyCode.CNY,
        pricesIncludeTax: false,
        defaultTaxZoneId: platform.channel.defaultTaxZone?.id ?? '',
        defaultShippingZoneId: platform.channel.defaultShippingZone?.id ?? '',
        customFields: { commerceMode: 'DIGITAL_ONLY' },
    });
    if (!('id' in channel)) throw new Error(channel.message);
    customer = await connection
        .getRepository(platform, Customer)
        .findOneOrFail({ where: {}, relations: ['user', 'user.roles', 'user.roles.channels'] });
    if (!customer.user) throw new Error('Isolated fixture customer account missing');
    await server.app.get(ChannelService).assignToChannels(platform, Customer, customer.id, [channel.id]);
    ctx = await contexts.create({ apiType: 'shop', channelOrToken: channel.token, user: customer.user });
    const operator = await connection
        .getRepository(platform, User)
        .findOneOrFail({ where: { identifier: 'superadmin' }, relations: ['roles', 'roles.channels'] });
    adminCtx = await contexts.create({ apiType: 'admin', channelOrToken: channel.token, user: operator });
    await connection.getRepository(ctx, StoreProfile).save(
        new StoreProfile({
            channelId: ctx.channelId,
            status: 'ACTIVE',
            isPublished: false,
            descriptionZh: 'synthetic',
            descriptionEn: 'synthetic',
            sortOrder: 0,
        }),
    );
    await connection.getRepository(ctx, StoreDomain).save(
        new StoreDomain({
            channelId: ctx.channelId,
            domain: 'synthetic-usdt.example.invalid',
            status: 'ACTIVE',
            isPrimary: true,
            primaryChannelId: ctx.channelId,
            verifiedAt: new Date(),
            verificationToken: randomUUID(),
        }),
    );
    const methods = server.app.get(PaymentMethodService);
    const testMethod = await methods.create(platform, {
        code: 'controlled-test-payment-platform',
        enabled: true,
        translations: [
            { languageCode: LanguageCode.en, name: 'Synthetic controlled test', description: '' },
            { languageCode: LanguageCode.zh_Hans, name: '合成模拟付款', description: '本地隔离夹具' },
        ],
        checker: { code: 'controlled-test-payment-checker', arguments: [] },
        handler: {
            code: 'controlled-test-payment-handler',
            arguments: [
                { name: 'channelId', value: `T_${platform.channelId}` },
                { name: 'allowAllOrders', value: 'true' },
            ],
        },
    });
    const nativeUsdt = await connection
        .getRepository(platform, PaymentMethod)
        .findOneByOrFail({ code: 'usdt-trc20' });
    const boundaryRealMethod = await methods.create(platform, {
        code: 'synthetic-usdt-boundary-real',
        enabled: true,
        translations: [
            { languageCode: LanguageCode.en, name: 'Synthetic real-payment boundary', description: '' },
            { languageCode: LanguageCode.zh_Hans, name: '合成真实付款入口', description: '本地隔离夹具' },
        ],
        handler: { code: boundaryRealHandler.code, arguments: [] },
    });
    for (const method of [testMethod, nativeUsdt, boundaryRealMethod])
        await connection
            .getRepository(ctx, 'StorePaymentMethodState')
            .save({ channelId: ctx.channelId, paymentMethodId: method.id, enabled: true });
    const product = await server.app.get(ProductService).create(adminCtx, {
        translations: [
            {
                languageCode: LanguageCode.en,
                name: 'Synthetic receipt digital product',
                slug: 'synthetic-receipt-product',
                description: 'Disposable receipt fixture',
            },
            {
                languageCode: LanguageCode.zh_Hans,
                name: '合成回款数字商品',
                slug: 'synthetic-receipt-product-zh',
                description: '本地隔离回款夹具',
            },
        ],
        customFields: { fulfillmentType: 'digital' },
    });
    const [variant] = await server.app.get(ProductVariantService).create(adminCtx, [
        {
            productId: product.id,
            sku: 'SYNTHETIC-RECEIPT',
            price: 1000,
            trackInventory: GlobalFlag.FALSE,
            translations: [
                { languageCode: LanguageCode.en, name: 'Synthetic receipt digital variant' },
                { languageCode: LanguageCode.zh_Hans, name: '合成回款数字规格' },
            ],
        },
    ]);
    variantId = variant.id;
    const config = await connection
        .getRepository(ctx, DigitalVariantConfig)
        .findOneByOrFail({ channelId: ctx.channelId, productVariantId: variant.id });
    await connection.getRepository(ctx, DigitalVariantConfig).save({
        ...config,
        deliveryMode: 'manual_service',
        stockPolicy: 'limited',
        availableQuantity: 20,
        migrationState: 'ACTIVE',
        fileVersionId: null,
    });
}, 120000);

afterAll(async () => {
    await server.destroy();
    vi.unstubAllGlobals();
    for (const name of envNames) {
        if (previousEnv[name] == null) delete process.env[name];
        else process.env[name] = previousEnv[name];
    }
});

async function mode(status: StoreProfile['status'], isPublished = false) {
    await connection
        .getRepository(ctx, StoreProfile)
        .update({ channelId: ctx.channelId }, { status, isPublished });
}
async function newOrder() {
    const order = await orders.create(ctx, customer.user?.id);
    const added = await orders.addItemToOrder(ctx, order.id, variantId, 1);
    if ('errorCode' in added) throw new Error(added.message);
    // Prevalidated checkout data; all subsequent payment/resource hooks execute natively.
    await connection.getRepository(ctx, Order).update(order.id, {
        state: 'ArrangingPayment',
        customFields: { deliveryEmail: 'synthetic@example.invalid', paymentCurrencyCode: 'USDT' },
    });
    const checkout = await connection.getEntityOrThrow(ctx, Order, order.id, {
        relations: ['lines', 'lines.productVariant', 'payments'],
    });
    await orders.withOrderMutationTransaction(ctx, tx => resources.reserve(tx, checkout, []));
    return checkout;
}
async function issue(order: Order) {
    const quote = await connection.getRepository(ctx, StorefrontUsdtCheckoutQuote).save(
        new StorefrontUsdtCheckoutQuote({
            channelId: ctx.channelId,
            orderId: order.id,
            fiatCurrencyCode: 'CNY',
            fiatAmount: order.totalWithTax,
            fiatPerUsdtRate: 7,
            markupBps: 0,
            usdtAmount: '1.400000',
            source: 'synthetic-prevalidated-rate',
            expiresAt: new Date(Date.now() + 600000),
        }),
    );
    const intent = await usdt.ensureIntent(ctx, quote);
    return { quote, intent };
}
function incoming(intent: StorefrontUsdtPaymentIntent) {
    const id = randomBytes(32).toString('hex');
    const [whole, fraction] = intent.expectedUsdtAmount.split('.');
    const value = (BigInt(whole) * BigInt(1000000) + BigInt(fraction)).toString();
    const timestamp = Date.now();
    transfers.length = 0;
    transfers.push({
        transaction_id: id,
        token_info: { address: walletAddress, decimals: 6, symbol: 'USDT' },
        block_timestamp: timestamp,
        from: payerAddress,
        to: walletAddress,
        type: 'Transfer',
        value,
    });
    receipts.set(id, { id, blockNumber: 88000000, receipt: { result: 'SUCCESS' } });
    return id;
}

it('settles a LIVE-issued native USDT intent after CLOSED and repeats the scanner without double payment', async () => {
    await mode('ACTIVE');
    const order = await newOrder();
    const { intent } = await issue(order);
    const txid = incoming(intent);
    await mode('DRAFT', false);
    expect(await server.app.get(StorefrontActivationService).getAccessMode(ctx)).toBe('CLOSED');
    const scan = await usdt.scanPendingPayments(adminCtx);
    const settled = await connection
        .getRepository(ctx, StorefrontUsdtPaymentIntent)
        .findOneByOrFail({ id: intent.id });
    expect(
        scan,
        JSON.stringify({
            status: settled.status,
            reason: settled.failureReason,
            code: settled.manualReviewCode,
        }),
    ).toMatchObject({ settledCount: 1 });
    expect(settled).toMatchObject({
        status: 'SETTLED',
        transactionId: txid,
        receivedUsdtAmount: intent.expectedUsdtAmount,
        blockNumber: 88000000,
    });
    if (settled.paymentId == null) throw new Error('The settled native intent has no payment');
    closedPayment = await connection.getEntityOrThrow(ctx, Payment, settled.paymentId);
    expect(closedPayment).toMatchObject({
        method: 'usdt-trc20',
        state: 'Settled',
        amount: order.totalWithTax,
        transactionId: `tron:${txid}`,
    });
    expect(closedPayment.metadata.verifiedUsdtPayment.quoteId).toBe(String(intent.quoteId));
    const requestStart = externalRequestPaths.length;
    expect(await usdt.scanPendingPayments(adminCtx)).toMatchObject({ settledCount: 0 });
    expect(await connection.getRepository(ctx, Payment).count({ where: { order: { id: order.id } } })).toBe(
        1,
    );
    appendFileSync(
        resolve(artifactDirectory, 'repeat-scan.json'),
        JSON.stringify({ paths: externalRequestPaths.slice(requestStart) }),
    );
    expect(
        await connection.getRepository(ctx, StorefrontUsdtPaymentIntent).findOneByOrFail({ id: intent.id }),
    ).toMatchObject({ status: 'SETTLED', paymentId: closedPayment.id, transactionId: txid });
}, 30000);

function raceBarrier() {
    let release!: () => void;
    const promise = new Promise<void>(resolveBarrier => {
        release = resolveBarrier;
    });
    return { promise, release };
}

async function waitForOwnedOrderWaiter() {
    if (connection.rawConnection.options.type !== 'mysql') {
        throw new Error('The new funding races require the owned isolated MySQL runner');
    }
    for (let attempt = 0; attempt < 80; attempt++) {
        const rows: Array<{ count: string | number }> = await connection.rawConnection.query(
            'SELECT COUNT(*) AS count FROM performance_schema.data_lock_waits waits ' +
                'JOIN performance_schema.data_locks locks ' +
                'ON waits.REQUESTING_ENGINE_LOCK_ID = locks.ENGINE_LOCK_ID ' +
                'WHERE locks.OBJECT_SCHEMA = DATABASE() AND locks.OBJECT_NAME = ?',
            ['order'],
        );
        if (Number(rows[0].count) > 0) return;
        await new Promise(resolveWait => setTimeout(resolveWait, 25));
    }
    throw new Error('The initial funding entry did not wait for the native order lock');
}

async function rejectAfterConcurrentTestAttempt(
    order: Order,
    state: 'Authorized' | 'Declined',
    entry: string,
    operation: () => Promise<unknown>,
) {
    const acquired = raceBarrier();
    const resume = raceBarrier();
    const blocker = orders.withOrderMutationTransaction(ctx, async txCtx => {
        await orders.lockOrderForRefund(txCtx, order.id);
        acquired.release();
        await resume.promise;
        const payment = new Payment({
            order,
            state,
            amount: state === 'Authorized' ? 1 : 0,
            method:
                state === 'Authorized' ? 'controlled-test-payment-platform' : 'synthetic-usdt-boundary-real',
            transactionId: `synthetic-race-${randomUUID()}`,
        });
        payment.metadata = state === 'Declined' ? { public: { testPayment: true } } : {};
        await connection.getRepository(txCtx, Payment).save(payment);
    });
    await acquired.promise;
    // Observe the rejection immediately so the losing request never emits an unhandled rejection.
    const contender = operation().then(
        value => ({ value, error: undefined }),
        (error: unknown) => ({ value: undefined, error }),
    );
    try {
        await waitForOwnedOrderWaiter();
        resume.release();
        await blocker;
        const outcome = await contender;
        expect(outcome.error, `${entry}/${state}`).toBeInstanceOf(Error);
        expect(String(outcome.error)).toContain('模拟付款订单');
        expect(
            await connection.getRepository(ctx, Payment).count({ where: { order: { id: order.id } } }),
        ).toBe(1);
        appendFileSync(
            resolve(artifactDirectory, 'initial-funding-race-lock-evidence.jsonl'),
            JSON.stringify({ entry, state, actualMysqlOrderWaitObserved: true, rejectedAfterCommit: true }) +
                '\n',
        );
    } finally {
        resume.release();
        await Promise.allSettled([blocker, contender]);
    }
}

it('serializes initial referral balance against committed Authorized and Declined test attempts without reserving funds', async () => {
    await mode('ACTIVE');
    const accountRepository = connection.getRepository(ctx, ReferralAccount);
    const account =
        (await accountRepository.findOneBy({ channelId: ctx.channelId, customerId: customer.id })) ??
        (await accountRepository.save(
            new ReferralAccount({
                channelId: ctx.channelId,
                customerId: customer.id,
                inviteCode: 'RACEFIXTURE',
            }),
        ));
    const walletRepository = connection.getRepository(ctx, ReferralWallet);
    const wallet = await walletRepository.save(
        new ReferralWallet({
            channelId: ctx.channelId,
            referralAccountId: account.id,
            customerId: customer.id,
            currencyCode: CurrencyCode.CNY,
            availableBalance: 2000,
            pendingBalance: 0,
            reservedBalance: 0,
        }),
    );
    const referral = server.app.get(ReferralService);
    for (const state of ['Authorized', 'Declined'] as const) {
        const order = await newOrder();
        const before = {
            reservations: await connection.getRepository(ctx, ReferralBalanceUse).count(),
            ledger: await connection.getRepository(ctx, ReferralLedgerEntry).count(),
            accounts: await accountRepository.count(),
        };
        await rejectAfterConcurrentTestAttempt(order, state, 'initial-balance', () =>
            referral.useBalance(ctx, 500),
        );
        expect({
            reservations: await connection.getRepository(ctx, ReferralBalanceUse).count(),
            ledger: await connection.getRepository(ctx, ReferralLedgerEntry).count(),
            accounts: await accountRepository.count(),
        }).toEqual(before);
        expect(await walletRepository.findOneByOrFail({ id: wallet.id })).toMatchObject({
            availableBalance: 2000,
            reservedBalance: 0,
        });
    }
}, 30000);

it('serializes initial USDT quotes and direct intents against committed Authorized and Declined test attempts without allocation', async () => {
    await mode('ACTIVE');
    for (const state of ['Authorized', 'Declined'] as const) {
        for (const entry of ['initial-quote', 'direct-intent'] as const) {
            const order = await newOrder();
            const quote =
                entry === 'direct-intent'
                    ? await connection.getRepository(ctx, StorefrontUsdtCheckoutQuote).save(
                          new StorefrontUsdtCheckoutQuote({
                              channelId: ctx.channelId,
                              orderId: order.id,
                              fiatCurrencyCode: 'CNY',
                              fiatAmount: order.totalWithTax,
                              fiatPerUsdtRate: 7,
                              markupBps: 0,
                              usdtAmount: '1.400000',
                              source: 'synthetic-race-prevalidated-rate',
                              expiresAt: new Date(Date.now() + 600000),
                          }),
                      )
                    : undefined;
            const quoteCtx = new RequestContext({
                apiType: 'shop',
                channel: ctx.channel,
                session: { activeOrderId: order.id } as never,
                isAuthorized: true,
                authorizedAsOwnerOnly: true,
            });
            const before = {
                quotes: await connection.getRepository(ctx, StorefrontUsdtCheckoutQuote).count(),
                intents: await connection.getRepository(ctx, StorefrontUsdtPaymentIntent).count(),
                requests: externalRequests,
            };
            await rejectAfterConcurrentTestAttempt(order, state, entry, () =>
                quote ? usdt.ensureIntent(ctx, quote) : currency.createCheckoutUsdtQuote(quoteCtx),
            );
            expect({
                quotes: await connection.getRepository(ctx, StorefrontUsdtCheckoutQuote).count(),
                intents: await connection.getRepository(ctx, StorefrontUsdtPaymentIntent).count(),
                requests: externalRequests,
            }).toEqual(before);
        }
    }
}, 30000);

it.each(['wrong-contract', 'wrong-recipient', 'wrong-receipt-id', 'failed-finality'])(
    'keeps %s chain evidence out of native paid state',
    async evidence => {
        await mode('ACTIVE');
        const order = await newOrder();
        const { intent } = await issue(order);
        const txid = incoming(intent);
        if (evidence === 'wrong-contract')
            transfers[0].token_info = { address: payerAddress, decimals: 6, symbol: 'USDT' };
        if (evidence === 'wrong-recipient') transfers[0].to = payerAddress;
        if (evidence === 'wrong-receipt-id')
            receipts.set(txid, { id: 'f'.repeat(64), blockNumber: 88000000, receipt: { result: 'SUCCESS' } });
        if (evidence === 'failed-finality')
            receipts.set(txid, { id: txid, blockNumber: 88000000, receipt: { result: 'FAILED' } });
        await mode('DRAFT', false);
        expect(await usdt.scanPendingPayments(adminCtx)).toMatchObject({ settledCount: 0 });
        expect(
            await connection.getRepository(ctx, Payment).count({ where: { order: { id: order.id } } }),
        ).toBe(0);
        expect(
            await connection
                .getRepository(ctx, StorefrontUsdtPaymentIntent)
                .findOneByOrFail({ id: intent.id }),
        ).toMatchObject({ status: 'PENDING', transactionId: null });
    },
);

it('rejects new PREVIEW quotes and intents and permanently rejects persisted test identities after LIVE', async () => {
    await mode('ACTIVE');
    const order = await newOrder();
    const { quote } = await issue(order);
    await mode('DRAFT', true);
    const before = {
        quotes: await connection.getRepository(ctx, StorefrontUsdtCheckoutQuote).count(),
        intents: await connection.getRepository(ctx, StorefrontUsdtPaymentIntent).count(),
        requests: externalRequests,
    };
    const quoteCtx = new RequestContext({
        apiType: 'shop',
        channel: ctx.channel,
        session: { activeOrderId: order.id } as never,
        isAuthorized: true,
        authorizedAsOwnerOnly: true,
    });
    await expect(currency.createCheckoutUsdtQuote(quoteCtx)).rejects.toThrow('显式测试支付');
    await expect(usdt.ensureIntent(ctx, quote)).rejects.toThrow('显式测试支付');
    expect({
        quotes: await connection.getRepository(ctx, StorefrontUsdtCheckoutQuote).count(),
        intents: await connection.getRepository(ctx, StorefrontUsdtPaymentIntent).count(),
        requests: externalRequests,
    }).toEqual(before);
    await mode('ACTIVE');
    for (const state of ['Declined', 'Cancelled'] as const) {
        for (const identity of ['native-method-only', 'server-marker-only'] as const) {
            const historical = await newOrder();
            const historicalPayment = new Payment({
                order: historical,
                method:
                    identity === 'native-method-only'
                        ? 'controlled-test-payment-platform'
                        : 'synthetic-usdt-boundary-real',
                state,
                amount: 0,
                transactionId: `historical-${randomUUID()}`,
            });
            historicalPayment.metadata =
                identity === 'server-marker-only' ? { public: { testPayment: true } } : {};
            await connection.getRepository(ctx, Payment).save(historicalPayment);
            const calls = newRealHandlerCalls;
            expect(
                await orders.getEligiblePaymentMethods(ctx, historical.id),
                `${identity}/${state}`,
            ).toEqual([]);
            const payment = await orders.withOrderMutationTransaction(ctx, tx =>
                orders.addPaymentToOrder(tx, historical.id, {
                    method: 'synthetic-usdt-boundary-real',
                    metadata: {},
                }),
            );
            expect(payment).toMatchObject({
                __typename: 'PaymentFailedError',
                paymentErrorMessage: expect.stringContaining('模拟付款订单'),
            });
            const manual = await orders.withOrderMutationTransaction(adminCtx, tx =>
                orders.addManualPaymentToOrder(tx, {
                    orderId: historical.id,
                    method: 'synthetic-usdt-boundary-real',
                    transactionId: `manual-${randomUUID()}`,
                    metadata: {},
                }),
            );
            expect(manual).toMatchObject({
                __typename: 'ManualPaymentStateError',
                message: expect.stringContaining('模拟付款订单'),
            });
            expect(newRealHandlerCalls).toBe(calls);
            expect(
                await connection
                    .getRepository(ctx, Payment)
                    .count({ where: { order: { id: historical.id } } }),
            ).toBe(1);
            expect(await resources.canDeliver(adminCtx, historical.id)).toBe(false);
        }
    }
});

it('preserves a receipt issued before native simulation while preventing real digital delivery', async () => {
    await mode('ACTIVE');
    const order = await newOrder();
    const { intent } = await issue(order);
    await mode('DRAFT', true);
    const simulation = await orders.withOrderMutationTransaction(ctx, tx =>
        orders.addPaymentToOrder(tx, order.id, { method: 'controlled-test-payment-platform', metadata: {} }),
    );
    expect(simulation).toMatchObject({ state: 'PaymentSettled' });
    incoming(intent);
    await mode('ACTIVE');
    expect(await usdt.scanPendingPayments(adminCtx)).toMatchObject({ settledCount: 0, manualReviewCount: 1 });
    expect(
        await connection.getRepository(ctx, StorefrontUsdtPaymentIntent).findOneByOrFail({ id: intent.id }),
    ).toMatchObject({
        status: 'MANUAL_REVIEW',
        transactionId: expect.any(String),
        receivedUsdtAmount: intent.expectedUsdtAmount,
        blockNumber: 88000000,
    });
    expect(await resources.canDeliver(adminCtx, order.id)).toBe(false);
    expect(
        await connection.getRepository(ctx, ManualDigitalDelivery).count({ where: { orderId: order.id } }),
    ).toBe(0);
    const persisted = await connection.getEntityOrThrow(ctx, Order, order.id, {
        relations: ['payments', 'fulfillments'],
    });
    expect(persisted.payments).toEqual([
        expect.objectContaining({
            method: 'controlled-test-payment-platform',
            metadata: expect.objectContaining({ public: expect.objectContaining({ testPayment: true }) }),
        }),
    ]);
    expect(persisted.fulfillments).toHaveLength(0);
});

it('registers a verified CLOSED-order USDT refund with native reconciliation and prevents duplicate transaction bookkeeping', async () => {
    await mode('DRAFT', false);
    const transactionId = randomBytes(32).toString('hex');
    const timestamp = Date.now();
    receipts.set(transactionId, { id: transactionId, blockNumber: 88000100, receipt: { result: 'SUCCESS' } });
    refundEvents.set(transactionId, {
        transaction_id: transactionId,
        contract_address: walletAddress,
        event_name: 'Transfer',
        block_timestamp: timestamp,
        result: { from: walletAddress, to: payerAddress, value: '1000000' },
    });
    const input = {
        paymentId: closedPayment.id,
        amount: 100,
        usdtAmount: '1.000000',
        recipientAddress: payerAddress,
        transactionId,
        reason: 'Synthetic verified refund after closure',
    };
    const recorded = await refunds.record(adminCtx, input);
    expect(recorded).toMatchObject({
        state: 'Settled',
        transactionId,
        paymentId: String(closedPayment.id),
        amount: 100,
    });
    const refundCount = await connection
        .getRepository(ctx, Refund)
        .count({ where: { payment: { id: closedPayment.id } } });
    await expect(refunds.record(adminCtx, input)).rejects.toThrow();
    expect(
        await connection.getRepository(ctx, Refund).count({ where: { payment: { id: closedPayment.id } } }),
    ).toBe(refundCount);
    expect(
        await connection
            .getRepository(ctx, StoreUsdtManualRefund)
            .count({ where: { paymentId: closedPayment.id } }),
    ).toBe(1);
    expect(await connection.getEntityOrThrow(ctx, Payment, closedPayment.id)).toMatchObject({
        state: 'Settled',
        amount: closedPayment.amount,
    });
}, 30000);
