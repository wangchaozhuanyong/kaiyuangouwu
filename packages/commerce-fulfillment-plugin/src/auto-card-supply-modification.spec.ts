import { describe, expect, it, vi } from 'vitest';

import { AutoCardSupplyService } from './auto-card-supply.service';

function fixture() {
    const snapshot = {
        quantity: 1,
        channelId: 'store',
        sourceChannelId: 'supplier',
        configId: 'config',
        grantId: 'grant',
        grantVersion: 2,
        configSnapshot: { instructions: 'Original purchased instructions' },
    };
    const config = { id: 'config', channelId: 'supplier', instructions: 'Changed instructions' };
    const saved = vi.fn();
    const current = { config, grant: { id: 'grant', version: 2 } };
    const service = Object.assign(Object.create(AutoCardSupplyService.prototype), {
        connection: {
            getRepository: (_ctx: unknown, entity: { name: string }) => ({
                findOne: vi
                    .fn()
                    .mockResolvedValue(entity.name === 'AutoCardSupplySnapshot' ? snapshot : config),
                save: saved,
            }),
        },
        resolve: vi.fn().mockResolvedValue(current),
    }) as AutoCardSupplyService;
    const line: any = { id: 'line', productVariantId: 'variant', quantity: 2, orderPlacedQuantity: 2 };
    const order: any = {
        id: 'order',
        salesChannelId: 'store',
        active: false,
        state: 'PaymentSettled',
        totalWithTax: 2000,
        payments: [{ state: 'Settled', method: 'gateway', amount: 2000, refunds: [] }],
    };
    return { service, snapshot, config, current, saved, line, order };
}

describe('paid card quantity changes retain their original supply', () => {
    it('extends a funded quantity with the same current grant while preserving purchased content formatting', async () => {
        const h = fixture();
        const result = await h.service.forPaidLine({ channelId: 'store' } as any, h.order, h.line);
        expect(h.saved).toHaveBeenCalledOnce();
        expect(h.snapshot.quantity).toBe(2);
        expect(result?.config.instructions).toBe('Original purchased instructions');
        await h.service.forPaidLine({ channelId: 'store' } as any, h.order, h.line);
        expect(h.saved).toHaveBeenCalledOnce();
    });
    it.each(['unfunded', 'test', 'pending', 'changed-grant', 'changed-source', 'revoked'])(
        'rejects %s before extending the supply snapshot',
        async reason => {
            const h = fixture();
            if (reason === 'unfunded') h.order.payments[0].amount = 1000;
            if (reason === 'test') h.order.payments[0].metadata = { public: { testPayment: true } };
            if (reason === 'pending') h.order.state = 'ArrangingAdditionalPayment';
            if (reason === 'changed-grant') h.current.grant.version = 3;
            if (reason === 'changed-source') h.config.channelId = 'other-supplier';
            if (reason === 'revoked') (h.service.resolve as any).mockResolvedValue(null);
            await expect(
                h.service.forPaidLine({ channelId: 'store' } as any, h.order, h.line),
            ).rejects.toThrow('待核验');
            expect(h.saved).not.toHaveBeenCalled();
        },
    );
    it('retains the historical snapshot after reducing quantity', async () => {
        const h = fixture();
        h.snapshot.quantity = 2;
        h.line.quantity = 1;
        await h.service.forPaidLine({ channelId: 'store' } as any, h.order, h.line);
        expect(h.saved).not.toHaveBeenCalled();
        expect(h.snapshot.quantity).toBe(2);
    });
});
