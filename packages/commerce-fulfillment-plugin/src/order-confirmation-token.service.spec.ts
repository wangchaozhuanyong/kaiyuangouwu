import {
    ActiveOrderService,
    Customer,
    Order,
    RequestContext,
    TransactionalConnection,
    User,
} from '@vendure/core';
import { describe, expect, it, vi } from 'vitest';

import { AuthenticatedOrderByCodeAccessStrategy } from './authenticated-order-by-code-access-strategy';
import { OrderConfirmationTokenService } from './order-confirmation-token.service';

const signingSecret = '3c404e829b3f495cb904f2f9120c5de359ef5305263e4fdf';
const now = Date.UTC(2026, 7, 20, 12, 0, 0);

describe('OrderConfirmationTokenService', () => {
    it('issues a channel-scoped token for the active payment order and loads that order', async () => {
        const order = { id: 'order-1', active: true, state: 'ArrangingPayment' } as Order;
        const activeOrderService = {
            getActiveOrder: vi.fn().mockResolvedValue(order),
        } as unknown as ActiveOrderService;
        const connection = {
            findOneInChannel: vi.fn().mockResolvedValue(order),
        } as unknown as TransactionalConnection;
        const service = new OrderConfirmationTokenService(activeOrderService, connection, {
            signingSecret,
            tokenTtlSeconds: 120,
        });
        const ctx = { channelId: 'channel-1' } as RequestContext;

        const result = await service.createForActiveOrder(ctx, now);
        await expect(service.orderForToken(ctx, result.token, ['lines'], now + 60_000)).resolves.toBe(order);
        expect(result.expiresAt).toEqual(new Date(now + 120_000));
        expect(connection.findOneInChannel).toHaveBeenCalledWith(ctx, Order, 'order-1', 'channel-1', {
            relations: ['lines'],
        });
    });

    it('rejects altered, expired and cross-channel tokens without querying the order', async () => {
        const order = { id: 'order-1', active: true, state: 'ArrangingPayment' } as Order;
        const activeOrderService = {
            getActiveOrder: vi.fn().mockResolvedValue(order),
        } as unknown as ActiveOrderService;
        const connection = {
            findOneInChannel: vi.fn(),
        } as unknown as TransactionalConnection;
        const service = new OrderConfirmationTokenService(activeOrderService, connection, {
            signingSecret,
            tokenTtlSeconds: 60,
        });
        const ctx = { channelId: 'channel-1' } as RequestContext;
        const { token } = await service.createForActiveOrder(ctx, now);

        await expect(service.orderForToken(ctx, `${token.slice(0, -1)}x`, [], now)).resolves.toBeUndefined();
        await expect(service.orderForToken(ctx, token, [], now + 60_000)).resolves.toBeUndefined();
        await expect(
            service.orderForToken({ channelId: 'channel-2' } as RequestContext, token, [], now),
        ).resolves.toBeUndefined();
        expect(connection.findOneInChannel).not.toHaveBeenCalled();
    });

    it('issues a seven-day email entry only for a settled order', async () => {
        const order = { id: 'order-2', active: false, state: 'PaymentSettled' } as Order;
        const service = new OrderConfirmationTokenService(
            {} as ActiveOrderService,
            {} as TransactionalConnection,
            {
                signingSecret,
                emailTokenTtlSeconds: 7 * 24 * 60 * 60,
            },
        );
        const ctx = { channelId: 'channel-1' } as RequestContext;

        const result = service.createForSettledOrder(ctx, order, now);

        expect(result.expiresAt).toEqual(new Date(now + 7 * 24 * 60 * 60 * 1000));
        expect(service.verifyToken(result.token, now + 6 * 24 * 60 * 60 * 1000)).toMatchObject({
            orderId: 'order-2',
            channelId: 'channel-1',
        });
        expect(() =>
            service.createForSettledOrder(ctx, { id: 'order-3', state: 'ArrangingPayment' }, now),
        ).toThrow(/settled orders/u);
    });

    it('requires a strong configured secret in production', () => {
        expect(
            () =>
                new OrderConfirmationTokenService({} as ActiveOrderService, {} as TransactionalConnection, {
                    production: true,
                    signingSecret: 'replace-with-a-secret',
                }),
        ).toThrow(/ORDER_CONFIRMATION_TOKEN_SECRET/u);
    });
});

describe('AuthenticatedOrderByCodeAccessStrategy', () => {
    const strategy = new AuthenticatedOrderByCodeAccessStrategy();
    const order = {
        customer: { user: { id: 'user-1' } as User } as Customer,
    } as Order;

    it('allows only the authenticated customer who owns the order', () => {
        expect(strategy.canAccessOrder({ activeUserId: 'user-1' } as RequestContext, order)).toBe(true);
        expect(strategy.canAccessOrder({ activeUserId: 'user-2' } as RequestContext, order)).toBe(false);
        expect(strategy.canAccessOrder({ activeUserId: undefined } as RequestContext, order)).toBe(false);
    });
});
