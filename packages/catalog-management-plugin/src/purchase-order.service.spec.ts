import { describe, expect, it, vi } from 'vitest';

import { InventoryLot } from './entities/inventory-lot.entity';
import { PurchaseOrder } from './entities/purchase-order.entity';
import { PurchaseReceipt } from './entities/purchase-receipt.entity';
import {
    calculateReturnCreditQuantity,
    derivePurchasePaymentStatus,
    deriveReceiptStatus,
    PurchaseOrderService,
    weightedScore,
} from './purchase-order.service';

describe('purchase order receipt state', () => {
    it('keeps an untouched submitted order submitted', () => {
        expect(deriveReceiptStatus([line(10, 0, 0)])).toBe('SUBMITTED');
    });

    it('marks incomplete deliveries as partially received', () => {
        expect(deriveReceiptStatus([line(10, 4, 0), line(5, 0, 0)])).toBe('PARTIALLY_RECEIVED');
    });

    it('marks exact accepted deliveries received', () => {
        expect(deriveReceiptStatus([line(10, 10, 0), line(5, 5, 0)])).toBe('RECEIVED');
    });

    it.each([
        [[line(10, 12, 0)], 'over delivery'],
        [[line(10, 10, 2)], 'rejected stock'],
    ])('requires variance review for %s', (lines, _case) => {
        expect(deriveReceiptStatus(lines)).toBe('VARIANCE_REVIEW');
    });
});

describe('purchase payable state', () => {
    it.each([
        [10_000, 0, 0, 'UNPAID'],
        [10_000, 0, 4_000, 'PARTIALLY_PAID'],
        [10_000, 2_000, 8_000, 'PAID'],
        [10_000, 3_000, 8_000, 'DISPUTED'],
        [10_000, 10_000, 0, 'PAID'],
    ] as const)('derives %s total, %s credit and %s paid as %s', (total, credit, paid, expected) => {
        expect(derivePurchasePaymentStatus(total, credit, paid)).toBe(expected);
    });

    it.each([
        [0, 0],
        [1_000, 1_000],
    ])(
        'rejects a payment dispute with %s total and %s credit when nothing was paid',
        async (total, credit) => {
            const order = {
                id: 7,
                channelId: 1,
                status: 'CLOSED',
                totalMicrounits: String(total),
                returnCreditMicrounits: String(credit),
                paidMicrounits: '0',
            } as PurchaseOrder;
            const query = {
                where: vi.fn().mockReturnThis(),
                andWhere: vi.fn().mockReturnThis(),
                getOne: vi.fn().mockResolvedValue(order),
            };
            const repository = {
                manager: { connection: { options: { type: 'sqljs' } } },
                createQueryBuilder: vi.fn().mockReturnValue(query),
                save: vi.fn(),
            };
            const connection = {
                withTransaction: vi.fn((ctx, work) => work(ctx)),
                getRepository: vi.fn().mockReturnValue(repository),
            };
            const service = new PurchaseOrderService(connection as never, {} as never, {} as never);

            await expect(service.disputePayment({ channelId: 1 } as never, 7, 'QA 争议')).rejects.toThrow(
                '无应付或已付款金额，不能标记付款争议',
            );
            expect(repository.save).not.toHaveBeenCalled();
        },
    );
});

describe('return-to-supplier credit', () => {
    it('does not create a payable credit while returning over-delivered units', () => {
        expect(calculateReturnCreditQuantity(10, 12, 0, 2)).toBe(0);
    });

    it('credits only the ordered portion after excess units are returned', () => {
        expect(calculateReturnCreditQuantity(10, 12, 1, 3)).toBe(2);
    });

    it('credits an ordinary accepted return in full', () => {
        expect(calculateReturnCreditQuantity(10, 8, 0, 4)).toBe(4);
    });
});

describe('supplier performance score', () => {
    it('normalizes weights when a metric has no eligible evidence', () => {
        expect(
            weightedScore([
                [null, 0.4],
                [80, 0.35],
                [100, 0.15],
                [100, 0.1],
            ]),
        ).toBe(88.33);
    });

    it('does not invent a score without evidence', () => {
        expect(weightedScore([[null, 1]])).toBeNull();
    });
});

