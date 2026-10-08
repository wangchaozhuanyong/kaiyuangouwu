import { StockLevel } from '@vendure/core';
import { describe, expect, it, vi } from 'vitest';

import { InventoryLot } from './entities/inventory-lot.entity';
import { InventoryOperationLine } from './entities/inventory-operation-line.entity';
import { InventoryOperation } from './entities/inventory-operation.entity';
import { InventoryControlService } from './inventory-control.service';

function replacementHarness(withLots = true) {
    const levels = [{ id: 1, productVariantId: 3, stockLocationId: 4, stockOnHand: 7, stockAllocated: 4 }];
    const lots = withLots
        ? [
              {
                  id: 9,
                  variantId: 3,
                  stockLocationId: 4,
                  lotCode: 'SELLABLE',
                  quantityOnHand: 5,
                  state: 'ACTIVE',
                  expiresAt: null,
                  manufacturedAt: null,
                  currencyCode: 'MYR',
                  purchaseCostMicrounits: null,
              },
              {
                  id: 10,
                  variantId: 3,
                  stockLocationId: 4,
                  lotCode: 'EXPIRED',
                  quantityOnHand: 2,
                  state: 'ACTIVE',
                  expiresAt: new Date(0),
                  manufacturedAt: null,
                  currencyCode: 'MYR',
                  purchaseCostMicrounits: null,
              },
          ]
        : [];
    let posted: any = null;
    const operationRepository = {
        findOne: vi.fn(() => Promise.resolve(posted)),
        save: vi.fn(value => Promise.resolve((posted = { ...value, id: 41, lines: [] }))),
        findOneOrFail: vi.fn(() => Promise.resolve(posted)),
    };
    const lineRepository = {
        save: vi.fn(lines => {
            posted.lines = lines;
            return Promise.resolve(lines);
        }),
    };
    const manager = {
        connection: { options: { type: 'sqljs' } },
        queryRunner: { isTransactionActive: true },
    };
    const stockRepository = {
        manager,
        find: vi.fn(options =>
            Promise.resolve(
                levels.filter(level => level.productVariantId === options.where.productVariantId),
            ),
        ),
        findOneOrFail: vi.fn(options =>
            Promise.resolve(
                levels.find(
                    level =>
                        level.productVariantId === options.where.productVariantId &&
                        level.stockLocationId === options.where.stockLocationId,
                ),
            ),
        ),
        createQueryBuilder: vi.fn(() => {
            let variantId: number;
            let stockLocationId: number;
            const query = {
                where: vi.fn((_sql, parameters) => {
                    variantId = parameters.variantId;
                    return query;
                }),
                andWhere: vi.fn((_sql, parameters) => {
                    stockLocationId = parameters.stockLocationId;
                    return query;
                }),
                getOne: vi.fn(() =>
                    Promise.resolve(
                        levels.find(
                            level =>
                                level.productVariantId === variantId &&
                                level.stockLocationId === stockLocationId,
                        ),
                    ),
                ),
            };
            return query;
        }),
    };
    const lotRepository = {
        manager,
        createQueryBuilder: vi.fn(() => {
            let variantId: number;
            let stockLocationId: number;
            const query = {
                where: vi.fn((_sql, parameters) => {
                    variantId = parameters.variantId;
                    return query;
                }),
                andWhere: vi.fn((_sql, parameters) => {
                    stockLocationId = parameters.stockLocationId;
                    return query;
                }),
                orderBy: vi.fn(() => query),
                getMany: vi.fn(() =>
                    Promise.resolve(
                        lots
                            .filter(
                                lot => lot.variantId === variantId && lot.stockLocationId === stockLocationId,
                            )
                            .map(lot => ({ ...lot })),
                    ),
                ),
            };
            return query;
        }),
    };
    const operations = {
        requirePhysicalVariant: vi.fn().mockResolvedValue({ id: 3 }),
        changeLotQuantity: vi.fn((_ctx: any, changeInput: any) => Promise.resolve(changeInput)),
    };
    operations.changeLotQuantity.mockImplementation((_ctx: any, changeInput: any) => {
        const lot = lots.find(candidate => candidate.id === changeInput.id);
        if (!lot) throw new Error('Missing test lot');
        const level = levels.find(candidate => candidate.stockLocationId === lot.stockLocationId);
        if (!level) throw new Error('Missing test stock');
        lot.quantityOnHand += changeInput.quantityDelta;
        level.stockOnHand += changeInput.quantityDelta;
        return Promise.resolve({ ...lot });
    });
    const stock = {
        adjustProductVariantStock: vi.fn((_ctx, variantId, changes) => {
            for (const change of changes) {
                const level = levels.find(
                    candidate =>
                        candidate.productVariantId === variantId &&
                        candidate.stockLocationId === change.stockLocationId,
                );
                if (!level) throw new Error('Missing test stock');
                level.stockOnHand = change.stockOnHand;
            }
            return Promise.resolve();
        }),
    };
    const connection = {
        withTransaction: vi.fn((transactionCtx, work) => work(transactionCtx)),
        getRepository: vi.fn((_ctx, entity) => {
            if (entity === StockLevel) return stockRepository;
            if (entity === InventoryLot) return lotRepository;
            if (entity === InventoryOperation) return operationRepository;
            if (entity === InventoryOperationLine) return lineRepository;
            throw new Error(`Unexpected replacement repository ${String(entity)}`);
        }),
    };
    const service = new InventoryControlService(connection as never, operations as never, stock as never);
    const ctx = { channelId: 1 } as never;
    const input = {
        idempotencyKey: 'replacement-41',
        reference: 'AS-41',
        reason: 'Approved replacement shipment',
        lines: [{ productVariantId: 3, quantity: 3 }],
    };
    return {
        service,
        ctx,
        input,
        levels,
        lots,
        operations,
        stock,
        stockRepository,
        operationRepository,
        lineRepository,
    };
}

