import { describe, expect, it, vi } from 'vitest';

import { PaymentMethodService } from './payment-method.service';

describe('new payment quote filters', () => {
    it('applies registered policy after normal method eligibility without changing active methods', async () => {
        const method = { id: 'real', code: 'real', name: '真实支付', checker: null };
        const service = Object.assign(Object.create(PaymentMethodService.prototype), {
            eligibilityFilters: new Map(),
            getActivePaymentMethods: vi.fn().mockResolvedValue([method]),
        }) as PaymentMethodService;
        const filter = vi.fn().mockResolvedValue([]);
        service.registerEligibilityFilter('preview', filter);
        const ctx = {} as any;
        const order = { salesChannelId: 'store' } as any;
        expect(await service.getEligiblePaymentMethods(ctx, order)).toEqual([]);
        expect(filter).toHaveBeenCalledWith(ctx, order, [
            expect.objectContaining({ code: 'real', isEligible: true }),
        ]);
        expect(await service.getActivePaymentMethods(ctx)).toEqual([method]);
    });
});
