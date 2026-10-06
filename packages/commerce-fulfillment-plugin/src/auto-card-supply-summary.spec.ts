import { CatalogResourceOwnership, ProductVariant } from '@vendure/core';
import { describe, expect, it, vi } from 'vitest';

import { AutoCardSupplyService } from './auto-card-supply.service';
import { AutoCardConfig } from './entities/auto-card-config.entity';
import { AutoCardDelivery } from './entities/auto-card-delivery.entity';
import { AutoCardSupplyGrant } from './entities/auto-card-supply-grant.entity';

describe('admin supply read batches', () => {
    it.each([12, 48])(
        '%i grants use one aggregate quantity read without exposing delivery/customer records',
        async size => {
            const grants = Array.from({ length: size }, (_, id) => ({
                id,
                channelId: `store-${id}`,
                enabled: true,
            }));
            const qb = {
                select: vi.fn().mockReturnThis(),
                addSelect: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                groupBy: vi.fn().mockReturnThis(),
                addGroupBy: vi.fn().mockReturnThis(),
                getRawMany: vi.fn(() =>
                    Promise.resolve(
                        grants.flatMap(grant => [
                            { grantId: grant.id, state: 'SENT', quantity: '2' },
                            { grantId: grant.id, state: 'WAITING_STOCK', quantity: '3' },
                            { grantId: grant.id, state: 'ALLOCATED', quantity: '1' },
                        ]),
                    ),
                ),
            };
            const grantFind = vi.fn().mockResolvedValue(grants);
            const connection = {
                getRepository: (_ctx: unknown, entity: unknown) =>
                    entity === AutoCardSupplyGrant
                        ? { find: grantFind }
                        : entity === AutoCardDelivery
                          ? { createQueryBuilder: () => qb }
                          : undefined,
            };
            const service = new AutoCardSupplyService(connection as any, {} as any, {} as any);
            const result = await service.supplierSummary(
                { channel: { code: 'store-a' }, channelId: 'A' } as any,
                'variant',
            );
            expect(result).toHaveLength(size);
            expect(result[0]).toEqual({
                grantId: '0',
                channelId: 'store-0',
                enabled: true,
                deliveredQuantity: 2,
                waitingQuantity: 3,
                allocatedQuantity: 1,
            });
            expect(grantFind).toHaveBeenCalledTimes(1);
            expect(qb.getRawMany).toHaveBeenCalledTimes(1);
            expect(qb.where).toHaveBeenCalledWith(
                expect.stringContaining('delivery.sourceChannelId = :source'),
                { source: 'A', grantIds: grants.map(grant => grant.id) },
            );
        },
    );

    it('platform supply editor reads all source configurations once, preserving locale fallback and owner scope', async () => {
        const variants = Array.from({ length: 48 }, (_, id) => ({
            id,
            translations: [{ languageCode: 'en', name: `variant-${id}` }],
        }));
        const configFind = vi.fn().mockResolvedValue(
            variants.map(variant => ({
                id: `config-${variant.id}`,
                productVariantId: variant.id,
                enabled: true,
            })),
        );
        const assertPlatform = vi.fn();
        const query = { where: vi.fn().mockReturnThis(), getMany: vi.fn().mockResolvedValue([]) };
        const connection = {
            getRepository: (_ctx: unknown, entity: unknown) =>
                entity === CatalogResourceOwnership
                    ? { findOne: vi.fn().mockResolvedValue({ ownerChannelId: 'owner' }) }
                    : entity === ProductVariant
                      ? { find: vi.fn().mockResolvedValue(variants) }
                      : entity === AutoCardConfig
                        ? { find: configFind }
                        : { createQueryBuilder: () => query },
        };
        const service = new AutoCardSupplyService(connection as any, { assertPlatform } as any, {} as any);
        const result = await service.catalog({ languageCode: 'zh_Hans' } as any, 'product');
        expect(assertPlatform).toHaveBeenCalledTimes(1);
        expect(configFind).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({ where: expect.objectContaining({ channelId: 'owner' }) }),
        );
        expect(result.configurations).toHaveLength(48);
        expect(result.configurations[47]).toEqual({
            configId: 'config-47',
            productVariantId: '47',
            name: 'variant-47',
            enabled: true,
        });
    });
});
