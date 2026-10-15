import { CatalogSyncBinding, CatalogSyncRule, Channel } from '@vendure/core';
import { describe, expect, it, vi } from 'vitest';

import { CatalogSyncShippingService } from './catalog-sync-shipping.service';

function fixture(state: 'ACTIVE' | 'REMOVED' | null) {
    const ctx: any = { channelId: 'target', languageCode: 'en', currencyCode: 'MYR' };
    const order: any = {
        state: 'AddingItems',
        lines: [
            {
                id: 'local-line',
                productVariantId: 'local-variant',
                customFields: { fulfillmentTypeSnapshot: 'physical' },
            },
        ],
    };
    const method: any = { id: state ? 'inherited-shipping' : 'local-shipping' };
    const bindings = state
        ? [{ ruleId: 'rule', state, sourceChannelId: 'source', sourceId: 'source-shipping' }]
        : [];
    const repositories = new Map<string, any>([
        [CatalogSyncBinding.name, { find: vi.fn().mockResolvedValue(bindings) }],
        [
            CatalogSyncRule.name,
            { find: vi.fn().mockResolvedValue(state === 'ACTIVE' ? [{ id: 'rule', enabled: true }] : []) },
        ],
    ]);
    const connection: any = {
        getRepository: vi.fn((_ctx: unknown, entity: { name: string }) => repositories.get(entity.name)),
    };
    const sources: any = {
        hasManagedProducts: vi.fn().mockResolvedValue(false),
        context: vi.fn().mockResolvedValue(ctx),
    };
    const shipping: any = {};
    return {
        ctx,
        order,
        method,
        sources,
        repositories,
        shipping,
        service: new CatalogSyncShippingService(connection, sources, shipping),
    };
}

describe('inherited shipping after the final managed product leaves', () => {
    it.each(['ACTIVE', 'REMOVED'] as const)(
        'excludes a %s inherited mapping from the target own order',
        async state => {
            const f = fixture(state);
            await expect(f.service.scope(f.ctx, f.order, f.method)).resolves.toBeNull();
        },
    );

    it('preserves independent target shipping without requiring a managed product', async () => {
        const f = fixture(null);
        await expect(f.service.scope(f.ctx, f.order, f.method)).resolves.toMatchObject({
            ctx: f.ctx,
            order: f.order,
            groupId: 'target',
            sourceMethod: undefined,
        });
        expect(f.sources.context).not.toHaveBeenCalled();
    });

    it('still resolves an accepted order through its original line source after withdrawal', async () => {
        const f = fixture('ACTIVE');
        const source = { id: 'source', defaultCurrencyCode: 'MYR', customFields: {} };
        f.order.state = 'PaymentSettled';
        f.ctx.channel = { id: 'target', defaultCurrencyCode: 'MYR', customFields: {} };
        f.ctx.copy = vi.fn((options: any) => ({ ...f.ctx, ...options, channelId: options.channel.id }));
        f.sources.context.mockResolvedValue({ channelId: 'source' });
        f.repositories.set(Channel.name, { findOne: vi.fn().mockResolvedValue(source) });
        f.shipping.getActiveShippingMethods = vi.fn().mockResolvedValue([
            {
                id: 'source-shipping',
                calculator: {
                    code: 'physical-subtotal-shipping-calculator',
                    args: [
                        { name: 'baseRate', value: '300' },
                        { name: 'freeAbove', value: '0' },
                        { name: 'sourceCurrencyCode', value: 'MYR' },
                    ],
                },
            },
        ]);
        const scope = await f.service.scope(f.ctx, f.order, f.method);
        expect(scope?.groupId).toBe('source');
        expect(scope?.order.lines).toEqual(f.order.lines);
        expect(f.sources.context).toHaveBeenCalledWith(f.ctx, 'local-variant', 'local-line', true);
    });
});
