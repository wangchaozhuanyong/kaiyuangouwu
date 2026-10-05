import { Permission } from '@vendure/common/lib/generated-types';
import assert from 'node:assert/strict';
import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';

import { Customer } from '../../../entity/customer/customer.entity';
import { RequestContext } from '../../common/request-context';

import { CustomerEntityResolver } from './customer-entity.resolver';
function fixture(userId: string | number | undefined = 'owner', readCustomer = false) {
    const addresses = [{ id: 'address-1' }];
    const orders = { items: [{ id: 'order-1' }], totalItems: 1 };
    const customer = { id: 'customer-1', user: { id: 'owner' } } as Customer;
    const customerService = {
        findOne: vi.fn().mockResolvedValue(customer),
        findAddressesByCustomerId: vi.fn().mockResolvedValue(addresses),
    };
    const orderService = { findByCustomerId: vi.fn().mockResolvedValue(orders) };
    const ctx = {
        activeUserId: userId,
        userHasPermissions: vi.fn().mockReturnValue(readCustomer),
    } as unknown as RequestContext;
    return {
        addresses,
        orders,
        customer,
        customerService,
        orderService,
        ctx,
        resolver: new CustomerEntityResolver(customerService as any, orderService as any),
    };
}
async function expectNoCustomerData(f: ReturnType<typeof fixture>, apiType: 'shop' | 'admin') {
    await expect(f.resolver.addresses(f.ctx, f.customer, apiType)).resolves.toEqual([]);
    await expect(f.resolver.orders(f.ctx, f.customer, {}, apiType, [])).resolves.toEqual({
        items: [],
        totalItems: 0,
    });
    await expect(f.resolver.user(f.ctx, f.customer, apiType)).resolves.toBeNull();
    expect(f.customerService.findAddressesByCustomerId).not.toHaveBeenCalled();
    expect(f.orderService.findByCustomerId).not.toHaveBeenCalled();
}
describe('Customer nested-field authorization', () => {
    it('does not expose account data to an anonymous order confirmation recipient', async () => {
        const f = fixture();
        Object.assign(f.ctx, { activeUserId: undefined });
        await expectNoCustomerData(f, 'shop');
        expect(f.customerService.findOne).not.toHaveBeenCalled();
    });
    it('does not let a logged-in order confirmation recipient read another customer', async () => {
        const f = fixture('other-user');
        await expectNoCustomerData(f, 'shop');
        expect(f.customerService.findOne).not.toHaveBeenCalled();
    });
    it('does not use Admin customer permissions to bypass Shop ownership', async () => {
        const f = fixture('other-user', true);
        await expectNoCustomerData(f, 'shop');
        // eslint-disable-next-line @typescript-eslint/unbound-method -- Vitest inspects the existing mock without invoking the method.
        expect(f.ctx.userHasPermissions).not.toHaveBeenCalled();
    });
    it('preserves the owner address book, order options and user relation', async () => {
        const f = fixture(42);
        requireFixture(f.customer.user).id = '42';
        const options = { take: 2 };
        const relations = ['lines'] as const;
        await expect(f.resolver.addresses(f.ctx, f.customer, 'shop')).resolves.toBe(f.addresses);
        await expect(f.resolver.orders(f.ctx, f.customer, { options }, 'shop', [...relations])).resolves.toBe(
            f.orders,
        );
        await expect(f.resolver.user(f.ctx, f.customer, 'shop')).resolves.toBe(f.customer.user);
        expect(f.customerService.findAddressesByCustomerId).toHaveBeenCalledWith(f.ctx, f.customer.id);
        expect(f.orderService.findByCustomerId).toHaveBeenCalledWith(
            f.ctx,
            f.customer.id,
            options,
            relations,
        );
        expect(f.customerService.findOne).not.toHaveBeenCalled();
    });
    it('loads the actual user relation before allowing an unhydrated Shop customer', async () => {
        const f = fixture();
        const user = f.customer.user;
        f.customer = { id: f.customer.id } as Customer;
        await expect(f.resolver.user(f.ctx, f.customer, 'shop')).resolves.toBe(user);
        expect(f.customerService.findOne).toHaveBeenCalledExactlyOnceWith(f.ctx, f.customer.id, ['user']);
    });
    it('rejects an unhydrated customer whose actual user belongs to someone else', async () => {
        const f = fixture('other-user');
        f.customer = { id: f.customer.id } as Customer;
        await expectNoCustomerData(f, 'shop');
        expect(f.customerService.findOne).toHaveBeenCalledWith(f.ctx, f.customer.id, ['user']);
    });
    it.each([undefined, { id: 'customer-1' }])(
        'keeps a missing or guest customer private in Shop',
        async loaded => {
            const f = fixture();
            f.customer = { id: 'customer-1' } as Customer;
            f.customerService.findOne.mockResolvedValue(loaded as any);
            await expectNoCustomerData(f, 'shop');
        },
    );
    it('allows an Admin with ReadCustomer to read a different customer', async () => {
        const f = fixture('admin-user', true);
        await expect(f.resolver.addresses(f.ctx, f.customer, 'admin')).resolves.toBe(f.addresses);
        await expect(f.resolver.orders(f.ctx, f.customer, {}, 'admin', [])).resolves.toBe(f.orders);
        await expect(f.resolver.user(f.ctx, f.customer, 'admin')).resolves.toBe(f.customer.user);
        // eslint-disable-next-line @typescript-eslint/unbound-method -- Vitest inspects the existing mock without invoking the method.
        expect(f.ctx.userHasPermissions).toHaveBeenCalledWith([Permission.ReadCustomer]);
    });
    it('requires ReadCustomer on Admin even when the active user matches the customer', async () => {
        const f = fixture('owner', false);
        await expectNoCustomerData(f, 'admin');
        expect(f.customerService.findOne).not.toHaveBeenCalled();
        // eslint-disable-next-line @typescript-eslint/unbound-method -- Vitest inspects the existing mock without invoking the method.
        expect(f.ctx.userHasPermissions).toHaveBeenCalledWith([Permission.ReadCustomer]);
    });
    it('preserves authorized Admin reads of guest customers', async () => {
        const f = fixture('admin-user', true);
        f.customer = { id: f.customer.id } as Customer;
        f.customerService.findOne.mockResolvedValue(f.customer);
        await expect(f.resolver.addresses(f.ctx, f.customer, 'admin')).resolves.toBe(f.addresses);
        await expect(f.resolver.orders(f.ctx, f.customer, {}, 'admin', [])).resolves.toBe(f.orders);
        await expect(f.resolver.user(f.ctx, f.customer, 'admin')).resolves.toBeNull();
        expect(f.customerService.findOne).toHaveBeenCalledExactlyOnceWith(f.ctx, f.customer.id, ['user']);
    });
});

function requireFixture<T>(value: T | null | undefined): T {
    assert(value !== null && value !== undefined, 'Required synthetic fixture is missing');
    return value;
}
