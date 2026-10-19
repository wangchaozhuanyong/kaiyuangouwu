import { Order, TransactionalConnection } from '@vendure/core';
import { describe, expect, it, vi } from 'vitest';

import { couponAudience, couponCustomerEligible } from './store-coupon-eligibility';

describe('store coupon customer eligibility', () => {
    const ctx = { channelId: 'channel-1' } as any;
    const order = {
        id: 'current-order',
        customerId: 'customer-1',
        orderPlacedAt: new Date('2026-10-19T00:00:00.000Z'),
    } as any;

    it('treats coupons without an audience condition as available to everyone', async () => {
        const findOne = vi.fn();
        const connection = { getRepository: vi.fn(() => ({ findOne })) } as any;

        await expect(couponCustomerEligible(ctx, connection, 'ALL')).resolves.toBe(true);
        expect(connection.getRepository).not.toHaveBeenCalled();
    });

    it('treats any previously submitted order in the current store as old-customer history', async () => {
        const findOne = vi.fn().mockResolvedValue(undefined);
        const getRepository = vi.fn(() => ({ findOne }));
        const connection = {
            getRepository,
        } as unknown as TransactionalConnection;

        await expect(couponCustomerEligible(ctx, connection, 'NEW', order.customerId, order)).resolves.toBe(
            true,
        );
        expect(getRepository).toHaveBeenCalledWith(ctx, Order);
        const query = findOne.mock.calls[0][0];
        expect(query.where).toMatchObject({
            customerId: 'customer-1',
            salesChannelId: 'channel-1',
        });
        expect(query.where.id._type).toBe('not');
        expect(query.where.id._value).toBe('current-order');
        expect(query.where.orderPlacedAt._type).toBe('lessThanOrEqual');
        expect(query.select).toEqual({ id: true });
    });

    it('counts unpaid or cancelled submitted orders for returning-customer coupons', async () => {
        const findOne = vi.fn().mockResolvedValue({ id: 'previous-order' });
        const connection = { getRepository: vi.fn(() => ({ findOne })) } as any;

        await expect(
            couponCustomerEligible(ctx, connection, 'RETURNING', order.customerId, order),
        ).resolves.toBe(true);
        expect(findOne.mock.calls[0][0].where).toMatchObject({
            customerId: 'customer-1',
            salesChannelId: 'channel-1',
        });
        const orderPlacedAt = findOne.mock.calls[0][0].where.orderPlacedAt;
        expect(orderPlacedAt._type).toBe('lessThanOrEqual');
        expect(findOne.mock.calls[0][0].where).not.toHaveProperty('payments');
        expect(findOne.mock.calls[0][0].where).not.toHaveProperty('state');

        findOne.mockResolvedValue(undefined);
        await expect(
            couponCustomerEligible(ctx, connection, 'RETURNING', order.customerId, order),
        ).resolves.toBe(false);
    });

    it('checks for a submitted order even when no current order is being recalculated', async () => {
        const findOne = vi.fn().mockResolvedValue(undefined);
        const connection = { getRepository: vi.fn(() => ({ findOne })) } as any;

        await expect(couponCustomerEligible(ctx, connection, 'NEW', 'customer-1')).resolves.toBe(true);
        const orderPlacedAt = findOne.mock.calls[0][0].where.orderPlacedAt;
        expect(orderPlacedAt._type).toBe('not');
        expect(orderPlacedAt._value._type).toBe('isNull');
    });

    it('fails closed for anonymous customers and unknown audience rules', async () => {
        const findOne = vi.fn();
        const connection = { getRepository: vi.fn(() => ({ findOne })) } as any;

        await expect(couponCustomerEligible(ctx, connection, 'NEW', null)).resolves.toBe(false);
        await expect(couponCustomerEligible(ctx, connection, 'UNKNOWN' as any, 'customer-1')).resolves.toBe(
            false,
        );
        expect(findOne).not.toHaveBeenCalled();
        expect(
            couponAudience({
                conditions: [
                    { code: 'store_customer_order_history', args: [{ name: 'audience', value: 'UNKNOWN' }] },
                ],
            } as any),
        ).toBe('UNKNOWN');
    });
});
