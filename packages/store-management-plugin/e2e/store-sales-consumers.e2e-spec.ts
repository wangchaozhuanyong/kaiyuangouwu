import { CurrencyCode, LanguageCode } from '@vendure/common/lib/generated-types';
import { ContentTranslationPlugin } from '@vendure/content-translation-plugin';
import {
    ChannelService,
    Customer,
    CustomerStoreEntry,
    Order,
    OrderService,
    Payment,
    Refund,
    RequestContext,
    RequestContextService,
    TransactionalConnection,
    mergeConfig,
} from '@vendure/core';
import { StorefrontCartPlugin } from '@vendure/storefront-cart-plugin';
import { createTestEnvironment } from '@vendure/testing';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { testConfig } from '../../../e2e-common/test-config';
import { StorefrontRealtimeService } from '../src/realtime/storefront-realtime.service';
import { ReferralReportQuery } from '../src/referral/referral-report-query';
import { StoreManagementPlugin } from '../src/store-management.plugin';
import { StorePaymentReportingService } from '../src/store-payment-reporting.service';

const { server } = createTestEnvironment(
    mergeConfig(testConfig(), {
        apiOptions: { port: 37386 },
        plugins: [
            StorefrontCartPlugin,
            ContentTranslationPlugin.init({
                provider: {
                    name: 'local-no-network',
                    isConfigured: () => false,
                    translate: () => {
                        throw new Error('No network');
                    },
                },
            }),
            StoreManagementPlugin.init({ enabled: false, signingSecret: randomUUID() }),
        ],
    }),
);
let connection: TransactionalConnection;
let a: RequestContext;
let b: RequestContext;
let customer: Customer;
let order: Order;

function required<T>(value: T | null | undefined, label: string): T {
    if (value == null) throw new Error(`Expected ${label}`);
    return value;
}

beforeAll(async () => {
    await server.init({ initialData, customerCount: 1 });
    connection = server.app.get(TransactionalConnection);
    const contexts = server.app.get(RequestContextService);
    a = await contexts.create({ apiType: 'admin' });
    await server.app.get(ChannelService).create(a, {
        code: 'sales-consumer-b',
        token: 'sales_consumer_b',
        defaultLanguageCode: LanguageCode.en,
        currencyCode: CurrencyCode.GBP,
        pricesIncludeTax: true,
        // This fixture has no zones; empty IDs keep the ChannelService's original unassigned behavior.
        defaultShippingZoneId: '',
        defaultTaxZoneId: '',
    });
    b = await contexts.create({ apiType: 'admin', channelOrToken: 'sales_consumer_b' });
    customer = await connection.getRepository(a, Customer).findOneOrFail({ where: {}, relations: ['user'] });
    await server.app.get(ChannelService).assignToChannels(a, Customer, customer.id, [b.channelId]);
    order = await server.app.get(OrderService).create(b, required(customer.user, 'customer user').id);
    // The management channel deliberately also contains the order. It must never duplicate a sale.
    await server.app.get(ChannelService).assignToChannels(a, Order, order.id, [a.channelId]);
    await connection.getRepository(b, Order).update(order.id, {
        state: 'PaymentSettled',
        active: false,
        subTotalWithTax: 1000,
        subTotal: 1000,
        orderPlacedAt: new Date(),
    });
    const payment = await connection.getRepository(b, Payment).save(
        new Payment({
            order,
            state: 'Settled',
            amount: 1000,
            method: 'synthetic-no-charge',
            metadata: {},
        }),
    );
    await connection.getRepository(b, Refund).save(
        new Refund({
            payment,
            state: 'Settled',
            total: 200,
            items: 200,
            shipping: 0,
            adjustment: 0,
            method: 'synthetic-no-refund',
            metadata: {},
        }),
    );
}, 120000);
afterAll(async () => {
    await server.destroy();
});

it('counts a payment and refund once for the sales store and once in the platform total', async () => {
    const reporting = server.app.get(StorePaymentReportingService);
    expect(await reporting.statsForChannel(a)).toEqual([]);
    const own = await reporting.statsForChannel(b);
    expect(own).toHaveLength(1);
    expect(own[0]).toMatchObject({
        channelId: String(b.channelId),
        settledCount: 1,
        grossAmount: 1000,
        refundedAmount: 200,
        netAmount: 800,
    });
    expect(await reporting.stats(a)).toEqual(own);
    expect((await reporting.detailsForChannel(a)).totalItems).toBe(0);
    expect((await reporting.details(a)).totalItems).toBe(1);
});

it('uses per-store first entry for newcomers and the sales store for buyers and revenue', async () => {
    const entries = connection.getRepository(b, CustomerStoreEntry);
    await entries.update({ customerId: customer.id }, { firstSeenAt: new Date('2020-01-01T00:00:00Z') });
    await entries.insert({
        customerId: customer.id,
        channelId: b.channelId,
        source: 'AUTHENTICATED_ENTRY',
        firstSeenAt: new Date(),
    });
    const reporting = new ReferralReportQuery(connection);
    expect(await reporting.todayMetrics(b)).toMatchObject({
        newCustomerCount: 1,
        consumerCount: 1,
        firstTimeConsumerCount: 1,
        orderCount: 1,
        salesByCurrency: [{ currencyCode: CurrencyCode.GBP, sales: 800 }],
    });
    expect(await reporting.todayMetrics(a)).toMatchObject({
        newCustomerCount: 0,
        consumerCount: 0,
        orderCount: 0,
        salesByCurrency: [],
    });
});

it('routes order notifications only to the owning storefront and matching member or guest cart', async () => {
    const realtime = server.app.get(StorefrontRealtimeService);
    const sendA = vi.fn();
    const sendB = vi.fn();
    const sendOther = vi.fn();
    const sendGuest = vi.fn();
    const disconnect = [
        realtime.addClient({
            channelId: String(a.channelId),
            userId: String(required(customer.user, 'customer user').id),
            send: sendA,
        }),
        realtime.addClient({
            channelId: String(b.channelId),
            userId: String(required(customer.user, 'customer user').id),
            send: sendB,
        }),
        realtime.addClient({ channelId: String(b.channelId), userId: 'another-member', send: sendOther }),
        realtime.addClient({
            channelId: String(b.channelId),
            activeOrderId: String(order.id),
            send: sendGuest,
        }),
    ];
    try {
        await Reflect.get(realtime, 'publishOrderChange').call(realtime, order.id, a.channelId);
        expect(sendA).not.toHaveBeenCalled();
        expect(sendB).toHaveBeenCalledTimes(1);
        expect(sendOther).not.toHaveBeenCalled();
        expect(sendGuest).toHaveBeenCalledTimes(1);
        await connection.getRepository(b, Order).update(order.id, { salesChannelId: null });
        await Reflect.get(realtime, 'publishOrderChange').call(realtime, order.id, a.channelId);
        expect(sendA).not.toHaveBeenCalled();
        expect(sendB).toHaveBeenCalledTimes(1);
    } finally {
        disconnect.forEach(close => close());
    }
});
