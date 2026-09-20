import { describe, expect, it, vi } from 'vitest';

import { InventoryLot } from './entities/inventory-lot.entity';
import { InventoryOperation } from './entities/inventory-operation.entity';
import { InventoryControlService } from './inventory-control.service';

describe('inventory control idempotency', () => {
    it('returns the original lot when a manual count request is retried', async () => {
        const operationRepository = {
            findOne: vi.fn().mockResolvedValue({
                type: 'MANUAL_LOT_COUNT',
                lines: [{ inventoryLotId: 7 }],
            }),
        };
        const lotRepository = {
            findOne: vi.fn().mockResolvedValue({
                id: 7,
                variantId: 3,
                stockLocationId: 4,
                lotCode: 'LOT-7',
                quantityOnHand: 8,
                purchaseCostMicrounits: null,
                currencyCode: 'CNY',
                state: 'ACTIVE',
                expiresAt: null,
            }),
        };
        const connection = {
            withTransaction: vi.fn((ctx, work) => work(ctx)),
            getRepository: vi.fn((_ctx, entity) => {
                if (entity === InventoryOperation) return operationRepository;
                if (entity === InventoryLot) return lotRepository;
                throw new Error(`Unexpected repository ${String(entity)}`);
            }),
        };
        const operations = { saveLot: vi.fn() };
        const service = new InventoryControlService(connection as never, operations as never, {} as never);

        const result = await service.saveManualLot({ channelId: 1 } as never, {
            productVariantId: 3,
            stockLocationId: 4,
            lotCode: 'LOT-7',
            quantityOnHand: 8,
            currencyCode: 'CNY' as never,
            idempotencyKey: 'manual-count-7',
            reason: '月底盘点',
        });

        expect(result).toMatchObject({ id: 7, lotCode: 'LOT-7', quantityOnHand: 8 });
        expect(operations.saveLot).not.toHaveBeenCalled();
    });
});

describe('inventory transfer guardrails', () => {
    it('rejects a transfer back into the source warehouse', async () => {
        const operationRepository = { findOne: vi.fn().mockResolvedValue(null) };
        const lotQuery = {
            where: vi.fn().mockReturnThis(),
            getOne: vi.fn().mockResolvedValue({
                id: 7,
                variantId: 3,
                stockLocationId: 4,
                lotCode: 'LOT-7',
                quantityOnHand: 8,
            }),
        };
        const lotRepository = {
            manager: {
                connection: { options: { type: 'sqljs' } },
                queryRunner: { isTransactionActive: true },
            },
            findOne: vi.fn().mockResolvedValue({
                id: 7,
                variantId: 3,
                stockLocationId: 4,
                lotCode: 'LOT-7',
                quantityOnHand: 8,
            }),
            createQueryBuilder: vi.fn().mockReturnValue(lotQuery),
        };
        const connection = {
            withTransaction: vi.fn((ctx, work) => work(ctx)),
            getRepository: vi.fn((_ctx, entity) => {
                if (entity === InventoryOperation) return operationRepository;
                if (entity === InventoryLot) return lotRepository;
                throw new Error(`Unexpected repository ${String(entity)}`);
            }),
        };
        const service = new InventoryControlService(connection as never, {} as never, {} as never);

        await expect(
            service.transferLot({ channelId: 1 } as never, {
                inventoryLotId: 7,
                targetStockLocationId: 4,
                quantity: 1,
                idempotencyKey: 'transfer-7',
                reason: '仓位调拨',
            }),
        ).rejects.toThrow('目标仓库不能与来源仓库相同');
    });
});
