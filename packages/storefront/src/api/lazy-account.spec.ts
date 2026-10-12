// organize-imports-ignore -- Preserve the ESLint type-import groups.
import type { ShopApiContext } from './client-context';
import { describe, expect, it, vi } from 'vitest';

import { AccountApi } from './account';
import { lazyAccountApi } from './lazy-account';

function context(request = vi.fn().mockResolvedValue({ activeCustomer: { addresses: [] } })) {
    return {
        request,
        authenticationRequest: vi.fn(),
        assertNoError: vi.fn(),
        market: { code: 'synthetic-a', currencyCode: 'MYR' },
        languageCode: 'en',
    } as unknown as ShopApiContext;
}

describe('deferred account domain', () => {
    it('reads only lightweight identity without loading account operations', async () => {
        const request = vi.fn().mockResolvedValue({
            activeCustomer: { id: 'buyer' },
            myCustomerAvatar: { id: 'avatar', preview: '/synthetic/avatar.png' },
        });
        const load = vi.fn().mockResolvedValue({ AccountApi });
        const api = lazyAccountApi(context(request), load);
        const signal = new AbortController().signal;
        expect(await api.customerIdentity(signal)).toEqual({
            id: 'buyer',
            avatar: { id: 'avatar', preview: '/synthetic/avatar.png' },
        });
        expect(load).not.toHaveBeenCalled();
        expect(request).toHaveBeenCalledTimes(1);
        expect(request.mock.calls[0][0]).toContain('StorefrontCustomerIdentity');
        expect(request.mock.calls[0][0]).not.toMatch(/\b(?:addresses|orders)\b/u);
        expect(request.mock.calls[0][2]).toBe(signal);
    });

    it('shares one account load for concurrent reads while preserving arguments and results', async () => {
        const request = vi
            .fn()
            .mockImplementation((query: string) =>
                Promise.resolve(
                    query.includes('StorefrontCustomerAddresses')
                        ? { activeCustomer: { addresses: [{ id: 'address' }] } }
                        : { activeCustomer: { orders: { items: [], totalItems: 0 } } },
                ),
            );
        const constructed = vi.fn();
        class CountedAccount extends AccountApi {
            constructor(accountContext: ShopApiContext) {
                super(accountContext);
                constructed(accountContext);
            }
        }
        const load = vi.fn().mockResolvedValue({ AccountApi: CountedAccount });
        const ctx = context(request);
        const api = lazyAccountApi(ctx, load);
        const addressesSignal = new AbortController().signal;
        const ordersSignal = new AbortController().signal;
        const [addresses, orders] = await Promise.all([
            api.customerAddresses(addressesSignal),
            api.customerRecentOrders(ordersSignal),
        ]);
        expect(addresses).toEqual([{ id: 'address' }]);
        expect(orders).toEqual({ items: [], totalItems: 0 });
        expect(load).toHaveBeenCalledTimes(1);
        expect(constructed).toHaveBeenCalledExactlyOnceWith(ctx);
        expect(request).toHaveBeenCalledTimes(2);
        expect(request.mock.calls.map(call => call[2])).toEqual([addressesSignal, ordersSignal]);
        const method: unknown = Reflect.get(api, 'customerAddresses');
        expect(Reflect.get(api, 'customerAddresses')).toBe(method);
    });

    it('preserves the order ID, cancellation and original read currency', async () => {
        const request = vi.fn().mockResolvedValue({ order: { id: 'original-order' } });
        const api = lazyAccountApi(context(request), () => Promise.resolve({ AccountApi }));
        const signal = new AbortController().signal;
        expect(await api.order('original-order', signal, 'CNY')).toEqual({ id: 'original-order' });
        expect(request).toHaveBeenCalledTimes(1);
        expect(request.mock.calls[0][1]).toEqual({ id: 'original-order' });
        expect(request.mock.calls[0][2]).toBe(signal);
        expect(request.mock.calls[0][5]).toBe('CNY');
    });

    it('rejects cancellation during module loading without executing a late account read', async () => {
        let complete!: (module: { AccountApi: typeof AccountApi }) => void;
        const load = vi.fn(
            () =>
                new Promise<{ AccountApi: typeof AccountApi }>(resolve => {
                    complete = resolve;
                }),
        );
        const request = vi.fn().mockResolvedValue({ activeCustomer: { addresses: [] } });
        const api = lazyAccountApi(context(request), load);
        const controller = new AbortController();
        const pending = api.customerAddresses(controller.signal);
        await Promise.resolve();
        controller.abort();
        await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
        complete({ AccountApi });
        await Promise.resolve();
        await Promise.resolve();
        expect(request).not.toHaveBeenCalled();
        expect(await api.customerAddresses()).toEqual([]);
        expect(load).toHaveBeenCalledTimes(1);
        expect(request).toHaveBeenCalledTimes(1);
    });

    it('does not load any module for an already cancelled read', async () => {
        const load = vi.fn().mockResolvedValue({ AccountApi });
        const request = vi.fn();
        const controller = new AbortController();
        controller.abort();
        const api = lazyAccountApi(context(request), load);
        await expect(
            api.customerOrders(0, 10, undefined, undefined, controller.signal),
        ).rejects.toMatchObject({ name: 'AbortError' });
        expect(load).not.toHaveBeenCalled();
        expect(request).not.toHaveBeenCalled();
    });

    it('clears a failed module load for the next explicit call without replaying operations', async () => {
        const failure = new Error('Temporary account chunk failure');
        const load = vi.fn().mockRejectedValueOnce(failure).mockResolvedValueOnce({ AccountApi });
        const request = vi.fn().mockResolvedValue({ activeCustomer: { addresses: [] } });
        const api = lazyAccountApi(context(request), load);
        await expect(api.customerAddresses()).rejects.toBe(failure);
        expect(request).not.toHaveBeenCalled();
        expect(load).toHaveBeenCalledTimes(1);
        expect(await api.customerAddresses()).toEqual([]);
        expect(load).toHaveBeenCalledTimes(2);
        expect(request).toHaveBeenCalledTimes(1);
    });

    it('never retries a failed write and retains the loaded domain for a later user action', async () => {
        const failure = new Error('Authentication response unavailable');
        const ctx = context();
        ctx.authenticationRequest = vi
            .fn()
            .mockRejectedValueOnce(failure)
            .mockResolvedValueOnce({ login: { __typename: 'CurrentUser', id: 'buyer' } });
        const load = vi.fn().mockResolvedValue({ AccountApi });
        const api = lazyAccountApi(ctx, load);
        await expect(api.login('synthetic@example.invalid', 'synthetic-password')).rejects.toBe(failure);
        expect(ctx.authenticationRequest).toHaveBeenCalledTimes(1);
        expect(load).toHaveBeenCalledTimes(1);
        await api.login('synthetic@example.invalid', 'synthetic-password');
        expect(ctx.authenticationRequest).toHaveBeenCalledTimes(2);
        expect(load).toHaveBeenCalledTimes(1);
    });

    it('isolates each store context and exposes every existing account method without eagerly importing it', async () => {
        const requestA = vi.fn().mockResolvedValue({ activeCustomer: { addresses: [{ id: 'a' }] } });
        const requestB = vi.fn().mockResolvedValue({ activeCustomer: { addresses: [{ id: 'b' }] } });
        const load = vi.fn().mockResolvedValue({ AccountApi });
        const a = lazyAccountApi(context(requestA), load);
        const b = lazyAccountApi(context(requestB), load);
        for (const name of Object.getOwnPropertyNames(AccountApi.prototype).filter(
            key => key !== 'constructor',
        ))
            expect(typeof Reflect.get(a, name)).toBe('function');
        expect(Reflect.get(a, 'then')).toBeUndefined();
        expect(load).not.toHaveBeenCalled();
        expect(await a.customerAddresses()).toEqual([{ id: 'a' }]);
        expect(await b.customerAddresses()).toEqual([{ id: 'b' }]);
        expect(load).toHaveBeenCalledTimes(2);
        expect(requestA).toHaveBeenCalledTimes(1);
        expect(requestB).toHaveBeenCalledTimes(1);
    });
});
