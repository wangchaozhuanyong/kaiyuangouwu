import { CurrencyCode, Permission } from '@vendure/common/lib/generated-types';
import { Order, RequestContext, TransactionalConnection } from '@vendure/core';
import { DataSource, DataSourceOptions, EntityManager, EntitySchema } from 'typeorm';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CatalogProfitService } from './catalog-profit.service';
import { manageCatalogOperationsPermission } from './constants';
import { OrderProfitExpense } from './entities/order-profit-expense.entity';

const expenseSchema = new EntitySchema<OrderProfitExpense>({
    name: 'ExpensePersistenceFixture',
    tableName: 'expense_persistence_fixture',
    columns: {
        id: { type: Number, primary: true, generated: true },
        createdAt: { type: Date, precision: 6 },
        updatedAt: { type: Date, precision: 6, updateDate: true },
        orderId: { type: Number },
        channelId: { type: Number },
        currencyCode: { type: String },
        carrierShippingCostMicrounits: { type: 'bigint', nullable: true },
        paymentFeeMicrounits: { type: 'bigint', nullable: true },
        source: { type: String },
        sourceReference: { type: String, nullable: true },
        note: { type: String, nullable: true },
        actorId: { type: String, nullable: true },
    },
});

const databases: Array<{ name: string; options: DataSourceOptions }> = [
    { name: 'sqljs', options: { type: 'sqljs' } },
];
if (process.env.CATALOG_PROFIT_MYSQL_TEST_PORT) {
    databases.push({
        name: 'local mysql',
        options: {
            type: 'mysql',
            host: '127.0.0.1',
            port: Number(process.env.CATALOG_PROFIT_MYSQL_TEST_PORT),
            username: 'root',
            database: 'retained_release_qa',
            timezone: 'Z',
        },
    });
}

afterEach(() => vi.restoreAllMocks());

describe.each(databases)('order expense persistence with $name', ({ options }) => {
    it('updates microsecond timestamps and gives rapid edits distinct revisions', async () => {
        const db = new DataSource({ ...options, entities: [expenseSchema], synchronize: true });
        await db.initialize();
        try {
            const repository = db.getRepository(expenseSchema);
            const createdAt = new Date('2026-09-06T00:00:00.123Z');
            const expense = await repository.save({
                createdAt,
                updatedAt: createdAt,
                orderId: 8,
                channelId: 9,
                currencyCode: CurrencyCode.MYR,
                carrierShippingCostMicrounits: '5000',
                paymentFeeMicrounits: '2000',
                source: 'IMPORT',
                note: 'keep this note',
            });
            await db.query('UPDATE expense_persistence_fixture SET updatedAt = ? WHERE id = ?', [
                options.type === 'sqljs' ? '2026-09-06 00:00:00.123456Z' : '2026-09-06 00:00:00.123456',
                expense.id,
            ]);
            const previous = await repository.findOneByOrFail({ id: expense.id });
            const updatePermissions: string[] = [
                Permission.UpdateOrder,
                manageCatalogOperationsPermission.Update,
            ];
            const ctx = {
                channelId: 9,
                activeUserId: 10,
                userHasPermissions: (permissions: string[]) =>
                    permissions.every(permission => updatePermissions.includes(permission)),
            } as unknown as RequestContext;
            const orderQuery = {
                innerJoin: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                andWhere: vi.fn().mockReturnThis(),
                getOne: vi.fn().mockResolvedValue({ id: 8, currencyCode: CurrencyCode.MYR }),
            };
            let manager: EntityManager = db.manager;
            const connection = {
                withTransaction: (_: RequestContext, work: (txCtx: RequestContext) => Promise<unknown>) =>
                    db.transaction(async txManager => {
                        manager = txManager;
                        return work(ctx);
                    }),
                getRepository: (_: RequestContext, entity: unknown) =>
                    entity === Order
                        ? { createQueryBuilder: () => orderQuery }
                        : manager.getRepository(expenseSchema),
            } as unknown as TransactionalConnection;
            const service = new CatalogProfitService(connection);
            vi.spyOn(Date, 'now').mockReturnValue(previous.updatedAt.getTime());

            const saved = await service.saveOrderExpense(ctx, {
                orderId: '8',
                paymentFeeMicrounits: 0,
                expectedUpdatedAt: previous.updatedAt,
            });
            expect(saved).toMatchObject({
                carrierShippingCostMicrounits: 5000,
                paymentFeeMicrounits: 0,
                note: 'keep this note',
            });
            expect(saved.updatedAt.getTime()).toBeGreaterThan(previous.updatedAt.getTime());
            await expect(
                service.saveOrderExpense(ctx, {
                    orderId: '8',
                    paymentFeeMicrounits: 3000,
                    expectedUpdatedAt: previous.updatedAt,
                }),
            ).rejects.toThrow('已被其他管理员修改');
            const second = await service.saveOrderExpense(ctx, {
                orderId: '8',
                paymentFeeMicrounits: 4000,
                expectedUpdatedAt: saved.updatedAt,
            });
            expect(second.paymentFeeMicrounits).toBe(4000);
            expect(second.updatedAt.getTime()).toBeGreaterThan(saved.updatedAt.getTime());
        } finally {
            await db.getRepository(expenseSchema).clear();
            await db.destroy();
        }
    });
});
