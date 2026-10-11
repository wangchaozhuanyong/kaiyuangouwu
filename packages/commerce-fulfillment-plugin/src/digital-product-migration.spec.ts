import { Product, ProductVariant, StockLevel } from '@vendure/core';
import { GovernanceService } from '@vendure/store-management-plugin';
import { buildSchema, parse, print, validate } from 'graphql';
import 'reflect-metadata';
import { FindOperator } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { DigitalProductAdminResolver } from './digital-product.resolver';
import { digitalProductAdminSchema } from './digital-product.schema';
import { DigitalInventoryOwnershipConfirmation, DigitalProductService } from './digital-product.service';
import {
    DigitalOrderReservation,
    DigitalQuotaMovement,
    DigitalVariantConfig,
} from './entities/digital-product.entity';

function migrationHarness(variantId = '12', productId = '6', stockId = '23') {
    const current = { id: '5', code: 'store-a' };
    const defaultChannel = { id: '1', code: '__default_channel__' };
    const other = { id: '8', code: 'store-b' };
    const ctx = { channelId: '5', channel: current, activeUserId: '42' } as any;
    const state = {
        product: {
            id: productId,
            channels: [defaultChannel, current],
            customFields: { fulfillmentType: 'digital' },
        },
        otherVariants: [] as any[],
        variant: {
            id: variantId,
            productId,
            channels: [defaultChannel, current],
            customFields: { digitalDeliveryMode: 'manual_service', digitalStockPolicy: 'limited' },
        },
        stocks: [
            {
                id: stockId,
                productVariantId: variantId,
                stockLocationId: '1',
                stockOnHand: 100,
                stockAllocated: 0,
                stockLocation: { id: '1', channels: [defaultChannel] },
            },
            {
                id: '100',
                productVariantId: variantId,
                stockLocationId: '10',
                stockOnHand: 0,
                stockAllocated: 0,
                stockLocation: { id: '10', channels: [defaultChannel, current] },
            },
            {
                id: '999',
                productVariantId: '999',
                stockLocationId: '1',
                stockOnHand: 70,
                stockAllocated: 4,
                stockLocation: { id: '1', channels: [defaultChannel] },
            },
        ],
        configurations: [] as any[],
        movements: [] as any[],
        reservations: [] as any[],
        audits: [] as any[],
        orders: [] as any[],
        fulfillments: [] as any[],
    };
    const calls: string[] = [];
    let tail = Promise.resolve();
    const releases = new Map<object, () => void>();
    const snapshots = new Map<object, typeof state>();
    let onLock: (() => void) | undefined;
    let staleStockRead: typeof state.stocks | undefined;
    const table = (entity: any): any[] => {
        if (entity === ProductVariant) return [state.variant, ...state.otherVariants];
        if (entity === StockLevel) return state.stocks;
        if (entity === DigitalVariantConfig) return state.configurations;
        if (entity === DigitalQuotaMovement) return state.movements;
        if (entity === DigitalOrderReservation) return state.reservations;
        if (entity.name === 'OrderLine') return state.orders;
        if (entity.name === 'FulfillmentLine') return state.fulfillments;
        return [];
    };
    const matches = (row: any, where: any = {}): boolean =>
        Object.entries(where).every(([key, value]) => {
            if (value instanceof FindOperator) {
                if (value.type === 'in')
                    return value.value.some((id: unknown) => String(row[key]) === String(id));
                if (value.type === 'isNull') return row[key] == null;
                return true;
            }
            if (value && typeof value === 'object') {
                return Array.isArray(row[key])
                    ? row[key].some((item: unknown) => matches(item, value))
                    : matches(row[key] ?? {}, value);
            }
            return String(row[key]) === String(value);
        });
    const connection = {
        getEntityOrThrow: vi.fn((request: any, entity: any, id: any, options: any = {}) => {
            calls.push(`read:${entity.name}`);
            const value = entity === Product ? state.product : state.variant;
            if (
                String(value.id) !== String(id) ||
                (options.channelId && !value.channels.some(channel => channel.id === options.channelId))
            )
                throw new Error('Resource is outside this store');
            return Promise.resolve(structuredClone(value));
        }),
        getRepository: vi.fn((request: any, entity: any) => ({
            manager: {
                queryRunner: { isTransactionActive: request.transactionActive !== false },
                connection: { options: { type: 'mysql' } },
            },
            find: vi.fn((options: any = {}) => {
                calls.push(`find:${entity.name}`);
                const rows = entity === StockLevel && staleStockRead ? staleStockRead : table(entity);
                return Promise.resolve(structuredClone(rows.filter(row => matches(row, options.where))));
            }),
            findOne: vi.fn((options: any = {}) =>
                Promise.resolve(
                    structuredClone(table(entity).find(row => matches(row, options.where)) ?? null),
                ),
            ),
            count: vi.fn((options: any = {}) =>
                Promise.resolve(table(entity).filter(row => matches(row, options.where)).length),
            ),
            save: vi.fn((value: any) => {
                calls.push(`save:${entity.name}`);
                value.id ??= `${entity.name}-${table(entity).length + 1}`;
                const rows = table(entity);
                const index = rows.findIndex(row => row.id === value.id);
                if (index >= 0) rows[index] = structuredClone(value);
                else rows.push(structuredClone(value));
                return Promise.resolve(value);
            }),
            update: vi.fn(() => {
                calls.push(`update:${entity.name}`);
                return Promise.resolve();
            }),
            createQueryBuilder: vi.fn(() => {
                let parameters: any = {};
                let channelScoped = false;
                const query: any = {
                    where: vi.fn((_condition: any, params: any) => {
                        parameters = params;
                        return query;
                    }),
                    innerJoin: vi.fn(() => {
                        channelScoped = true;
                        return query;
                    }),
                    orderBy: vi.fn(() => query),
                    setLock: vi.fn(() => query),
                    getOne: vi.fn(async () => {
                        if (entity === ProductVariant) {
                            const previous = tail;
                            tail = new Promise<void>(resolve => releases.set(request, resolve));
                            await previous;
                            snapshots.set(request, structuredClone(state));
                            onLock?.();
                        }
                        calls.push(`lock:${entity.name}`);
                        const value =
                            entity === Product
                                ? state.product
                                : entity === ProductVariant
                                  ? state.variant
                                  : table(entity).find(row => row.id === parameters.id);
                        if (!value) return null;
                        if (
                            value.id !== parameters.id ||
                            (channelScoped &&
                                !value.channels.some(
                                    (channel: { id: string }) => channel.id === request.channelId,
                                ))
                        )
                            return null;
                        return structuredClone(value);
                    }),
                    getMany: vi.fn(() => {
                        calls.push(`lock:${entity.name}`);
                        return Promise.resolve(
                            structuredClone(
                                table(entity).filter(row => row.productVariantId === parameters.variantId),
                            ),
                        );
                    }),
                };
                return query;
            }),
        })),
    };
    const audit = {
        appendAudit: vi.fn((_request: any, value: any) => {
            state.audits.push(value);
            return Promise.resolve();
        }),
    };
    const service = new DigitalProductService(
        connection as any,
        {} as any,
        {} as any,
        undefined,
        audit as any,
    );
    const transaction = async (request: any, work: () => Promise<any>) => {
        try {
            return await work();
        } catch (error) {
            const snapshot = snapshots.get(request);
            if (snapshot) {
                state.configurations = snapshot.configurations;
                state.movements = snapshot.movements;
                state.reservations = snapshot.reservations;
                state.audits = snapshot.audits;
            }
            throw error;
        } finally {
            releases.get(request)?.();
            releases.delete(request);
            snapshots.delete(request);
        }
    };
    const confirmation = (): DigitalInventoryOwnershipConfirmation => ({
        stockLevels: state.stocks
            .filter(stock => stock.productVariantId === variantId && stock.stockLocationId === '1')
            .map(({ id, stockLocationId, stockOnHand, stockAllocated }) => ({
                id,
                stockLocationId,
                stockOnHand,
                stockAllocated,
            })),
        reason: '经营者已核对以上旧库存属于当前店铺',
    });
    const migrate = (input = confirmation(), available = 100, reserved = 0, request = ctx) =>
        transaction(request, () => service.migrate(request, variantId, available, reserved, input));
    return {
        state,
        ctx,
        current,
        other,
        service,
        audit,
        calls,
        connection,
        confirmation,
        migrate,
        transaction,
        setOnLock: (hook: () => void) => {
            onLock = hook;
        },
        setStaleStockRead: (rows: typeof state.stocks) => {
            staleStockRead = rows;
        },
    };
}

