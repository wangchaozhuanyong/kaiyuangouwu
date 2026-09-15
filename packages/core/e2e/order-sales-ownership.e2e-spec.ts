import { CurrencyCode, LanguageCode, OrderType } from '@vendure/common/lib/generated-types';
import {
    ActiveOrderService,
    ChannelService,
    ConfigService,
    Customer,
    mergeConfig,
    Order,
    OrderService,
    Payment,
    PaymentService,
    RequestContext,
    RequestContextService,
    TransactionalConnection,
    User,
} from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import gql from 'graphql-tag';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { testConfig } from '../../../e2e-common/test-config';

const config = mergeConfig(testConfig(), { apiOptions: { port: 37384 } });
const { server, adminClient } = createTestEnvironment(config);
let connection: TransactionalConnection;
let contexts: RequestContextService;
let orders: OrderService;
let platform: RequestContext;
let a: RequestContext;
let b: RequestContext;
let defaultShop: RequestContext;
let customer: Customer;
let otherCustomer: Customer;
let first: Order;
let second: Order;
let historical: Order;

function required<T>(value: T | null | undefined, label: string): T {
    if (value == null) throw new Error(`Expected ${label}`);
    return value;
}

beforeAll(async () => {
    await server.init({ initialData, customerCount: 2 });
    connection = server.app.get(TransactionalConnection);
    contexts = server.app.get(RequestContextService);
    orders = server.app.get(OrderService);
    const credentials = required(config.authOptions.superadminCredentials, 'superadmin credentials');
    const admin = await connection.rawConnection.getRepository(User).findOneOrFail({
        where: { identifier: credentials.identifier },
        relations: ['roles', 'roles.channels'],
    });
    platform = await contexts.create({ apiType: 'admin', user: admin });
    for (const code of ['owner-a', 'owner-b']) {
        const result = await server.app.get(ChannelService).create(platform, {
            code,
            token: code,
            defaultLanguageCode: LanguageCode.en,
            currencyCode: CurrencyCode.GBP,
            pricesIncludeTax: true,
        });
        expect('id' in result).toBe(true);
    }
    const customers = await connection
        .getRepository(platform, Customer)
        .find({ relations: ['user', 'user.roles', 'user.roles.channels'] });
    [customer, otherCustomer] = customers;
    a = await contexts.create({ apiType: 'shop', user: customer.user, channelOrToken: 'owner-a' });
    b = await contexts.create({ apiType: 'shop', user: customer.user, channelOrToken: 'owner-b' });
    defaultShop = await contexts.create({ apiType: 'shop', user: customer.user });
    await server.app
        .get(ChannelService)
        .assignToChannels(platform, Customer, customer.id, [a.channelId, b.channelId]);
    const customerUser = required(customer.user, 'customer user');
    first = await orders.create(a, customerUser.id);
    second = await orders.create(b, customerUser.id);
    historical = await orders.create(a, customerUser.id);
    await connection.getRepository(a, Order).update(historical.id, { salesChannelId: null, active: false });
}, 120000);
afterAll(async () => {
    await server.destroy();
});

it('persists the sales owner while retaining platform membership', async () => {
    const saved = await connection
        .getRepository(a, Order)
        .findOneOrFail({ where: { id: first.id }, relations: ['channels'] });
    expect(saved.salesChannelId).toBe(a.channelId);
    expect(saved.channels.map(channel => channel.id)).toContain(platform.channelId);
    expect(saved.channels.map(channel => channel.id)).toContain(a.channelId);
    expect((await orders.createDraft(b)).salesChannelId).toBe(b.channelId);
});

it('isolates storefront reads, codes and customer history, including the native default storefront', async () => {
    expect(await orders.findOne(b, first.id)).toBeUndefined();
    expect(await orders.findOne(defaultShop, first.id)).toBeUndefined();
    expect(await orders.findOneByCode(b, first.code)).toBeUndefined();
    expect((await orders.findByCustomerId(a, customer.id)).items.map(order => order.id)).toEqual([first.id]);
    expect((await orders.findByCustomerId(b, customer.id)).items.map(order => order.id)).toEqual([second.id]);
    expect((await orders.findByCustomerId(defaultShop, customer.id)).items).toEqual([]);
});

it('keeps unresolved history visible to the platform and refuses business writes without its reviewed owner', async () => {
    expect((await orders.findAll(platform)).items.map(order => order.id)).toEqual(
        expect.arrayContaining([first.id, second.id, historical.id]),
    );
    expect(await orders.findOne(platform, historical.id)).toBeDefined();
    expect(await orders.findOne(a, historical.id)).toBeUndefined();
    await expect(orders.updateCustomFields(platform, historical.id, {})).rejects.toThrow();
    await expect(orders.updateCustomFields(platform, first.id, {})).rejects.toThrow();
    await expect(orders.updateCustomFields(b, first.id, {})).rejects.toThrow();
    await expect(orders.updateCustomFields(a, first.id, {})).resolves.toBeDefined();
    const unprivilegedDefault = await contexts.create({ apiType: 'admin' });
    expect((await orders.findAll(unprivilegedDefault)).items.map(order => order.id)).not.toContain(first.id);
});

