import { Injectable } from '@nestjs/common';
import { CurrencyCode, Permission } from '@vendure/common/lib/generated-types';
import {
    ForbiddenError,
    Order,
    PaymentMethod,
    RequestContext,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { createHash } from 'node:crypto';
import { And, In, LessThan, MoreThanOrEqual } from 'typeorm';

import { manageCatalogOperationsPermission } from './constants';
import { OrderProfitExpenseEvent } from './entities/order-profit-expense-event.entity';
import { OrderProfitExpense } from './entities/order-profit-expense.entity';
import { VariantCostRecord } from './entities/variant-cost-record.entity';

const MAX_REPORT_DAYS = 366;
const MAX_REPORT_ORDERS = 20_000;
const MAX_EXPENSE_IMPORT_ROWS = 5_000;
const SETTLED_STATE = 'Settled';
const TEST_PAYMENT_PATTERN = /(?:^|[-_\s])(demo|dummy|mock|sandbox|test)(?:$|[-_\s])|测试/iu;

export interface CatalogProfitReportInput {
    from: Date | string;
    to: Date | string;
    currencyCode?: CurrencyCode | null;
    skip?: number | null;
    take?: number | null;
}

export interface SaveCatalogOrderProfitExpenseInput {
    orderId: string;
    carrierShippingCostMicrounits?: number | null;
    paymentFeeMicrounits?: number | null;
    chargebackMicrounits?: number | null;
    note?: string | null;
    expectedUpdatedAt?: Date | string | null;
    idempotencyKey?: string | null;
}

export interface CatalogOrderProfitExpenseImportRowInput {
    rowNumber: number;
    orderCode: string;
    carrierShippingCostMicrounits?: number | null;
    paymentFeeMicrounits?: number | null;
    chargebackMicrounits?: number | null;
    note?: string | null;
}

export interface ImportCatalogOrderProfitExpensesInput {
    currencyCode: CurrencyCode;
    filename: string;
    fileHash: string;
    rows: CatalogOrderProfitExpenseImportRowInput[];
}

export interface CostPoint {
    effectiveAt: Date;
    costMicrounits: number;
}

interface ProfitOrderLineSource {
    productVariantId: string;
    quantity: number;
}

interface ProfitPaymentSource {
    method: string;
    handlerCode?: string;
    amount: number;
    state: string;
    refunds?: Array<{ total: number; state: string }>;
}

export interface ProfitOrderSource {
    id: string;
    code: string;
    orderPlacedAt: Date;
    currencyCode: CurrencyCode;
    total: number;
    totalWithTax: number;
    discountWithTax: number;
    shippingWithTax: number;
    lines: ProfitOrderLineSource[];
    payments: ProfitPaymentSource[];
}

export interface CatalogProfitOrderResult {
    id: string;
    code: string;
    orderPlacedAt: Date;
    currencyCode: CurrencyCode;
    quantity: number;
    settledRevenueMicrounits: number;
    refundedRevenueMicrounits: number;
    netRevenueMicrounits: number;
    shippingRevenueMicrounits: number;
    grossSalesMicrounits: number;
    discountMicrounits: number;
    taxMicrounits: number;
    productCostMicrounits: number | null;
    grossProfitMicrounits: number | null;
    grossMargin: number | null;
    carrierShippingCostMicrounits: number | null;
    paymentFeeMicrounits: number | null;
    chargebackMicrounits: number | null;
    netProfitMicrounits: number | null;
    netMargin: number | null;
    missingCostLineCount: number;
    estimatedCostLineCount: number;
}

export interface OrderProfitExpenseSource {
    carrierShippingCostMicrounits: number | null;
    paymentFeeMicrounits: number | null;
    chargebackMicrounits: number | null;
}

@Injectable()
export class CatalogProfitService {
    constructor(private readonly connection: TransactionalConnection) {}

    async orderExpense(ctx: RequestContext, orderId: string) {
        this.requireRead(ctx);
        const order = await this.scopedOrderById(ctx, orderId);
        const expense = await this.connection.getRepository(ctx, OrderProfitExpense).findOne({
            where: {
                orderId: order.id,
                channelId: ctx.channelId,
                currencyCode: order.currencyCode,
            },
        });
        return expense ? expenseView(expense) : null;
    }

    async orderExpenseEvents(ctx: RequestContext, orderId: string) {
        this.requireRead(ctx);
        const order = await this.scopedOrderById(ctx, orderId);
        const events = await this.connection.getRepository(ctx, OrderProfitExpenseEvent).find({
            where: { orderId: order.id, channelId: ctx.channelId },
            order: { createdAt: 'DESC', id: 'DESC' },
            take: 50,
        });
        return events.map(event => ({
            id: String(event.id),
            createdAt: event.createdAt,
            eventType: event.eventType,
            actorUserId: event.actorUserId,
            sourceReference: event.sourceReference,
            before: event.beforeJson ? JSON.parse(event.beforeJson) : null,
            after: JSON.parse(event.afterJson),
        }));
    }

    async saveOrderExpense(ctx: RequestContext, input: SaveCatalogOrderProfitExpenseInput) {
        this.requireWrite(ctx);
        const carrierShippingCostMicrounits =
            input.carrierShippingCostMicrounits === undefined
                ? undefined
                : normalizeExpenseMicrounits(input.carrierShippingCostMicrounits, '承运商实际物流成本');
        const paymentFeeMicrounits =
            input.paymentFeeMicrounits === undefined
                ? undefined
                : normalizeExpenseMicrounits(input.paymentFeeMicrounits, '支付手续费');
        const chargebackMicrounits =
            input.chargebackMicrounits === undefined
                ? undefined
                : normalizeExpenseMicrounits(input.chargebackMicrounits, '拒付损失');
        const note = input.note === undefined ? undefined : normalizeExpenseNote(input.note);
        const idempotencyKey = normalizeExpenseIdempotencyKey(
            input.idempotencyKey,
            input.orderId,
            carrierShippingCostMicrounits,
            paymentFeeMicrounits,
            chargebackMicrounits,
            note,
            input.expectedUpdatedAt,
        );
        return this.connection.withTransaction(ctx, async txCtx => {
            const order = await this.scopedOrderById(txCtx, input.orderId);
            const repository = this.connection.getRepository(txCtx, OrderProfitExpense);
            const eventRepository = this.connection.getRepository(txCtx, OrderProfitExpenseEvent);
            const retried = await eventRepository.findOneBy({
                channelId: txCtx.channelId,
                idempotencyKey,
            });
            if (retried) {
                const retryExpense = await repository.findOne({
                    where: {
                        orderId: order.id,
                        channelId: txCtx.channelId,
                        currencyCode: order.currencyCode,
                    },
                });
                if (!retryExpense || String(retried.orderId) !== String(order.id)) {
                    throw new UserInputError('该幂等键已用于其他费用记录');
                }
                return expenseView(retryExpense);
            }
            const current = await repository.findOne({
                where: {
                    orderId: order.id,
                    channelId: txCtx.channelId,
                    currencyCode: order.currencyCode,
                },
            });
            assertExpectedUpdatedAt(current, input.expectedUpdatedAt);
            const beforeJson = current ? JSON.stringify(expenseAuditSnapshot(current)) : null;
            const expense =
                current ??
                repository.create({
                    orderId: order.id,
                    channelId: txCtx.channelId,
                    currencyCode: order.currencyCode,
                    carrierShippingCostMicrounits: null,
                    paymentFeeMicrounits: null,
                    chargebackMicrounits: null,
                    note: null,
                });
            if (carrierShippingCostMicrounits !== undefined) {
                expense.carrierShippingCostMicrounits = toStoredMicrounits(carrierShippingCostMicrounits);
            }
            if (paymentFeeMicrounits !== undefined) {
                expense.paymentFeeMicrounits = toStoredMicrounits(paymentFeeMicrounits);
            }
            if (chargebackMicrounits !== undefined) {
                expense.chargebackMicrounits = toStoredMicrounits(chargebackMicrounits);
            }
            if (note !== undefined) expense.note = note;
            expense.source = 'MANUAL';
            expense.sourceReference = null;
            expense.actorId = txCtx.activeUserId ? String(txCtx.activeUserId) : null;
            let persisted: OrderProfitExpense;
            if (current) {
                const nextMillisecond = new Date(current.updatedAt.getTime() + 1);
                const result = await repository.update(
                    {
                        id: current.id,
                        channelId: txCtx.channelId,
                        // Database timestamps can retain microseconds that JavaScript Date truncates.
                        updatedAt: And(MoreThanOrEqual(current.updatedAt), LessThan(nextMillisecond)),
                    },
                    {
                        carrierShippingCostMicrounits: expense.carrierShippingCostMicrounits,
                        paymentFeeMicrounits: expense.paymentFeeMicrounits,
                        chargebackMicrounits: expense.chargebackMicrounits,
                        note: expense.note,
                        source: expense.source,
                        sourceReference: expense.sourceReference,
                        actorId: expense.actorId,
                        // Advancing beyond the previous millisecond also rejects simultaneous writers.
                        updatedAt: new Date(Math.max(Date.now(), nextMillisecond.getTime())),
                    },
                );
                if (result.affected !== 1) {
                    throw new UserInputError('费用记录已被其他管理员修改，请刷新后重试');
                }
                persisted = await repository.findOneOrFail({
                    where: { id: current.id, channelId: txCtx.channelId },
                });
            } else {
                persisted = await repository.save(expense);
            }
            await eventRepository.save(
                eventRepository.create({
                    orderId: order.id,
                    channelId: txCtx.channelId,
                    currencyCode: order.currencyCode,
                    eventType: 'MANUAL_SAVE',
                    idempotencyKey,
                    actorUserId: txCtx.activeUserId ? String(txCtx.activeUserId) : null,
                    sourceReference: null,
                    beforeJson,
                    afterJson: JSON.stringify(expenseAuditSnapshot(persisted)),
                }),
            );
            return expenseView(persisted);
        });
    }

    async importOrderExpenses(ctx: RequestContext, input: ImportCatalogOrderProfitExpensesInput) {
        this.requireWrite(ctx);
        const rows = normalizeExpenseImport(input);
        return this.connection.withTransaction(ctx, async txCtx => {
            const orderRepository = this.connection.getRepository(txCtx, Order);
            const normalizedCodes = rows.map(row => normalizeOrderCode(row.orderCode));
            const orders = await orderRepository
                .createQueryBuilder('order')
                .innerJoin('order.channels', 'expenseChannel', 'expenseChannel.id = :channelId', {
                    channelId: txCtx.channelId,
                })
                .where('LOWER(order.code) IN (:...orderCodes)', { orderCodes: normalizedCodes })
                .andWhere('order.currencyCode = :currencyCode', { currencyCode: input.currencyCode })
                .andWhere('order.orderPlacedAt IS NOT NULL')
                .getMany();
            const ordersByCode = new Map(orders.map(order => [normalizeOrderCode(order.code), order]));
            const missing = rows.filter(row => !ordersByCode.has(normalizeOrderCode(row.orderCode)));
            if (missing.length > 0) {
                throw new UserInputError(
                    `找不到当前店铺与币种下的已下单订单：${missing
                        .slice(0, 8)
                        .map(row => `第 ${row.rowNumber} 行 ${row.orderCode}`)
                        .join('、')}${missing.length > 8 ? ` 等 ${missing.length} 行` : ''}`,
                );
            }
            const orderIds = orders.map(order => order.id);
            const repository = this.connection.getRepository(txCtx, OrderProfitExpense);
            const eventRepository = this.connection.getRepository(txCtx, OrderProfitExpenseEvent);
            const eventKey = (rowNumber: number) => `import:${input.fileHash}:${rowNumber}`;
            const existingEvents = await eventRepository.find({
                where: {
                    channelId: txCtx.channelId,
                    idempotencyKey: In(rows.map(row => eventKey(row.rowNumber))),
                },
            });
            const existingEventKeys = new Set(existingEvents.map(event => event.idempotencyKey));
            const pendingRows = rows.filter(row => !existingEventKeys.has(eventKey(row.rowNumber)));
            if (!pendingRows.length) return { totalRows: rows.length, createdCount: 0, updatedCount: 0 };
            const current = await repository.find({
                where: {
                    orderId: In(orderIds),
                    channelId: txCtx.channelId,
                    currencyCode: input.currencyCode,
                },
            });
            const expenseByOrder = new Map(current.map(expense => [String(expense.orderId), expense]));
            const beforeByOrder = new Map(
                current.map(expense => [
                    String(expense.orderId),
                    JSON.stringify(expenseAuditSnapshot(expense)),
                ]),
            );
            let createdCount = 0;
            let updatedCount = 0;
            const expenses = pendingRows.map(row => {
                const order = ordersByCode.get(normalizeOrderCode(row.orderCode));
                if (!order) throw new UserInputError('找不到当前店铺与币种下的已下单订单');
                const existing = expenseByOrder.get(String(order.id));
                const expense =
                    existing ??
                    repository.create({
                        orderId: order.id,
                        channelId: txCtx.channelId,
                        currencyCode: order.currencyCode,
                        carrierShippingCostMicrounits: null,
                        paymentFeeMicrounits: null,
                        chargebackMicrounits: null,
                        note: null,
                    });
                if (row.carrierShippingCostMicrounits !== undefined) {
                    expense.carrierShippingCostMicrounits = toStoredMicrounits(
                        row.carrierShippingCostMicrounits,
                    );
                }
                if (row.paymentFeeMicrounits !== undefined) {
                    expense.paymentFeeMicrounits = toStoredMicrounits(row.paymentFeeMicrounits);
                }
                if (row.chargebackMicrounits !== undefined) {
                    expense.chargebackMicrounits = toStoredMicrounits(row.chargebackMicrounits);
                }
                if (row.note !== undefined) expense.note = row.note;
                expense.source = 'IMPORT';
                expense.sourceReference = input.fileHash;
                expense.actorId = txCtx.activeUserId ? String(txCtx.activeUserId) : null;
                if (existing) updatedCount += 1;
                else createdCount += 1;
                return expense;
            });
            const saved = await repository.save(expenses);
            const savedByOrder = new Map(saved.map(expense => [String(expense.orderId), expense]));
            await eventRepository.save(
                pendingRows.map(row => {
                    const order = ordersByCode.get(normalizeOrderCode(row.orderCode));
                    if (!order) throw new UserInputError('找不到当前店铺与币种下的已下单订单');
                    const expense = savedByOrder.get(String(order.id));
                    if (!expense) throw new UserInputError('费用导入后无法读取保存结果');
                    return eventRepository.create({
                        orderId: order.id,
                        channelId: txCtx.channelId,
                        currencyCode: order.currencyCode,
                        eventType: 'IMPORT',
                        idempotencyKey: eventKey(row.rowNumber),
                        actorUserId: txCtx.activeUserId ? String(txCtx.activeUserId) : null,
                        sourceReference: input.fileHash,
                        beforeJson: beforeByOrder.get(String(order.id)) ?? null,
                        afterJson: JSON.stringify(expenseAuditSnapshot(expense)),
                    });
                }),
            );
            return { totalRows: rows.length, createdCount, updatedCount };
        });
    }

    async report(ctx: RequestContext, input: CatalogProfitReportInput) {
        this.requireRead(ctx);
        const range = normalizeRange(input);
        const currencyCode = input.currencyCode ?? ctx.channel.defaultCurrencyCode;
        const baseQuery = this.connection
            .getRepository(ctx, Order)
            .createQueryBuilder('order')
            .innerJoin('order.channels', 'reportChannel', 'reportChannel.id = :channelId', {
                channelId: ctx.channelId,
            })
            .innerJoin('order.payments', 'settledPayment', 'settledPayment.state = :settledPaymentState', {
                settledPaymentState: SETTLED_STATE,
            })
            .where('order.active = :active', { active: false })
            .andWhere('order.orderPlacedAt >= :from', { from: range.from })
            .andWhere('order.orderPlacedAt <= :to', { to: range.to })
            .andWhere('order.currencyCode = :currencyCode', { currencyCode });

        const countRow = await baseQuery
            .clone()
            .select('COUNT(DISTINCT order.id)', 'totalItems')
            .getRawOne<{ totalItems: string | number }>();
        const candidateCount = Number(countRow?.totalItems ?? 0);
        if (candidateCount > MAX_REPORT_ORDERS) {
            throw new UserInputError(
                `单次利润报表最多处理 ${MAX_REPORT_ORDERS.toLocaleString()} 笔订单，请缩短日期范围`,
            );
        }

        const orders = await baseQuery
            .leftJoinAndSelect('order.lines', 'line')
            .leftJoinAndSelect('line.adjustments', 'lineAdjustment')
            .leftJoinAndSelect('line.taxLines', 'lineTaxLine')
            .leftJoinAndSelect('order.shippingLines', 'shippingLine')
            .leftJoinAndSelect('shippingLine.adjustments', 'shippingAdjustment')
            .leftJoinAndSelect('shippingLine.taxLines', 'shippingTaxLine')
            .leftJoinAndSelect('order.payments', 'payment')
            .leftJoinAndSelect('payment.refunds', 'refund')
            .distinct(true)
            .orderBy('order.orderPlacedAt', 'DESC')
            .addOrderBy('order.id', 'DESC')
            .getMany();
        const variantIds = [
            ...new Set(orders.flatMap(order => order.lines.map(line => String(line.productVariantId)))),
        ];
        const orderIds = orders.map(order => order.id);
        const paymentMethodCodes = [...new Set(orders.flatMap(order => order.payments.map(p => p.method)))];
        const [costRecords, expenseRecords, paymentMethods] = await Promise.all([
            variantIds.length
                ? this.connection.getRepository(ctx, VariantCostRecord).find({
                      where: {
                          variantId: In(variantIds),
                          channelId: ctx.channelId,
                          currencyCode,
                      },
                      order: { effectiveAt: 'ASC', id: 'ASC' },
                  })
                : [],
            orderIds.length
                ? this.connection.getRepository(ctx, OrderProfitExpense).find({
                      where: {
                          orderId: In(orderIds),
                          channelId: ctx.channelId,
                          currencyCode,
                      },
                  })
                : [],
            paymentMethodCodes.length
                ? this.connection.getRepository(ctx, PaymentMethod).find({
                      where: { code: In(paymentMethodCodes), channels: { id: ctx.channelId } },
                      select: { code: true, handler: true },
                  })
                : [],
        ]);
        const handlersByMethod = new Map(paymentMethods.map(method => [method.code, method.handler.code]));
        const costsByVariant = new Map<string, CostPoint[]>();
        for (const record of costRecords) {
            const key = String(record.variantId);
            const current = costsByVariant.get(key) ?? [];
            current.push({
                effectiveAt: record.effectiveAt,
                costMicrounits: Number(record.costMicrounits),
            });
            costsByVariant.set(key, current);
        }
        const expensesByOrder = new Map<string, OrderProfitExpenseSource>(
            expenseRecords.map(expense => [
                String(expense.orderId),
                {
                    carrierShippingCostMicrounits: fromStoredMicrounits(
                        expense.carrierShippingCostMicrounits,
                    ),
                    paymentFeeMicrounits: fromStoredMicrounits(expense.paymentFeeMicrounits),
                    chargebackMicrounits: fromStoredMicrounits(expense.chargebackMicrounits),
                },
            ]),
        );

        const calculated = calculateCatalogProfitReport(
            orders.map(order => ({
                id: String(order.id),
                code: order.code,
                orderPlacedAt: order.orderPlacedAt as Date,
                currencyCode: order.currencyCode,
                total: order.total,
                totalWithTax: order.totalWithTax,
                discountWithTax: Math.max(
                    0,
                    -(order.discounts ?? []).reduce(
                        (total, discount) => total + Math.min(0, discount.amountWithTax),
                        0,
                    ),
                ),
                shippingWithTax: order.shippingWithTax,
                lines: order.lines.map(line => ({
                    productVariantId: String(line.productVariantId),
                    // Keep the originally placed quantity for conservative COGS after cancellations.
                    // Lines added by an order modification can have orderPlacedQuantity = 0.
                    quantity: Math.max(line.orderPlacedQuantity, line.quantity),
                })),
                payments: order.payments.map(payment => ({
                    method: payment.method,
                    handlerCode: handlersByMethod.get(payment.method),
                    amount: payment.amount,
                    state: payment.state,
                    refunds: payment.refunds?.map(refund => ({
                        total: refund.total,
                        state: refund.state,
                    })),
                })),
            })),
            costsByVariant,
            expensesByOrder,
        );
        calculated.summary.currencyCode = currencyCode;
        const safeSkip = Math.max(0, input.skip ?? 0);
        const safeTake = Math.min(Math.max(input.take ?? 50, 1), 200);
        return {
            ...calculated,
            items: calculated.items.slice(safeSkip, safeSkip + safeTake),
            totalItems: calculated.items.length,
        };
    }

    private requireRead(ctx: RequestContext): void {
        if (
            !ctx.userHasPermissions([Permission.ReadOrder]) ||
            !ctx.userHasPermissions([manageCatalogOperationsPermission.Read])
        ) {
            throw new ForbiddenError();
        }
    }

    private requireWrite(ctx: RequestContext): void {
        if (
            !ctx.userHasPermissions([Permission.UpdateOrder]) ||
            !ctx.userHasPermissions([manageCatalogOperationsPermission.Update])
        ) {
            throw new ForbiddenError();
        }
    }

    private async scopedOrderById(ctx: RequestContext, orderId: string): Promise<Order> {
        const normalizedId = String(orderId).trim();
        if (!normalizedId) throw new UserInputError('订单 ID 不能为空');
        const order = await this.connection
            .getRepository(ctx, Order)
            .createQueryBuilder('order')
            .innerJoin('order.channels', 'expenseChannel', 'expenseChannel.id = :channelId', {
                channelId: ctx.channelId,
            })
            .where('order.id = :orderId', { orderId: normalizedId })
            .andWhere('order.orderPlacedAt IS NOT NULL')
            .getOne();
        if (!order) throw new UserInputError('找不到当前店铺下的已下单订单');
        return order;
    }
}

export function calculateCatalogProfitReport(
    orders: ProfitOrderSource[],
    costsByVariant: ReadonlyMap<string, CostPoint[]>,
    expensesByOrder: ReadonlyMap<string, OrderProfitExpenseSource> = new Map(),
) {
    const items = orders.flatMap<CatalogProfitOrderResult>(order => {
        // Historical methods may have been removed. Keep their persisted method code as evidence,
        // and also detect neutral method names backed by a registered test handler.
        const payments = order.payments;
        const settledRevenueMicrounits =
            payments
                .filter(payment => payment.state === SETTLED_STATE)
                .reduce((total, payment) => total + payment.amount, 0) * 10;
        if (settledRevenueMicrounits <= 0) return [];
        const refundedRevenueMicrounits =
            payments
                .flatMap(payment => payment.refunds ?? [])
                .filter(refund => refund.state === SETTLED_STATE)
                .reduce((total, refund) => total + refund.total, 0) * 10;
        const netRevenueMicrounits = settledRevenueMicrounits - refundedRevenueMicrounits;
        const discountMicrounits = Math.max(order.discountWithTax, 0) * 10;
        const grossSalesMicrounits = Math.max(order.totalWithTax + order.discountWithTax, 0) * 10;
        const taxMicrounits = Math.max(order.totalWithTax - order.total, 0) * 10;
        let knownCostMicrounits = 0;
        let missingCostLineCount = 0;
        let estimatedCostLineCount = 0;
        for (const line of order.lines) {
            const cost = costAt(costsByVariant.get(line.productVariantId) ?? [], order.orderPlacedAt);
            if (!cost) {
                missingCostLineCount += 1;
                continue;
            }
            knownCostMicrounits += cost.costMicrounits * Math.max(line.quantity, 0);
            if (cost.estimated) estimatedCostLineCount += 1;
        }
        const productCostMicrounits = missingCostLineCount === 0 ? knownCostMicrounits : null;
        const grossProfitMicrounits =
            productCostMicrounits == null ? null : netRevenueMicrounits - productCostMicrounits;
        const expense = expensesByOrder.get(order.id);
        const carrierShippingCostMicrounits = expense?.carrierShippingCostMicrounits ?? null;
        const paymentFeeMicrounits = expense?.paymentFeeMicrounits ?? null;
        const chargebackMicrounits = expense?.chargebackMicrounits ?? null;
        const netProfitMicrounits =
            grossProfitMicrounits == null ||
            carrierShippingCostMicrounits == null ||
            paymentFeeMicrounits == null ||
            chargebackMicrounits == null
                ? null
                : grossProfitMicrounits -
                  carrierShippingCostMicrounits -
                  paymentFeeMicrounits -
                  chargebackMicrounits;
        return [
            {
                id: order.id,
                code: order.code,
                orderPlacedAt: order.orderPlacedAt,
                currencyCode: order.currencyCode,
                quantity: order.lines.reduce((total, line) => total + Math.max(line.quantity, 0), 0),
                settledRevenueMicrounits,
                refundedRevenueMicrounits,
                netRevenueMicrounits,
                shippingRevenueMicrounits: Math.max(order.shippingWithTax, 0) * 10,
                grossSalesMicrounits,
                discountMicrounits,
                taxMicrounits,
                productCostMicrounits,
                grossProfitMicrounits,
                grossMargin:
                    grossProfitMicrounits == null || netRevenueMicrounits <= 0
                        ? null
                        : grossProfitMicrounits / netRevenueMicrounits,
                carrierShippingCostMicrounits,
                paymentFeeMicrounits,
                chargebackMicrounits,
                netProfitMicrounits,
                netMargin:
                    netProfitMicrounits == null || netRevenueMicrounits <= 0
                        ? null
                        : netProfitMicrounits / netRevenueMicrounits,
                missingCostLineCount,
                estimatedCostLineCount,
            },
        ];
    });
    return summarizeCatalogProfit(items);
}

function summarizeCatalogProfit(items: CatalogProfitOrderResult[]) {
    const missingCostOrderCount = items.filter(item => item.missingCostLineCount > 0).length;
    const estimatedCostOrderCount = items.filter(item => item.estimatedCostLineCount > 0).length;
    const missingCarrierShippingCostOrderCount = items.filter(
        item => item.carrierShippingCostMicrounits == null,
    ).length;
    const missingPaymentFeeOrderCount = items.filter(item => item.paymentFeeMicrounits == null).length;
    const missingChargebackOrderCount = items.filter(item => item.chargebackMicrounits == null).length;
    const settledRevenueMicrounits = sum(items, item => item.settledRevenueMicrounits);
    const refundedRevenueMicrounits = sum(items, item => item.refundedRevenueMicrounits);
    const netRevenueMicrounits = sum(items, item => item.netRevenueMicrounits);
    const knownProductCostMicrounits = sum(items, item => item.productCostMicrounits ?? 0);
    const productCostMicrounits = missingCostOrderCount === 0 ? knownProductCostMicrounits : null;
    const grossProfitMicrounits =
        productCostMicrounits == null ? null : netRevenueMicrounits - productCostMicrounits;
    const carrierShippingCostMicrounits =
        missingCarrierShippingCostOrderCount === 0
            ? sum(items, item => item.carrierShippingCostMicrounits ?? 0)
            : null;
    const paymentFeeMicrounits =
        missingPaymentFeeOrderCount === 0 ? sum(items, item => item.paymentFeeMicrounits ?? 0) : null;
    const chargebackMicrounits =
        missingChargebackOrderCount === 0 ? sum(items, item => item.chargebackMicrounits ?? 0) : null;
    const netProfitMicrounits =
        grossProfitMicrounits == null ||
        carrierShippingCostMicrounits == null ||
        paymentFeeMicrounits == null ||
        chargebackMicrounits == null
            ? null
            : grossProfitMicrounits -
              carrierShippingCostMicrounits -
              paymentFeeMicrounits -
              chargebackMicrounits;
    return {
        summary: {
            currencyCode: items[0]?.currencyCode ?? CurrencyCode.CNY,
            orderCount: items.length,
            quantity: sum(items, item => item.quantity),
            settledRevenueMicrounits,
            refundedRevenueMicrounits,
            netRevenueMicrounits,
            shippingRevenueMicrounits: sum(items, item => item.shippingRevenueMicrounits),
            grossSalesMicrounits: sum(items, item => item.grossSalesMicrounits),
            discountMicrounits: sum(items, item => item.discountMicrounits),
            taxMicrounits: sum(items, item => item.taxMicrounits),
            productCostMicrounits,
            grossProfitMicrounits,
            grossMargin:
                grossProfitMicrounits == null || netRevenueMicrounits <= 0
                    ? null
                    : grossProfitMicrounits / netRevenueMicrounits,
            carrierShippingCostMicrounits,
            paymentFeeMicrounits,
            chargebackMicrounits,
            netProfitMicrounits,
            netMargin:
                netProfitMicrounits == null || netRevenueMicrounits <= 0
                    ? null
                    : netProfitMicrounits / netRevenueMicrounits,
            missingCostOrderCount,
            missingCostLineCount: sum(items, item => item.missingCostLineCount),
            estimatedCostOrderCount,
            estimatedCostLineCount: sum(items, item => item.estimatedCostLineCount),
            missingCarrierShippingCostOrderCount,
            missingPaymentFeeOrderCount,
            missingChargebackOrderCount,
            includesCarrierShippingCost: missingCarrierShippingCostOrderCount === 0,
            includesPaymentFees: missingPaymentFeeOrderCount === 0,
            includesChargebacks: missingChargebackOrderCount === 0,
        },
        items,
    };
}

function normalizeExpenseImport(input: ImportCatalogOrderProfitExpensesInput) {
    if (!input.rows.length) throw new UserInputError('费用导入文件没有可写入行');
    if (input.rows.length > MAX_EXPENSE_IMPORT_ROWS) {
        throw new UserInputError(`费用导入单次最多 ${MAX_EXPENSE_IMPORT_ROWS.toLocaleString()} 行`);
    }
    if (!/^[a-f0-9]{64}$/u.test(input.fileHash)) throw new UserInputError('费用导入文件摘要无效');
    if (!input.filename.trim() || input.filename.length > 255) {
        throw new UserInputError('费用导入文件名无效');
    }
    const seenCodes = new Set<string>();
    return input.rows.map((row, index) => {
        const rowNumber = Number.isInteger(row.rowNumber) && row.rowNumber > 1 ? row.rowNumber : index + 2;
        const orderCode = String(row.orderCode ?? '').trim();
        if (!orderCode) throw new UserInputError(`第 ${rowNumber} 行：订单号不能为空`);
        if (orderCode.length > 64) throw new UserInputError(`第 ${rowNumber} 行：订单号过长`);
        const normalizedCode = normalizeOrderCode(orderCode);
        if (seenCodes.has(normalizedCode)) {
            throw new UserInputError(`第 ${rowNumber} 行：订单号 ${orderCode} 在文件中重复`);
        }
        seenCodes.add(normalizedCode);
        const carrierShippingCostMicrounits =
            row.carrierShippingCostMicrounits === undefined
                ? undefined
                : normalizeExpenseMicrounits(
                      row.carrierShippingCostMicrounits,
                      `第 ${rowNumber} 行承运商实际物流成本`,
                  );
        const paymentFeeMicrounits =
            row.paymentFeeMicrounits === undefined
                ? undefined
                : normalizeExpenseMicrounits(row.paymentFeeMicrounits, `第 ${rowNumber} 行支付手续费`);
        const chargebackMicrounits =
            row.chargebackMicrounits === undefined
                ? undefined
                : normalizeExpenseMicrounits(row.chargebackMicrounits, `第 ${rowNumber} 行拒付损失`);
        if (
            carrierShippingCostMicrounits == null &&
            paymentFeeMicrounits == null &&
            chargebackMicrounits == null
        ) {
            throw new UserInputError(`第 ${rowNumber} 行：至少填写一项实际费用，0 元请明确填 0`);
        }
        return {
            rowNumber,
            orderCode,
            carrierShippingCostMicrounits,
            paymentFeeMicrounits,
            chargebackMicrounits,
            note: row.note === undefined ? undefined : normalizeExpenseNote(row.note),
        };
    });
}

function normalizeExpenseMicrounits(value: number | null | undefined, label: string): number | null {
    if (value == null) return null;
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new UserInputError(`${label}必须是非负且不超过 3 位小数的有效金额`);
    }
    return value;
}

