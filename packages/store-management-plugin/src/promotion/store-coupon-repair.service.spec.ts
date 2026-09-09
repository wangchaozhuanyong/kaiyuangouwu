import { describe, expect, it } from 'vitest';

import { CustomerCoupon } from '../entities/customer-coupon.entity';

import { couponRepairChange } from './store-coupon-repair.service';

const claimedAt = new Date('2026-09-01T12:00:00Z');
const now = new Date('2026-09-04T12:00:00Z');
const makeCoupon = (overrides = {}) =>
    new CustomerCoupon({
        id: '1',
        version: 1,
        claimedAt,
        validFrom: claimedAt,
        validUntil: new Date('2026-09-02T12:00:00Z'),
        status: 'EXPIRED',
        expiredAt: new Date('2026-09-02T12:00:01Z'),
        ...overrides,
    });
const config = { validityDays: 7 } as any;
const promotion = { enabled: true, deletedAt: null } as any;

describe('coupon validity repair', () => {
    it('restores a prematurely expired coupon to the original claim plus seven days', () => {
        expect(couponRepairChange(makeCoupon(), config, promotion, [], now)?.after).toEqual({
            validFrom: claimedAt.toISOString(),
            validUntil: '2026-09-08T12:00:00.000Z',
            status: 'AVAILABLE',
            expiredAt: null,
        });
    });
    it('preserves redemption and returns only the validity correction for a used coupon', () => {
        expect(
            couponRepairChange(
                makeCoupon({ status: 'USED', expiredAt: null, usedOrderId: 'order-b' }),
                config,
                promotion,
                [],
                now,
            )?.after.status,
        ).toBe('USED');
    });
    it('restores a returned coupon without renewing its validity from the repair date', () => {
        const result = couponRepairChange(
            makeCoupon({ returnedAt: new Date('2026-09-02T10:00:00Z') }),
            config,
            promotion,
            [],
            now,
        );
        expect(result?.after).toMatchObject({ status: 'RETURNED', validUntil: '2026-09-08T12:00:00.000Z' });
    });
    it.each([
        ['disabled campaign', { enabled: false }, [], now],
        ['deleted campaign', { deletedAt: now }, [], now],
        ['outstanding redemption', {}, [{ status: 'USED' }], now],
        ['already beyond full validity', {}, [], new Date('2026-09-09T12:00:00Z')],
    ])('does not reopen an expired coupon for %s', (_name, override, allocations, at) => {
        expect(
            couponRepairChange(makeCoupon(), config, { ...promotion, ...override }, allocations as any, at)
                ?.after.status,
        ).toBe('EXPIRED');
    });
    it('does not modify revoked, indefinite or manually extended coupons', () => {
        for (const overrides of [
            { status: 'REVOKED' },
            { revokedAt: now },
            { validUntil: null },
            { validUntil: new Date('2026-09-20T12:00:00Z') },
        ]) {
            expect(couponRepairChange(makeCoupon(overrides), config, promotion, [], now)).toBeNull();
        }
    });
    it('is a no-op on the second pass and leaves fixed-window coupons unchanged', () => {
        expect(
            couponRepairChange(
                makeCoupon({
                    status: 'AVAILABLE',
                    validUntil: new Date('2026-09-08T12:00:00Z'),
                    expiredAt: null,
                }),
                config,
                promotion,
                [],
                now,
            ),
        ).toBeNull();
        expect(
            couponRepairChange(makeCoupon(), { validityDays: null } as any, promotion, [], now),
        ).toBeNull();
    });
});