describe('explicit legacy digital stock ownership migration', () => {
    it('counts only currently assigned operating stores before switching native tracking off', async () => {
        const test = migrationHarness();
        test.state.variant.channels.push(test.other);
        test.state.configurations.push(
            { productVariantId: '12', channelId: '5', migrationState: 'ACTIVE' },
            { productVariantId: '12', channelId: 'removed-store', migrationState: 'ACTIVE' },
            { productVariantId: '12', channelId: '1', migrationState: 'ACTIVE' },
        );
        await expect(test.service.allStoresMigrated(test.ctx, '12')).resolves.toBe(false);
        test.state.configurations.push({ productVariantId: '12', channelId: '8', migrationState: 'ACTIVE' });
        await expect(test.service.allStoresMigrated(test.ctx, '12')).resolves.toBe(true);
        test.state.variant.channels = [{ id: '1', code: '__default_channel__' }];
        await expect(test.service.allStoresMigrated(test.ctx, '12')).resolves.toBe(false);
    });

    it('limits digital workspace SKUs and cost reads to the current store and keeps cleared cost null', async () => {
        const test = migrationHarness();
        test.state.otherVariants.push(
            { ...test.state.variant, id: 'other-store-variant', channels: [test.other] },
            { ...test.state.variant, id: 'deleted-variant', deletedAt: new Date() },
            { ...test.state.variant, id: 'different-product', productId: 'other-product' },
        );
        const catalog = {
            latestCost: vi.fn().mockResolvedValue({ costMicrounits: null }),
            variantSupplier: vi.fn().mockResolvedValue(null),
        };
        const service = new DigitalProductService(test.connection as never, {} as never, catalog as never);
        const result = await service.workspace(test.ctx, '6');
        expect(result.variants.map(variant => variant.id)).toEqual(['12']);
        expect(result.variants[0].purchaseCostMicrounits).toBeNull();
        expect(catalog.latestCost).toHaveBeenCalledTimes(1);
    });

    it('keeps unconfirmed rows blocked, exposes only complete confirmable rows, and never mutates preview data', async () => {
        const test = migrationHarness();
        const original = structuredClone(test.state);
        const preview = await test.service.migrationPreview(test.ctx, '12');
        expect(preview.conflicts).toContain('旧库存或未完成订单缺少店铺归属，请先核对，不能自动迁移');
        expect(preview.confirmableStockLevels).toEqual(test.confirmation().stockLevels);
        const confirmed = await test.service.migrationPreview(test.ctx, '12', undefined, test.confirmation());
        expect(confirmed).toMatchObject({ availableQuantity: 100, reservedQuantity: 0, conflicts: [] });
        expect(confirmed.confirmableStockLevels).toEqual(preview.confirmableStockLevels);
        expect(test.state).toEqual(original);
        await expect(
            test.transaction(test.ctx, () => test.service.migrate(test.ctx, '12', 0, 0)),
        ).rejects.toThrow('迁移核对结果已变化');
        expect(test.state).toEqual(original);
    });

    it.each([
        [
            'omitted row',
            (input: any) => {
                input.stockLevels = [];
            },
        ],
        [
            'duplicate row',
            (input: any) => {
                input.stockLevels.push({ ...input.stockLevels[0] });
            },
        ],
        [
            'foreign row',
            (input: any) => {
                input.stockLevels[0].id = '999';
            },
        ],
        [
            'extra row',
            (input: any) => {
                input.stockLevels.push({ ...input.stockLevels[0], id: '999' });
            },
        ],
        [
            'changed location',
            (input: any) => {
                input.stockLevels[0].stockLocationId = '10';
            },
        ],
        [
            'changed stock',
            (input: any) => {
                input.stockLevels[0].stockOnHand = 99;
            },
        ],
        [
            'fractional stock',
            (input: any) => {
                input.stockLevels[0].stockOnHand = 99.5;
            },
        ],
        [
            'unsafe stock',
            (input: any) => {
                input.stockLevels[0].stockOnHand = Number.MAX_SAFE_INTEGER + 1;
            },
        ],
        [
            'changed allocation',
            (input: any) => {
                input.stockLevels[0].stockAllocated = 1;
            },
        ],
        [
            'empty reason',
            (input: any) => {
                input.reason = ' ';
            },
        ],
        [
            'oversized reason',
            (input: any) => {
                input.reason = 'a'.repeat(501);
            },
        ],
    ])('rejects %s without changing stock, config, reservation or audit', async (_label, change) => {
        const test = migrationHarness();
        const original = structuredClone(test.state);
        const input = test.confirmation();
        change(input);
        await expect(test.migrate(input)).rejects.toThrow();
        expect(test.state).toEqual(original);
    });

    it.each([
        'product-shared',
        'variant-shared',
        'product-other',
        'variant-other',
        'default-store',
        'stock-other',
    ])('refuses confirmation when current store ownership cannot be uniquely proven: %s', async condition => {
        const test = migrationHarness();
        if (condition === 'product-shared') test.state.product.channels.push(test.other);
        if (condition === 'variant-shared') test.state.variant.channels.push(test.other);
        if (condition === 'product-other') test.state.product.channels = [test.other];
        if (condition === 'variant-other') test.state.variant.channels = [test.other];
        if (condition === 'default-store') {
            test.ctx.channelId = '1';
            test.ctx.channel = { id: '1', code: '__default_channel__' };
        }
        if (condition === 'stock-other') {
            test.state.stocks[1].stockOnHand = 1;
            test.state.stocks[1].stockLocation.channels = [test.other];
        }
        const original = structuredClone(test.state);
        await expect(test.migrate()).rejects.toThrow();
        expect(test.state).toEqual(original);
    });

    it.each(['other-active', 'other-prepared', 'other-migrate', 'same-migrate'])(
        'rejects a historical or other-store migration claim: %s',
        async condition => {
            const test = migrationHarness();
            if (condition.endsWith('migrate'))
                test.state.movements.push({
                    channelId: condition === 'same-migrate' ? '5' : '8',
                    productVariantId: '12',
                    type: 'MIGRATE',
                    quantity: 100,
                });
            else
                test.state.configurations.push({
                    id: 'other',
                    channelId: '8',
                    productVariantId: '12',
                    migrationState: condition === 'other-active' ? 'ACTIVE' : 'PREPARED',
                });
            const preview = await test.service.migrationPreview(test.ctx, '12');
            expect(preview.confirmableStockLevels).toEqual([]);
            const original = structuredClone(test.state);
            await expect(test.migrate()).rejects.toThrow();
            expect(test.state).toEqual(original);
        },
    );

    it('cannot confirm an ownerless allocation even if a current-store pending order has the same quantity', async () => {
        const test = migrationHarness();
        test.state.stocks[0].stockAllocated = 2;
        test.state.orders.push({
            id: 'line',
            productVariantId: '12',
            quantity: 2,
            order: { salesChannelId: '5', state: 'PaymentSettled', active: false },
        });
        const preview = await test.service.migrationPreview(test.ctx, '12');
        expect(preview.confirmableStockLevels).toEqual([]);
        const original = structuredClone(test.state);
        await expect(test.migrate(test.confirmation(), 98, 2)).rejects.toThrow();
        expect(test.state).toEqual(original);
    });

    it.each(['settlement', 'missing-order-owner', 'file-history', 'auto-card-pending'])(
        'retains the existing %s guard after ownership is confirmed',
        async condition => {
            const test = migrationHarness();
            test.state.orders.push({
                id: 'line',
                productVariantId: '12',
                quantity: 0,
                order: { salesChannelId: '5', state: 'PaymentSettled', active: false },
            });
            if (condition === 'settlement') test.state.orders[0].order.state = 'ArrangingPayment';
            if (condition === 'missing-order-owner') test.state.orders[0].order.salesChannelId = null;
            if (condition === 'file-history')
                test.state.variant.customFields.digitalDeliveryMode = 'file_download';
            if (condition === 'auto-card-pending')
                test.state.variant.customFields.digitalDeliveryMode = 'auto_card';
            const original = structuredClone(test.state);
            await expect(test.migrate()).rejects.toThrow();
            expect(test.state).toEqual(original);
        },
    );

    it('rejects per-row CAS drift even when compensating changes preserve the total preview quantity', async () => {
        const test = migrationHarness();
        const input = test.confirmation();
        test.setOnLock(() => {
            test.state.stocks[0].stockOnHand = 101;
            test.state.stocks[1].stockOnHand = -1;
        });
        await expect(test.migrate(input)).rejects.toThrow('旧库存归属或数量已变化');
        expect(test.state.configurations).toEqual([]);
        expect(test.state.movements).toEqual([]);
    });

    it('checks lock-returned quantities rather than a stale stock read', async () => {
        const test = migrationHarness();
        const stale = structuredClone(test.state.stocks);
        const input = test.confirmation();
        test.state.stocks[0].stockOnHand = 101;
        test.setStaleStockRead(stale);
        await expect(test.migrate(input)).rejects.toThrow('旧库存归属或数量已变化');
        expect(test.state.configurations).toEqual([]);
    });

    it.each(['row-appeared', 'row-relocated', 'owner-changed', 'unsafe-quantity', 'aggregate-overflow'])(
        'rechecks %s at migration time rather than trusting an earlier preview',
        async condition => {
            const test = migrationHarness();
            const input = test.confirmation();
            if (condition === 'row-appeared')
                test.state.stocks.push({ ...structuredClone(test.state.stocks[0]), id: '24' });
            if (condition === 'row-relocated') test.state.stocks[0].stockLocationId = '2';
            if (condition === 'owner-changed') test.state.product.channels.push(test.other);
            if (condition === 'unsafe-quantity') test.state.stocks[1].stockOnHand = 0.5;
            if (condition === 'aggregate-overflow') test.state.stocks[1].stockOnHand = 2_147_483_647;
            const original = structuredClone(test.state);
            await expect(test.migrate(input)).rejects.toThrow();
            expect(test.state).toEqual(original);
        },
    );

    it.each([
        ['6', '12', '23', 0],
        ['9', '10', '19', 100],
        ['10', '13', '25', 100],
    ] as const)(
        'migrates a synthetic product %s then uses the existing quantity CAS while preserving all warehouse rows',
        async (productId, variantId, stockId, target) => {
            const test = migrationHarness(variantId, productId, stockId);
            test.state.stocks[1].stockOnHand = 100;
            const warehouseBefore = structuredClone(test.state.stocks);
            const config = await test.migrate(test.confirmation(), 200);
            expect(config).toMatchObject({
                migrationState: 'ACTIVE',
                availableQuantity: 200,
                channelId: '5',
            });
            await test.service.update(test.ctx, {
                productVariantId: variantId,
                deliveryMode: 'manual_service',
                stockPolicy: 'limited',
                availableQuantity: target,
                expectedAvailableQuantity: 200,
            });
            expect(test.state.configurations[0]).toMatchObject({
                availableQuantity: target,
                deliveryMode: 'manual_service',
                stockPolicy: 'limited',
            });
            expect(test.state.stocks).toEqual(warehouseBefore);
            expect(test.state.movements.map(row => row.type)).toEqual(['MIGRATE', 'ADJUST']);
            expect(test.state.audits).toHaveLength(1);
            expect(test.state.audits[0]).toMatchObject({
                actorUserId: '42',
                reason: test.confirmation().reason,
                payload: {
                    productId,
                    productVariantId: variantId,
                    channelId: '5',
                    productOperatingChannelIds: ['5'],
                    variantOperatingChannelIds: ['5'],
                    confirmedStockLevels: test.confirmation().stockLevels,
                    availableQuantity: 200,
                    reservedQuantity: 0,
                    warehouseRowsPreserved: true,
                },
            });
            expect(test.state.audits[0].payload.warehouseRows[0]).toEqual({
                ...test.confirmation().stockLevels[0],
                channelIds: ['1'],
            });
            expect(test.calls.indexOf('lock:ProductVariant')).toBeLessThan(
                test.calls.indexOf('read:ProductVariant'),
            );
            expect(test.calls.indexOf('lock:StockLevel')).toBeLessThan(
                test.calls.indexOf('read:ProductVariant'),
            );
        },
    );

    it('keeps legacy normal owned-warehouse migration compatible, including pending reservations', async () => {
        const test = migrationHarness();
        test.state.stocks[0].stockLocation.channels.push(test.current);
        test.state.stocks[0].stockAllocated = 2;
        test.state.orders.push({
            id: 'line',
            productVariantId: '12',
            quantity: 2,
            order: { id: 'order', salesChannelId: '5', state: 'PaymentSettled', active: false },
        });
        const warehouse = structuredClone(test.state.stocks);
        const config = await test.transaction(test.ctx, () => test.service.migrate(test.ctx, '12', 98, 2));
        expect(config.availableQuantity).toBe(98);
        expect(test.state.reservations).toHaveLength(1);
        expect(test.state.reservations[0]).toMatchObject({ channelId: '5', quantity: 2, state: 'HELD' });
        expect(test.state.stocks).toEqual(warehouse);
        expect(test.state.audits).toEqual([]);
    });

    it('serializes concurrent repeats and creates exactly one ACTIVE config, MIGRATE and ownership audit', async () => {
        const test = migrationHarness();
        const input = test.confirmation();
        const [first, second] = await Promise.all([
            test.migrate(input, 100, 0, { ...test.ctx }),
            test.migrate(input, 100, 0, { ...test.ctx }),
        ]);
        expect(first.id).toBe(second.id);
        expect(test.state.configurations).toHaveLength(1);
        expect(test.state.movements).toHaveLength(1);
        expect(test.state.audits).toHaveLength(1);
    });

    it('rejects a later cross-store re-claim even after the variant and product are reassigned', async () => {
        const test = migrationHarness();
        const input = test.confirmation();
        await test.migrate(input);
        test.state.product.channels = [test.other];
        test.state.variant.channels = [test.other];
        const original = structuredClone(test.state);
        await expect(
            test.migrate(input, 100, 0, { ...test.ctx, channelId: '8', channel: test.other }),
        ).rejects.toThrow();
        expect(test.state).toEqual(original);
    });

    it('requires atomic rollback on audit failure and retains the native transaction boundary', async () => {
        const test = migrationHarness();
        const original = structuredClone(test.state);
        test.audit.appendAudit.mockRejectedValueOnce(new Error('Audit storage unavailable'));
        await expect(test.migrate()).rejects.toThrow('Audit storage unavailable');
        expect(test.state).toEqual(original);
        expect(
            Reflect.getMetadata(
                '__transaction_mode__',
                Object.getOwnPropertyDescriptor(
                    DigitalProductAdminResolver.prototype,
                    'migrateDigitalInventory',
                )?.value,
            ),
        ).toBe('auto');
        expect(test.connection.getRepository.mock.calls.every(([request]) => request === test.ctx)).toBe(
            true,
        );
    });
    it('retains the existing exported governance service as the runtime audit injection token', async () => {
        // DI metadata belongs to the production TypeScript output, not Vitest's source transform.
        const { DigitalProductService: CompiledDigitalProductService } =
            await import('../dist/digital-product.service.js');
        expect(Reflect.getMetadata('design:paramtypes', CompiledDigitalProductService)[4]).toBe(
            GovernanceService,
        );
    });
    it('rejects confirmed migration outside the native transaction boundary', async () => {
        const test = migrationHarness();
        test.ctx.transactionActive = false;
        const original = structuredClone(test.state);
        await expect(test.migrate()).rejects.toThrow('事务迁移入口');
        expect(test.state).toEqual(original);
        expect(test.calls.some(call => call.startsWith('save:'))).toBe(false);
    });
    it('does not lock physical warehouse rows for a non-digital product', async () => {
        const test = migrationHarness();
        test.state.product.customFields.fulfillmentType = 'physical';
        await expect(test.migrate()).rejects.toThrow('仅适用于数字商品');
        expect(test.calls).not.toContain('lock:StockLevel');
        expect(test.state.configurations).toEqual([]);
    });
    it.each(['missing-actor', 'missing-audit'])(
        'fails closed for %s instead of performing an unaudited claim',
        async condition => {
            const test = migrationHarness();
            if (condition === 'missing-actor') test.ctx.activeUserId = null;
            const service =
                condition === 'missing-audit'
                    ? new DigitalProductService(test.connection as any, {} as any, {} as any)
                    : test.service;
            const original = structuredClone(test.state);
            await expect(
                test.transaction(test.ctx, () =>
                    service.migrate(test.ctx, '12', 100, 0, test.confirmation()),
                ),
            ).rejects.toThrow();
            expect(test.state).toEqual(original);
        },
    );

    it('does not silently truncate a confirmation scope larger than fifty ownerless rows', async () => {
        const test = migrationHarness();
        for (let index = 0; index < 50; index += 1)
            test.state.stocks.push({ ...structuredClone(test.state.stocks[0]), id: String(200 + index) });
        const preview = await test.service.migrationPreview(test.ctx, '12');
        expect(preview.confirmableStockLevels).toEqual([]);
        expect(preview.conflicts).toContain('旧库存或未完成订单缺少店铺归属，请先核对，不能自动迁移');
        const original = structuredClone(test.state);
        await expect(test.migrate()).rejects.toThrow();
        expect(test.state).toEqual(original);
    });

    it('rejects an unsafe negative aggregate before clamping availability to zero', async () => {
        const test = migrationHarness();
        test.state.stocks[0].stockOnHand = -Number.MAX_SAFE_INTEGER;
        test.state.stocks[1].stockOnHand = -Number.MAX_SAFE_INTEGER;
        await expect(
            test.service.migrationPreview(test.ctx, '12', undefined, test.confirmation()),
        ).rejects.toThrow('旧库存汇总数量无效');
        expect(test.state.configurations).toEqual([]);
    });

    it.each([NaN, Number.MAX_SAFE_INTEGER + 1, 0.5])(
        'rejects invalid expected quantities %s before migration side effects',
        async quantity => {
            const test = migrationHarness();
            const original = structuredClone(test.state);
            await expect(test.migrate(test.confirmation(), quantity)).rejects.toThrow('有效整数');
            expect(test.state).toEqual(original);
        },
    );
});