describe('after-sales replacement inventory closure', () => {
    it('deducts sellable unallocated stock and records the original outbound operation once', async () => {
        const test = replacementHarness();
        const result = await test.service.dispatchAfterSalesReplacement(test.ctx, test.input);
        expect(result).toMatchObject({ type: 'AFTER_SALES_REPLACEMENT', reference: 'AS-41' });
        expect(test.levels[0].stockOnHand).toBe(4);
        expect(test.lots.map(lot => lot.quantityOnHand)).toEqual([2, 2]);
        expect(test.lineRepository.save).toHaveBeenCalledWith([
            expect.objectContaining({
                quantityDelta: -3,
                previousStockOnHand: 7,
                resultingStockOnHand: 4,
                previousLotQuantity: 5,
                resultingLotQuantity: 2,
                inventoryLotId: 9,
            }),
        ]);
        expect(await test.service.dispatchAfterSalesReplacement(test.ctx, test.input)).toBe(result);
        expect(test.operations.changeLotQuantity).toHaveBeenCalledTimes(1);
        expect(test.stockRepository.find).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { productVariantId: 3, stockLocation: { channels: { id: 1 } } },
            }),
        );
    });

    it.each(['allocated', 'expired', 'unreconciled'])(
        'rejects %s inventory without posting a shipment',
        async reason => {
            const test = replacementHarness();
            if (reason === 'allocated') test.levels[0].stockAllocated = 6;
            if (reason === 'expired') test.lots[0].expiresAt = new Date(0);
            if (reason === 'unreconciled') test.lots[0].quantityOnHand = 6;
            await expect(test.service.dispatchAfterSalesReplacement(test.ctx, test.input)).rejects.toThrow();
            expect(test.operations.changeLotQuantity).not.toHaveBeenCalled();
            expect(test.stock.adjustProductVariantStock).not.toHaveBeenCalled();
            expect(test.operationRepository.save).not.toHaveBeenCalled();
        },
    );

    it('supports audited legacy stock without inventing a batch or another original-order sale', async () => {
        const test = replacementHarness(false);
        await test.service.dispatchAfterSalesReplacement(test.ctx, test.input);
        expect(test.levels[0].stockOnHand).toBe(4);
        expect(test.stock.adjustProductVariantStock).toHaveBeenCalledWith(test.ctx, 3, [
            { stockLocationId: 4, stockOnHand: 4 },
        ]);
        expect(test.lineRepository.save).toHaveBeenCalledWith([
            expect.objectContaining({ inventoryLotId: null, quantityDelta: -3 }),
        ]);
    });

    it('rejects a changed quantity when retrying an already posted replacement', async () => {
        const test = replacementHarness();
        await test.service.dispatchAfterSalesReplacement(test.ctx, test.input);
        await expect(
            test.service.dispatchAfterSalesReplacement(test.ctx, {
                ...test.input,
                lines: [{ productVariantId: 3, quantity: 2 }],
            }),
        ).rejects.toThrow('原换货补发出库内容');
        expect(test.operations.changeLotQuantity).toHaveBeenCalledTimes(1);
    });

    it('validates every replacement item before deducting any stock', async () => {
        const test = replacementHarness();
        await expect(
            test.service.dispatchAfterSalesReplacement(test.ctx, {
                ...test.input,
                lines: [...test.input.lines, { productVariantId: 8, quantity: 1 }],
            }),
        ).rejects.toThrow('可用库存不足');
        expect(test.operations.changeLotQuantity).not.toHaveBeenCalled();
        expect(test.operationRepository.save).not.toHaveBeenCalled();
    });

    it('uses allocated quantity from the locking read instead of a stale transaction snapshot', async () => {
        const test = replacementHarness();
        const stale = { ...test.levels[0], stockAllocated: 0 };
        test.stockRepository.find.mockResolvedValue([stale]);
        test.stockRepository.findOneOrFail.mockResolvedValue(stale);
        test.levels[0].stockAllocated = 6;
        await expect(test.service.dispatchAfterSalesReplacement(test.ctx, test.input)).rejects.toThrow(
            '可用库存不足',
        );
        expect(test.stockRepository.findOneOrFail).not.toHaveBeenCalled();
        expect(test.operations.changeLotQuantity).not.toHaveBeenCalled();
    });
});

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