function normalizeExpenseNote(value: string | null | undefined): string | null {
    const note = String(value ?? '').trim();
    if (note.length > 500) throw new UserInputError('费用备注不能超过 500 个字符');
    return note || null;
}

function normalizeOrderCode(value: string): string {
    return value.normalize('NFKC').trim().toLocaleLowerCase('en-US');
}

function toStoredMicrounits(value: number | null): string | null {
    return value == null ? null : String(value);
}

function fromStoredMicrounits(value: string | null): number | null {
    return value == null ? null : Number(value);
}

function expenseView(expense: OrderProfitExpense) {
    return {
        id: String(expense.id),
        createdAt: expense.createdAt,
        updatedAt: expense.updatedAt,
        orderId: String(expense.orderId),
        currencyCode: expense.currencyCode,
        carrierShippingCostMicrounits: fromStoredMicrounits(expense.carrierShippingCostMicrounits),
        paymentFeeMicrounits: fromStoredMicrounits(expense.paymentFeeMicrounits),
        chargebackMicrounits: fromStoredMicrounits(expense.chargebackMicrounits),
        source: expense.source,
        sourceReference: expense.sourceReference,
        note: expense.note,
    };
}

function expenseAuditSnapshot(expense: OrderProfitExpense) {
    return {
        carrierShippingCostMicrounits: fromStoredMicrounits(expense.carrierShippingCostMicrounits),
        paymentFeeMicrounits: fromStoredMicrounits(expense.paymentFeeMicrounits),
        chargebackMicrounits: fromStoredMicrounits(expense.chargebackMicrounits),
        source: expense.source,
        sourceReference: expense.sourceReference,
        note: expense.note,
    };
}

