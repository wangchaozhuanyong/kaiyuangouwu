import { describe, expect, it, vi } from 'vitest';

import { StockLevelService } from './stock-level.service';

function createService(affected = 1, supportsStockLocations = true) {
    const repository = {
        increment: vi.fn().mockResolvedValue({ affected }),
        save: vi.fn().mockImplementation(value => Promise.resolve(value)),
    };
    const connection = {
        getRepository: vi.fn().mockReturnValue(repository),
        getEntityOrThrow: vi.fn().mockResolvedValue({ id: 'variant-1' }),
    };
    const stockLocationService = {
        supportsStockLocations: vi.fn().mockResolvedValue(supportsStockLocations),
    };
    return {
        service: new StockLevelService(connection as any, stockLocationService as any, {} as any),
        repository,
    };
}

describe('StockLevelService atomic updates', () => {
    it('rejects warehouse updates for variants outside the physical stock domain', async () => {
        const { service, repository } = createService(1, false);

        await expect(
            service.updateStockAllocatedForLocation({} as any, 'variant-1', 'location-1', 2),
        ).rejects.toThrow('该商品不使用仓库库存');
        await expect(
            service.updateStockOnHandForLocation({} as any, 'variant-1', 'location-1', 2),
        ).rejects.toThrow('该商品不使用仓库库存');

        expect(repository.increment).not.toHaveBeenCalled();
        expect(repository.save).not.toHaveBeenCalled();
    });

    it('increments allocated stock in the database without a read-modify-write race', async () => {
        const { service, repository } = createService();

        await service.updateStockAllocatedForLocation({} as any, 'variant-1', 'location-1', 2);

        expect(repository.increment).toHaveBeenCalledWith(
            { productVariantId: 'variant-1', stockLocationId: 'location-1' },
            'stockAllocated',
            2,
        );
    });

    it('increments on-hand stock atomically and creates a missing stock row', async () => {
        const existing = createService();
        await existing.service.updateStockOnHandForLocation({} as any, 'variant-1', 'location-1', -1);
        expect(existing.repository.save).not.toHaveBeenCalled();

        const missing = createService(0);
        await missing.service.updateStockOnHandForLocation({} as any, 'variant-1', 'location-1', 3);
        expect(missing.repository.save).toHaveBeenCalledWith(
            expect.objectContaining({ stockOnHand: 3, stockAllocated: 0 }),
        );
    });
});