it('does not adopt an old other-store or other-member session pointer', async () => {
    const staleStore = await contexts.create({
        apiType: 'shop',
        user: customer.user,
        channelOrToken: 'owner-a',
        activeOrderId: second.id,
    });
    expect(await orders.getActiveOrderFromSession(staleStore)).toBeUndefined();
    expect(
        (await orders.getActiveOrderForUser(staleStore, required(customer.user, 'customer user').id))?.id,
    ).toBe(first.id);
    const staleMember = await contexts.create({
        apiType: 'shop',
        user: otherCustomer.user,
        channelOrToken: 'owner-a',
        activeOrderId: first.id,
    });
    expect(await orders.getActiveOrderFromSession(staleMember)).toBeUndefined();
    const matching = await contexts.create({
        apiType: 'shop',
        user: customer.user,
        channelOrToken: 'owner-a',
        activeOrderId: first.id,
    });
    expect((await orders.getActiveOrderFromSession(matching))?.id).toBe(first.id);
});

it('checks custom active-order strategies and refuses cross-store merges', async () => {
    const strategy = server.app.get(ConfigService).orderOptions.activeOrderStrategy;
    const instance = Array.isArray(strategy) ? strategy[0] : strategy;
    const spy = vi.spyOn(instance, 'determineActiveOrder').mockResolvedValue(second);
    try {
        expect(await server.app.get(ActiveOrderService).getActiveOrder(a, undefined)).toBeUndefined();
    } finally {
        spy.mockRestore();
    }
    const before = await connection.getRepository(a, Order).count();
    await expect(
        orders.mergeOrders(a, required(customer.user, 'customer user'), undefined, second),
    ).rejects.toThrow();
    expect(await connection.getRepository(a, Order).count()).toBe(before);
});

it('does not reinterpret management assignments as a change in sales owner', async () => {
    await server.app.get(ChannelService).assignToChannels(platform, Order, first.id, [b.channelId]);
    expect((await orders.findOne(a, first.id))?.id).toBe(first.id);
    expect(await orders.findOne(b, first.id)).toBeUndefined();
    expect((await connection.getRepository(a, Order).findOneByOrFail({ id: first.id })).type).toBe(
        OrderType.Regular,
    );
});

it('exposes the actual owner and unresolved state through the Admin API', async () => {
    await adminClient.asSuperAdmin();
    const result = await adminClient.query(gql`
        query {
            orders {
                items {
                    id
                    salesChannel {
                        id
                        code
                    }
                }
            }
        }
    `);
    const owned = result.orders.items.find(
        (row: { salesChannel: { code: string } | null }) => row.salesChannel?.code === 'owner-a',
    );
    expect(owned).toBeDefined();
    expect(
        result.orders.items.filter((row: { salesChannel: unknown }) => row.salesChannel === null),
    ).toHaveLength(1);
});

it('rejects payment and refund operations from another store before invoking any handler', async () => {
    const service = server.app.get(PaymentService);
    const input = { method: 'synthetic-manual', transactionId: 'local-only', metadata: {} };
    await expect(service.createManualPayment(b, first, 100, input)).rejects.toThrow();
    // A persisted Created payment is sufficient to check rejection before any payment handler.
    // Successful gateway/manual transitions are covered by payment-process.e2e-spec.ts.
    const payment = await service.create(a, { ...input, order: first, amount: 100 });
    const before = await connection.getRepository(a, Payment).findOneByOrFail({ id: payment.id });
    await expect(service.settlePayment(b, payment.id)).rejects.toThrow();
    await expect(service.cancelPayment(b, payment.id)).rejects.toThrow();
    await expect(service.transitionToState(b, payment.id, 'Error')).rejects.toThrow();
    await expect(
        orders.refundOrder(b, {
            paymentId: payment.id,
            amount: 100,
            shipping: 0,
            adjustment: 0,
            lines: [],
            reason: 'local wrong-store test',
        }),
    ).rejects.toThrow();
    expect(await connection.getRepository(a, Payment).findOneByOrFail({ id: payment.id })).toEqual(before);
});

it('preserves the transaction when a trusted internal operation changes its store context', async () => {
    const before = await connection.getRepository(a, Order).count();
    await expect(
        connection.withTransaction(a, async txCtx => {
            const otherStoreContext = txCtx.copy({ channel: b.channel });
            expect(txCtx.channelId).toBe(a.channelId);
            const created = await orders.createDraft(otherStoreContext);
            expect(created.salesChannelId).toBe(b.channelId);
            throw new Error('synthetic rollback across owned operations');
        }),
    ).rejects.toThrow('synthetic rollback');
    expect(await connection.getRepository(a, Order).count()).toBe(before);
});
