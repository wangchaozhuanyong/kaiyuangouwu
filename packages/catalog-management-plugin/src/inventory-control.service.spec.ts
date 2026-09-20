import { StockLevel } from '@vendure/core';
import { describe, expect, it, vi } from 'vitest';

import { InventoryLot } from './entities/inventory-lot.entity';
import { InventoryOperationLine } from './entities/inventory-operation-line.entity';
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

describe('customer return inventory audit', () => {
    it('posts stock and lot deltas under one idempotent customer-return operation', async () => {
        const operation = { id: 41, type: 'CUSTOMER_RETURN', lines: [] };
        const operationRepository = {
            findOne: vi.fn().mockResolvedValue(null),
            save: vi.fn().mockResolvedValue(operation),
            findOneOrFail: vi.fn().mockResolvedValue(operation),
        };
        const lineRepository = { save: vi.fn().mockImplementation(value => Promise.resolve(value)) };
        const stockQuery = {
            where: vi.fn().mockReturnThis(),
            andWhere: vi.fn().mockReturnThis(),
            getOne: vi.fn().mockResolvedValue({ stockOnHand: 7 }),
        };
        const stockRepository = {
            manager: {
                connection: { options: { type: 'sqljs' } },
                queryRunner: { isTransactionActive: true },
            },
            createQueryBuilder: vi.fn().mockReturnValue(stockQuery),
        };
        const lotQuery = {
            where: vi.fn().mockReturnThis(),
            andWhere: vi.fn().mockReturnThis(),
            getOne: vi.fn().mockResolvedValue({ id: 9, quantityOnHand: 3 }),
        };
        const lotRepository = {
            manager: {
                connection: { options: { type: 'sqljs' } },
                queryRunner: { isTransactionActive: true },
            },
            createQueryBuilder: vi.fn().mockReturnValue(lotQuery),
        };
        const connection = {
            withTransaction: vi.fn((ctx, work) => work(ctx)),
            getRepository: vi.fn((_ctx, entity) => {
                if (entity === InventoryOperation) return operationRepository;
                if (entity === InventoryOperationLine) return lineRepository;
                if (entity === StockLevel) return stockRepository;
                if (entity === InventoryLot) return lotRepository;
                throw new Error(`Unexpected repository ${String(entity)}`);
            }),
        };
        const operations = {
            changeLotQuantity: vi.fn().mockResolvedValue({ id: 9 }),
        };
        const service = new InventoryControlService(connection as never, operations as never, {} as never);

        const result = await service.receiveCustomerReturn({ channelId: 1, activeUserId: 2 } as never, {
            idempotencyKey: 'after-sales-return-41',
            reason: '售后质检合格回库',
            reference: 'AS-41',
            lines: [
                {
                    productVariantId: 3,
                    stockLocationId: 4,
                    lotCode: 'RETURN-AS-41',
                    quantity: 2,
                    currencyCode: 'CNY' as never,
                    purchaseCostMicrounits: null,
                },
            ],
        });

        expect(result).toBe(operation);
        expect(operations.changeLotQuantity).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ id: 9, quantityDelta: 2, lotCode: 'RETURN-AS-41' }),
        );
        expect(operationRepository.save).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'CUSTOMER_RETURN',
                idempotencyKey: 'after-sales-return-41',
                reference: 'AS-41',
            }),
        );
        expect(lineRepository.save).toHaveBeenCalledWith([
            expect.objectContaining({
                quantityDelta: 2,
                previousLotQuantity: 3,
                resultingLotQuantity: 5,
                previousStockOnHand: 7,
                resultingStockOnHand: 9,
            }),
        ]);
    });
});