describe('purchase order list view', () => {
    it('returns an empty event list when the summary query does not load events', async () => {
        const order = {
            id: 7,
            status: 'DRAFT',
            totalMicrounits: '0',
            paidMicrounits: '0',
            returnCreditMicrounits: '0',
            expectedAt: null,
            lines: [],
        } as unknown as PurchaseOrder;
        const query = {
            leftJoinAndSelect: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            orderBy: vi.fn().mockReturnThis(),
            addOrderBy: vi.fn().mockReturnThis(),
            skip: vi.fn().mockReturnThis(),
            take: vi.fn().mockReturnThis(),
            getManyAndCount: vi.fn().mockResolvedValue([[order], 1]),
        };
        const repository = { createQueryBuilder: vi.fn().mockReturnValue(query) };
        const connection = { getRepository: vi.fn().mockReturnValue(repository) };
        const service = new PurchaseOrderService(connection as never, {} as never, {} as never);

        const result = await service.findAll({ channelId: 1 } as never);

        expect(result.totalItems).toBe(1);
        expect(result.items[0].events).toEqual([]);
        expect(result.items[0].receipts).toEqual([]);
        expect(result.items[0].supplierReturns).toEqual([]);
    });

    it('preserves loaded events on the order detail', async () => {
        const event = { id: 12, type: 'CREATED', summary: '已创建' };
        const order = {
            id: 7,
            channelId: 1,
            stockLocationId: 2,
            status: 'DRAFT',
            totalMicrounits: '0',
            paidMicrounits: '0',
            returnCreditMicrounits: '0',
            expectedAt: null,
            lines: [],
            events: [event],
        } as unknown as PurchaseOrder;
        const repository = { findOne: vi.fn().mockResolvedValue(order) };
        const connection = { getRepository: vi.fn().mockReturnValue(repository) };
        const service = new PurchaseOrderService(connection as never, {} as never, {} as never);

        const result = await service.findOne({ channelId: 1 } as never, 7);

        expect(result.events).toEqual([event]);
    });
});

describe('purchase receipt idempotency', () => {
    it('returns the existing order without touching stock when the idempotency key already exists', async () => {
        const order = {
            id: 7,
            channelId: 1,
            stockLocationId: 2,
            status: 'CLOSED',
            paymentStatus: 'PAID',
            currencyCode: 'CNY',
            totalMicrounits: '1000',
            paidMicrounits: '1000',
            returnCreditMicrounits: '0',
            expectedAt: null,
            lines: [],
            receipts: [],
            supplierReturns: [],
            events: [],
            supplier: { id: 3, name: '供货商' },
            stockLocation: { id: 2, name: '主仓' },
        } as unknown as PurchaseOrder;
        const orderQuery = {
            where: vi.fn().mockReturnThis(),
            andWhere: vi.fn().mockReturnThis(),
            getOne: vi.fn().mockResolvedValue(order),
        };
        const orderRepository = {
            manager: {
                connection: { options: { type: 'sqljs' } },
                queryRunner: { isTransactionActive: true },
            },
            createQueryBuilder: vi.fn().mockReturnValue(orderQuery),
            findOne: vi.fn().mockResolvedValue(order),
        };
        const receiptRepository = { findOne: vi.fn().mockResolvedValue({ id: 9 }) };
        const lotRepository = { find: vi.fn().mockResolvedValue([]) };
        const connection = {
            withTransaction: vi.fn((ctx, work) => work(ctx)),
            getRepository: vi.fn((_ctx, entity) => {
                if (entity === PurchaseOrder) return orderRepository;
                if (entity === PurchaseReceipt) return receiptRepository;
                if (entity === InventoryLot) return lotRepository;
                throw new Error(`Unexpected repository ${String(entity)}`);
            }),
        };
        const operations = { changeLotQuantity: vi.fn(), recordCost: vi.fn() };
        const service = new PurchaseOrderService(connection as never, {} as never, operations as never);

        const result = await service.receive({ channelId: 1 } as never, {
            purchaseOrderId: 7,
            idempotencyKey: 'receipt-retry-1',
            lines: [
                {
                    purchaseOrderLineId: 11,
                    receivedQuantity: 1,
                    acceptedQuantity: 1,
                    rejectedQuantity: 0,
                    lotCode: 'LOT-1',
                },
            ],
        });

        expect(result.id).toBe(7);
        expect(receiptRepository.findOne).toHaveBeenCalledWith({
            where: { purchaseOrderId: 7, idempotencyKey: 'receipt-retry-1' },
        });
        expect(operations.changeLotQuantity).not.toHaveBeenCalled();
    });
});

function line(orderedQuantity: number, receivedQuantity: number, rejectedQuantity: number) {
    return { orderedQuantity, receivedQuantity, rejectedQuantity };
}
