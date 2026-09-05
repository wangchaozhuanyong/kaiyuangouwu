import { CurrencyCode, Permission } from '@vendure/common/lib/generated-types';
import { Order, RequestContext, TransactionalConnection } from '@vendure/core';
import { describe, expect, it, vi } from 'vitest';

import { CatalogProfitService } from './catalog-profit.service';
import { manageCatalogOperationsPermission } from './constants';
import { OrderProfitExpense } from './entities/order-profit-expense.entity';

const updatedAt = new Date('2026-09-06T00:00:00.000Z');

function setup(permissions: string[] = [Permission.UpdateOrder, manageCatalogOperationsPermission.Update]) {
    const expense = new OrderProfitExpense({
        id: 7,
        orderId: 8,
        channelId: 9,
        currencyCode: CurrencyCode.MYR,
        createdAt: updatedAt,
        updatedAt,
        carrierShippingCostMicrounits: '5000',
        paymentFeeMicrounits: '2000',
        note: 'original note',
        source: 'IMPORT',
    });
    const query = {
        innerJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        getOne: vi.fn().mockResolvedValue({ id: 8, currencyCode: CurrencyCode.MYR }),
        getMany: vi.fn().mockResolvedValue([]),
    };
    const repository = {
        findOne: vi.fn().mockResolvedValue(expense),
        findOneOrFail: vi.fn().mockResolvedValue(expense),
        update: vi.fn().mockResolvedValue({ affected: 1 }),
        save: vi.fn().mockImplementation((value: OrderProfitExpense) => Promise.resolve(value)),
    };
    const ctx = {
        channelId: 9,
        activeUserId: 10,
        userHasPermissions: (required: string[]) =>
            required.every(permission => permissions.includes(permission)),
    } as unknown as RequestContext;
    const connection = {
        withTransaction: vi
            .fn()
            .mockImplementation((_: RequestContext, work: (ctx: RequestContext) => unknown) =>
                Promise.resolve(work(ctx)),
            ),
        getRepository: vi
            .fn()
            .mockImplementation((_: RequestContext, entity: unknown) =>
                entity === Order ? { createQueryBuilder: () => query } : repository,
            ),
    };
    return {
        ctx,
        query,
        repository,
        connection,
        service: new CatalogProfitService(connection as unknown as TransactionalConnection),
    };
}

describe('catalog profit access and expense writes', () => {
    it.each([[Permission.ReadOrder], [manageCatalogOperationsPermission.Read]])(
        'requires both read permissions: %j alone is insufficient',
        async permission => {
            const { ctx, service, connection } = setup([permission]);
            await expect(service.orderExpense(ctx, '8')).rejects.toThrow();
            expect(connection.getRepository).not.toHaveBeenCalled();
        },
    );

    it.each([[Permission.UpdateOrder], [manageCatalogOperationsPermission.Update]])(
        'requires both update permissions: %j alone is insufficient',
        async permission => {
            const { ctx, service, connection } = setup([permission]);
            await expect(
                service.saveOrderExpense(ctx, { orderId: '8', paymentFeeMicrounits: 0 }),
            ).rejects.toThrow();
            expect(connection.withTransaction).not.toHaveBeenCalled();
        },
    );

    it('rejects an order outside the active channel before touching expense records', async () => {
        const { ctx, service, query, repository } = setup();
        query.getOne.mockResolvedValue(null);
        await expect(
            service.saveOrderExpense(ctx, { orderId: 'outside', paymentFeeMicrounits: 0 }),
        ).rejects.toThrow('当前店铺');
        expect(query.innerJoin).toHaveBeenCalledWith(
            'order.channels',
            'expenseChannel',
            'expenseChannel.id = :channelId',
            { channelId: 9 },
        );
        expect(repository.findOne).not.toHaveBeenCalled();
        expect(repository.save).not.toHaveBeenCalled();
    });

    it('preserves omitted fields while allowing an explicit zero or null', async () => {
        const { ctx, service, repository } = setup();
        const result = await service.saveOrderExpense(ctx, {
            orderId: '8',
            paymentFeeMicrounits: 0,
            expectedUpdatedAt: updatedAt,
        });
        expect(result).toMatchObject({
            carrierShippingCostMicrounits: 5000,
            paymentFeeMicrounits: 0,
            note: 'original note',
        });
        expect(repository.update).toHaveBeenCalledWith(
            expect.objectContaining({ id: 7, channelId: 9 }),
            expect.objectContaining({
                carrierShippingCostMicrounits: '5000',
                paymentFeeMicrounits: '0',
                actorId: '10',
            }),
        );
        const cleared = await service.saveOrderExpense(ctx, {
            orderId: '8',
            carrierShippingCostMicrounits: null,
        });
        expect(cleared.carrierShippingCostMicrounits).toBeNull();
    });

    it('rejects stale edits before writing', async () => {
        const { ctx, service, repository } = setup();
        await expect(
            service.saveOrderExpense(ctx, {
                orderId: '8',
                paymentFeeMicrounits: 500,
                expectedUpdatedAt: new Date(updatedAt.getTime() - 1000),
            }),
        ).rejects.toThrow('已被其他管理员修改');
        expect(repository.update).not.toHaveBeenCalled();
    });

    it('rejects a concurrent update detected by the conditional write', async () => {
        const { ctx, service, repository } = setup();
        repository.update.mockResolvedValue({ affected: 0 });
        await expect(
            service.saveOrderExpense(ctx, { orderId: '8', paymentFeeMicrounits: 500 }),
        ).rejects.toThrow('已被其他管理员修改');
        expect(repository.findOneOrFail).not.toHaveBeenCalled();
        expect(repository.save).not.toHaveBeenCalled();
    });

    it('rejects duplicate order codes before an import transaction starts', async () => {
        const { ctx, service, connection } = setup();
        await expect(
            service.importOrderExpenses(ctx, {
                currencyCode: CurrencyCode.MYR,
                filename: 'expenses.csv',
                fileHash: 'a'.repeat(64),
                rows: [
                    { rowNumber: 2, orderCode: 'T-1001', paymentFeeMicrounits: 100 },
                    { rowNumber: 3, orderCode: 't-1001', paymentFeeMicrounits: 200 },
                ],
            }),
        ).rejects.toThrow('重复');
        expect(connection.withTransaction).not.toHaveBeenCalled();
    });

    it('does not import any expenses if an order is missing from the selected channel and currency', async () => {
        const { ctx, service, query, repository } = setup();
        await expect(
            service.importOrderExpenses(ctx, {
                currencyCode: CurrencyCode.MYR,
                filename: 'expenses.csv',
                fileHash: 'a'.repeat(64),
                rows: [{ rowNumber: 2, orderCode: 'T-1001', paymentFeeMicrounits: 100 }],
            }),
        ).rejects.toThrow('当前店铺与币种');
        expect(query.andWhere).toHaveBeenCalledWith('order.currencyCode = :currencyCode', {
            currencyCode: CurrencyCode.MYR,
        });
        expect(repository.save).not.toHaveBeenCalled();
    });
});
