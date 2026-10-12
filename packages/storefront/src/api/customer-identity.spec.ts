// organize-imports-ignore -- Preserve the ESLint type-import groups.
import type { ShopApiContext } from './client-context';
import { describe, expect, it, vi } from 'vitest';

import { AccountApi } from './account';

describe('customer field selection', () => {
    it('identity reads only identity and bounded avatar fields, forwarding cancellation', async () => {
        const request = vi.fn().mockResolvedValue({
            activeCustomer: { id: 'buyer' },
            myCustomerAvatar: { id: 'avatar', preview: '/assets/avatar.png' },
        });
        const api = new AccountApi({ request } as unknown as ShopApiContext);
        const signal = new AbortController().signal;
        expect(await api.customerIdentity(signal)).toMatchObject({ id: 'buyer', avatar: { id: 'avatar' } });
        const [document, variables, actualSignal] = request.mock.calls[0];
        expect(document).not.toMatch(/\b(?:addresses|orders)\b/u);
        expect(variables).toBeUndefined();
        expect(actualSignal).toBe(signal);
    });
    it('reads addresses and five recent order summaries only when their caller requests them', async () => {
        const request = vi
            .fn()
            .mockResolvedValueOnce({ activeCustomer: { addresses: [] } })
            .mockResolvedValueOnce({ activeCustomer: { orders: { items: [], totalItems: 0 } } });
        const api = new AccountApi({ request } as unknown as ShopApiContext);
        expect(await api.customerAddresses()).toEqual([]);
        expect(await api.customerRecentOrders()).toEqual({ items: [], totalItems: 0 });
        expect(request.mock.calls[0][0]).not.toMatch(/\borders\b/u);
        expect(request.mock.calls[1][0]).not.toMatch(/\baddresses\b/u);
        expect(request.mock.calls[1][0]).toContain('take: 5');
    });
    it('distinguishes a confirmed guest from an empty authenticated resource and preserves failures', async () => {
        const request = vi.fn().mockResolvedValue({ activeCustomer: null });
        const api = new AccountApi({ request } as unknown as ShopApiContext);
        expect(await api.customerIdentity()).toBeNull();
        expect(await api.customerAddresses()).toBeNull();
        expect(await api.customerRecentOrders()).toBeNull();
        request.mockRejectedValueOnce(new Error('network'));
        await expect(api.customerIdentity()).rejects.toThrow('network');
    });
});
