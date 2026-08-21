import { describe, expect, it, vi } from 'vitest';

import { StockLevelService } from './stock-level.service';

function createService(affected = 1) {
    const repository = {
        increment: vi.fn().mockResolvedValue({ affected }),
        save: vi.fn().mockImplementation(value => Promise.resolve(value)),
    };
    const connection = { getRepository: vi.fn().mockReturnValue(repository) };
    return {
        service: new StockLevelService(connection as any, {} as any, {} as any),
        repository,
    };
}

describe('StockLevelService atomic updates', () => {
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