describe('native migration GraphQL compatibility', () => {
    const schema = buildSchema(`${print(digitalProductAdminSchema)}
        interface Node { id: ID! createdAt: DateTime! updatedAt: DateTime! }
        scalar DateTime
        scalar Upload
        type Product { id: ID! }
        type CatalogSupplier { id: ID! }
        type Query { noop: Boolean }
        type Mutation { noop: Boolean }
    `);
    it('accepts the unchanged legacy query and mutation', () => {
        expect(
            validate(
                schema,
                parse(`query LegacyReview { digitalInventoryMigrationPreview(productVariantId:"12") {
            availableQuantity reservedQuantity conflicts alreadyMigrated } }
            mutation LegacyApply { migrateDigitalInventory(productVariantId:"12", expectedAvailable:100, expectedReserved:0) { id } }`),
            ),
        ).toEqual([]);
    });
    it('accepts a complete typed ownership confirmation in both native operations', () => {
        expect(
            validate(
                schema,
                parse(`query Review($confirmation:DigitalInventoryOwnershipConfirmationInput!) {
            digitalInventoryMigrationPreview(productVariantId:"12",ownershipConfirmation:$confirmation) {
                confirmableStockLevels { id stockLocationId stockOnHand stockAllocated } conflicts
            } }
            mutation Apply($confirmation:DigitalInventoryOwnershipConfirmationInput!) {
            migrateDigitalInventory(productVariantId:"12",expectedAvailable:100,expectedReserved:0,ownershipConfirmation:$confirmation) { id }
            }`),
            ),
        ).toEqual([]);
    });
});