function normalizeExpenseIdempotencyKey(
    value: string | null | undefined,
    orderId: string,
    carrierShippingCostMicrounits: number | null | undefined,
    paymentFeeMicrounits: number | null | undefined,
    chargebackMicrounits: number | null | undefined,
    note: string | null | undefined,
    expectedUpdatedAt: Date | string | null | undefined,
): string {
    const provided = String(value ?? '').trim();
    if (provided) {
        if (!/^[a-zA-Z0-9:_-]{8,96}$/u.test(provided)) throw new UserInputError('费用操作幂等键格式无效');
        return provided;
    }
    const digest = createHash('sha256')
        .update(
            JSON.stringify([
                orderId,
                carrierShippingCostMicrounits,
                paymentFeeMicrounits,
                chargebackMicrounits,
                note,
                expectedUpdatedAt ? new Date(expectedUpdatedAt).toISOString() : null,
            ]),
        )
        .digest('hex');
    return `legacy:${digest}`;
}

function assertExpectedUpdatedAt(
    current: OrderProfitExpense | null,
    expectedUpdatedAt: Date | string | null | undefined,
): void {
    if (expectedUpdatedAt == null) return;
    const expected = new Date(expectedUpdatedAt).getTime();
    if (!Number.isFinite(expected) || !current || current.updatedAt.getTime() !== expected) {
        throw new UserInputError('费用记录已被其他管理员修改，请刷新后重试');
    }
}

function costAt(costs: CostPoint[], at: Date): (CostPoint & { estimated: boolean }) | null {
    let historical: CostPoint | null = null;
    for (const cost of costs) {
        if (cost.effectiveAt.getTime() <= at.getTime()) historical = cost;
        else break;
    }
    if (historical) return { ...historical, estimated: false };
    const current = costs.at(-1);
    return current ? { ...current, estimated: true } : null;
}

function normalizeRange(input: CatalogProfitReportInput) {
    const from = new Date(input.from);
    const to = new Date(input.to);
    if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())) {
        throw new UserInputError('利润报表日期无效');
    }
    if (from > to) throw new UserInputError('利润报表开始日期不能晚于结束日期');
    if (to.getTime() - from.getTime() > MAX_REPORT_DAYS * 24 * 60 * 60 * 1_000) {
        throw new UserInputError(`利润报表单次最多查询 ${MAX_REPORT_DAYS} 天`);
    }
    return { from, to };
}

function sum<T>(items: T[], selector: (item: T) => number): number {
    return items.reduce((total, item) => total + selector(item), 0);
}
