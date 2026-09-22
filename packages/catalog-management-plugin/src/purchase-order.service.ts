import { Injectable } from '@nestjs/common';
import { ID } from '@vendure/common/lib/shared-types';
import { ProductVariant, RequestContext, TransactionalConnection, UserInputError } from '@vendure/core';
import { randomUUID } from 'node:crypto';
import { Brackets, In } from 'typeorm';

import { CatalogOperationsService } from './catalog-operations.service';
import { CatalogSupplierService } from './catalog-supplier.service';
import { InventoryLot } from './entities/inventory-lot.entity';
import { PurchaseOrderEvent } from './entities/purchase-order-event.entity';
import { PurchaseOrderLine } from './entities/purchase-order-line.entity';
import { PurchaseOrder, PurchaseOrderStatus } from './entities/purchase-order.entity';
import { PurchaseReceiptLine } from './entities/purchase-receipt-line.entity';
import { PurchaseReceipt } from './entities/purchase-receipt.entity';
import { PurchaseSupplierReturnLine } from './entities/purchase-supplier-return-line.entity';
import { PurchaseSupplierReturn } from './entities/purchase-supplier-return.entity';
import {
    CreatePurchaseOrderInput,
    PurchaseOrderListOptions,
    ReceivePurchaseOrderInput,
    RecordPurchasePaymentInput,
    ReturnPurchaseOrderInput,
} from './types';

const ORDER_RELATIONS = [
    'supplier',
    'stockLocation',
    'lines',
    'lines.variant',
    'lines.variant.translations',
    'receipts',
    'receipts.lines',
    'supplierReturns',
    'supplierReturns.lines',
    'events',
] as const;

@Injectable()
export class PurchaseOrderService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly suppliers: CatalogSupplierService,
        private readonly operations: CatalogOperationsService,
    ) {}

    async findAll(ctx: RequestContext, options: PurchaseOrderListOptions = {}) {
        const skip = Math.max(0, options.skip ?? 0);
        const take = Math.min(Math.max(1, options.take ?? 50), 200);
        const query = this.connection
            .getRepository(ctx, PurchaseOrder)
            .createQueryBuilder('purchaseOrder')
            .leftJoinAndSelect('purchaseOrder.supplier', 'supplier')
            .leftJoinAndSelect('purchaseOrder.stockLocation', 'stockLocation')
            .leftJoinAndSelect('purchaseOrder.lines', 'lines')
            .leftJoinAndSelect('lines.variant', 'variant')
            .where('purchaseOrder.channelId = :channelId', { channelId: ctx.channelId });
        const text = optionalText(options.text, 255);
        if (text) {
            query.andWhere(
                new Brackets(where => {
                    where
                        .where('purchaseOrder.code LIKE :text', { text: `%${text}%` })
                        .orWhere('supplier.name LIKE :text', { text: `%${text}%` })
                        .orWhere('supplier.code LIKE :text', { text: `%${text}%` });
                }),
            );
        }
        if (options.status) {
            query.andWhere('purchaseOrder.status = :status', {
                status: validateStatus(options.status),
            });
        }
        if (options.supplierId) {
            query.andWhere('purchaseOrder.supplierId = :supplierId', { supplierId: options.supplierId });
        }
        if (options.exceptionsOnly) {
            query.andWhere(
                new Brackets(where => {
                    where
                        .where("purchaseOrder.status = 'VARIANCE_REVIEW'")
                        .orWhere("purchaseOrder.paymentStatus = 'DISPUTED'")
                        .orWhere(
                            "purchaseOrder.expectedAt < :now AND purchaseOrder.status IN ('SUBMITTED', 'PARTIALLY_RECEIVED')",
                            { now: new Date() },
                        );
                }),
            );
        }
        const [items, totalItems] = await query
            .orderBy('purchaseOrder.createdAt', 'DESC')
            .addOrderBy('purchaseOrder.id', 'DESC')
            .skip(skip)
            .take(take)
            .getManyAndCount();
        return { items: items.map(order => purchaseOrderView(order)), totalItems };
    }

    async findOne(ctx: RequestContext, id: ID) {
        const order = await this.connection.getRepository(ctx, PurchaseOrder).findOne({
            where: { id, channelId: ctx.channelId },
            relations: [...ORDER_RELATIONS],
            order: { events: { createdAt: 'ASC', id: 'ASC' } },
        });
        if (!order) throw new UserInputError('采购单不存在或不属于当前门店');
        const lots = order.lines.length
            ? await this.connection.getRepository(ctx, InventoryLot).find({
                  where: {
                      variantId: In(order.lines.map(line => line.variantId)),
                      stockLocationId: order.stockLocationId,
                  },
                  order: { expiresAt: 'ASC', createdAt: 'ASC', id: 'ASC' },
              })
            : [];
        return purchaseOrderView(order, lots);
    }

    async create(ctx: RequestContext, input: CreatePurchaseOrderInput) {
        validateCreateInput(input);
        return this.connection.withTransaction(ctx, async txCtx => {
            const supplier = await this.suppliers.findOne(txCtx, input.supplierId);
            if (!supplier.enabled) throw new UserInputError('已停用的供货商不能新建采购单');
            await this.operations.requireStockLocation(txCtx, input.stockLocationId);
            const variantIds = [...new Set(input.lines.map(line => String(line.productVariantId)))];
            if (variantIds.length !== input.lines.length)
                throw new UserInputError('同一 SKU 不能在采购单中重复');
            const variants = await this.connection.getRepository(txCtx, ProductVariant).find({
                where: { id: In(variantIds) },
                relations: ['channels'],
            });
            const byId = new Map(variants.map(variant => [String(variant.id), variant]));
            for (const variantId of variantIds) {
                const variant = byId.get(variantId);
                if (
                    !variant ||
                    !variant.channels.some(channel => String(channel.id) === String(txCtx.channelId))
                ) {
                    throw new UserInputError(`SKU ${variantId} 不存在或不属于当前门店`);
                }
            }
            const totalMicrounits = input.lines.reduce(
                (total, line) => total + line.orderedQuantity * line.unitCostMicrounits,
                0,
            );
            assertSafeMoney(totalMicrounits, '采购单总额');
            const orderRepository = this.connection.getRepository(txCtx, PurchaseOrder);
            const order = await orderRepository.save(
                new PurchaseOrder({
                    channelId: txCtx.channelId,
                    supplierId: supplier.id,
                    stockLocationId: input.stockLocationId,
                    code: await this.availableCode(txCtx, input.code),
                    status: 'DRAFT',
                    paymentStatus: 'UNPAID',
                    currencyCode: input.currencyCode,
                    totalMicrounits: String(totalMicrounits),
                    paidMicrounits: '0',
                    returnCreditMicrounits: '0',
                    expectedAt: nullableDate(input.expectedAt, '预计到货日'),
                    submittedAt: null,
                    closedAt: null,
                    createdByUserId: actorId(txCtx),
                    submittedByUserId: null,
                    closedByUserId: null,
                    notes: optionalText(input.notes, 10_000),
                    closureNote: null,
                }),
            );
            const lines = input.lines.map(line => {
                const variant = byId.get(String(line.productVariantId));
                const fields = (variant?.customFields ?? {}) as unknown as Record<string, unknown>;
                return new PurchaseOrderLine({
                    purchaseOrderId: order.id,
                    variantId: line.productVariantId,
                    orderedQuantity: line.orderedQuantity,
                    receivedQuantity: 0,
                    acceptedQuantity: 0,
                    rejectedQuantity: 0,
                    returnedQuantity: 0,
                    unitCostMicrounits: String(line.unitCostMicrounits),
                    purchaseUnit: optionalText(fields.purchaseUnit, 80),
                    packageQuantity: positiveNumber(fields.packageQuantity) ?? 1,
                    notes: optionalText(line.notes, 2_000),
                });
            });
            await this.connection.getRepository(txCtx, PurchaseOrderLine).save(lines);
            await this.appendEvent(txCtx, order.id, 'CREATED', '采购单已创建', {
                lineCount: lines.length,
                totalMicrounits,
            });
            return this.findOne(txCtx, order.id);
        });
    }

    async submit(ctx: RequestContext, id: ID) {
        return this.transition(ctx, id, ['DRAFT'], 'SUBMITTED', '采购单已提交', order => {
            order.submittedAt = new Date();
            order.submittedByUserId = actorId(ctx);
        });
    }

    async receive(ctx: RequestContext, input: ReceivePurchaseOrderInput) {
        validateReceiptInput(input);
        return this.connection.withTransaction(ctx, async txCtx => {
            const receiptRepository = this.connection.getRepository(txCtx, PurchaseReceipt);
            const order = await this.lockOrder(txCtx, input.purchaseOrderId);
            const existingReceipt = await receiptRepository.findOne({
                where: {
                    purchaseOrderId: input.purchaseOrderId,
                    idempotencyKey: input.idempotencyKey.trim(),
                },
            });
            if (existingReceipt) return this.findOne(txCtx, input.purchaseOrderId);
            if (!['SUBMITTED', 'PARTIALLY_RECEIVED'].includes(order.status)) {
                throw new UserInputError('只有已提交或部分收货的采购单可以收货');
            }
            const lineRepository = this.connection.getRepository(txCtx, PurchaseOrderLine);
            const lines = await this.lockLines(txCtx, order.id);
            const byId = new Map(lines.map(line => [String(line.id), line]));
            if (
                new Set(input.lines.map(line => String(line.purchaseOrderLineId))).size !== input.lines.length
            ) {
                throw new UserInputError('同一采购行不能在一次收货中重复');
            }
            const receipt = await receiptRepository.save(
                new PurchaseReceipt({
                    purchaseOrderId: order.id,
                    code: `GRN-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${randomUUID().slice(0, 8).toUpperCase()}`,
                    idempotencyKey: input.idempotencyKey.trim(),
                    supplierDeliveryReference: optionalText(input.supplierDeliveryReference, 120),
                    receivedAt: nullableDate(input.receivedAt, '收货时间') ?? new Date(),
                    receivedByUserId: actorId(txCtx),
                    notes: optionalText(input.notes, 10_000),
                }),
            );
            const receiptLines: PurchaseReceiptLine[] = [];
            for (const received of input.lines) {
                const line = byId.get(String(received.purchaseOrderLineId));
                if (!line) throw new UserInputError('收货行不属于该采购单');
                validateReceivedLine(received);
                const unitCost = received.unitCostMicrounits ?? Number(line.unitCostMicrounits);
                assertSafeMoney(unitCost, '收货单价');
                const lotCode = optionalText(received.lotCode, 80);
                if (received.acceptedQuantity > 0 && !lotCode) {
                    throw new UserInputError('验收合格数量大于 0 时必须填写批次号');
                }
                if (received.rejectedQuantity > 0 && !optionalText(received.rejectionReason, 500)) {
                    throw new UserInputError('验收不合格时必须填写原因');
                }
                line.receivedQuantity += received.receivedQuantity;
                line.acceptedQuantity += received.acceptedQuantity;
                line.rejectedQuantity += received.rejectedQuantity;
                const receiptLine = new PurchaseReceiptLine({
                    receiptId: receipt.id,
                    purchaseOrderLineId: line.id,
                    inventoryLotId: null,
                    receivedQuantity: received.receivedQuantity,
                    acceptedQuantity: received.acceptedQuantity,
                    rejectedQuantity: received.rejectedQuantity,
                    lotCode,
                    manufacturedAt: nullableDate(received.manufacturedAt, '生产日期'),
                    expiresAt: nullableDate(received.expiresAt, '到期日期'),
                    unitCostMicrounits: String(unitCost),
                    rejectionReason: optionalText(received.rejectionReason, 500),
                });
                receiptLines.push(receiptLine);
                if (received.acceptedQuantity > 0 && lotCode) {
                    const savedLot = await this.operations.changeLotQuantity(txCtx, {
                        productVariantId: line.variantId,
                        stockLocationId: order.stockLocationId,
                        lotCode,
                        manufacturedAt: received.manufacturedAt,
                        expiresAt: received.expiresAt,
                        quantityDelta: received.acceptedQuantity,
                        purchaseCostMicrounits: unitCost,
                        currencyCode: order.currencyCode,
                    });
                    receiptLine.inventoryLotId = savedLot.id;
                    await this.operations.recordCost(
                        txCtx,
                        line.variantId,
                        order.currencyCode,
                        unitCost,
                        'PURCHASE_RECEIPT',
                        String(receipt.id),
                    );
                }
            }
            await this.connection.getRepository(txCtx, PurchaseReceiptLine).save(receiptLines);
            await lineRepository.save(lines);
            order.status = deriveReceiptStatus(lines);
            await this.connection.getRepository(txCtx, PurchaseOrder).save(order);
            await this.appendEvent(txCtx, order.id, 'RECEIVED', `收货单 ${receipt.code} 已入账`, {
                receiptId: String(receipt.id),
                acceptedQuantity: receiptLines.reduce((sum, line) => sum + line.acceptedQuantity, 0),
                rejectedQuantity: receiptLines.reduce((sum, line) => sum + line.rejectedQuantity, 0),
                resultingStatus: order.status,
            });
            return this.findOne(txCtx, order.id);
        });
    }

    async close(ctx: RequestContext, id: ID, note?: string | null) {
        const closureNote = optionalText(note, 10_000);
        return this.connection.withTransaction(ctx, async txCtx => {
            const order = await this.lockOrder(txCtx, id);
            if (!['RECEIVED', 'VARIANCE_REVIEW'].includes(order.status)) {
                throw new UserInputError('只有已收货或待处理差异的采购单可以结案');
            }
            if (order.status === 'VARIANCE_REVIEW' && !closureNote) {
                throw new UserInputError('差异采购单结案时必须填写处理说明');
            }
            order.status = 'CLOSED';
            order.closedAt = new Date();
            order.closedByUserId = actorId(txCtx);
            order.closureNote = closureNote;
            await this.connection.getRepository(txCtx, PurchaseOrder).save(order);
            await this.appendEvent(txCtx, order.id, 'CLOSED', '采购单已结案', { note: closureNote });
            return this.findOne(txCtx, order.id);
        });
    }

    async cancel(ctx: RequestContext, id: ID, note?: string | null) {
        return this.connection.withTransaction(ctx, async txCtx => {
            const order = await this.lockOrder(txCtx, id);
            if (!['DRAFT', 'SUBMITTED'].includes(order.status)) {
                throw new UserInputError('已收货的采购单不能取消');
            }
            const received = await this.connection
                .getRepository(txCtx, PurchaseOrderLine)
                .createQueryBuilder('line')
                .select('COALESCE(SUM(line.receivedQuantity), 0)', 'total')
                .where('line.purchaseOrderId = :id', { id: order.id })
                .getRawOne<{ total: string }>();
            if (Number(received?.total ?? 0) > 0) throw new UserInputError('已有收货记录，不能取消');
            order.status = 'CANCELLED';
            order.closedAt = new Date();
            order.closedByUserId = actorId(txCtx);
            order.closureNote = optionalText(note, 10_000);
            await this.connection.getRepository(txCtx, PurchaseOrder).save(order);
            await this.appendEvent(txCtx, order.id, 'CANCELLED', '采购单已取消', { note: order.closureNote });
            return this.findOne(txCtx, order.id);
        });
    }

    async recordPayment(ctx: RequestContext, input: RecordPurchasePaymentInput) {
        if (!Number.isSafeInteger(input.amountMicrounits) || input.amountMicrounits <= 0) {
            throw new UserInputError('付款金额必须是正整数千分之一货币单位');
        }
        const reference = requiredText(input.reference, 160, '付款凭证号');
        return this.connection.withTransaction(ctx, async txCtx => {
            const order = await this.lockOrder(txCtx, input.purchaseOrderId);
            if (['DRAFT', 'CANCELLED'].includes(order.status)) {
                throw new UserInputError('草稿或已取消采购单不能记录付款');
            }
            const nextPaid = Number(order.paidMicrounits) + input.amountMicrounits;
            const netPayable = Number(order.totalMicrounits) - Number(order.returnCreditMicrounits);
            if (nextPaid > netPayable) {
                throw new UserInputError('累计付款不能超过扣除退供贷项后的应付金额');
            }
            order.paidMicrounits = String(nextPaid);
            order.paymentStatus = nextPaid === netPayable ? 'PAID' : 'PARTIALLY_PAID';
            await this.connection.getRepository(txCtx, PurchaseOrder).save(order);
            await this.appendEvent(txCtx, order.id, 'PAYMENT_RECORDED', `付款 ${reference} 已记录`, {
                amountMicrounits: input.amountMicrounits,
                reference,
                note: optionalText(input.note, 1_000),
                paidMicrounits: nextPaid,
            });
            return this.findOne(txCtx, order.id);
        });
    }

    async disputePayment(ctx: RequestContext, id: ID, note: string) {
        const reason = requiredText(note, 1_000, '付款争议说明');
        return this.connection.withTransaction(ctx, async txCtx => {
            const order = await this.lockOrder(txCtx, id);
            if (['DRAFT', 'CANCELLED'].includes(order.status)) {
                throw new UserInputError('当前采购单不能标记付款争议');
            }
            order.paymentStatus = 'DISPUTED';
            await this.connection.getRepository(txCtx, PurchaseOrder).save(order);
            await this.appendEvent(txCtx, order.id, 'PAYMENT_DISPUTED', '付款状态已标记为争议', {
                note: reason,
            });
            return this.findOne(txCtx, order.id);
        });
    }

    async returnToSupplier(ctx: RequestContext, input: ReturnPurchaseOrderInput) {
        validateReturnInput(input);
        return this.connection.withTransaction(ctx, async txCtx => {
            const order = await this.lockOrder(txCtx, input.purchaseOrderId);
            const returnRepository = this.connection.getRepository(txCtx, PurchaseSupplierReturn);
            const idempotencyKey = input.idempotencyKey.trim();
            const existing = await returnRepository.findOne({
                where: { purchaseOrderId: order.id, idempotencyKey },
            });
            if (existing) return this.findOne(txCtx, order.id);
            if (['DRAFT', 'SUBMITTED', 'CANCELLED'].includes(order.status)) {
                throw new UserInputError('当前采购单没有可退回供货商的已验收库存');
            }
            const lines = await this.lockLines(txCtx, order.id);
            const byId = new Map(lines.map(line => [String(line.id), line]));
            const supplierReturn = await returnRepository.save(
                new PurchaseSupplierReturn({
                    purchaseOrderId: order.id,
                    code: `RTS-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${randomUUID().slice(0, 8).toUpperCase()}`,
                    idempotencyKey,
                    supplierAcknowledgementReference: requiredText(
                        input.supplierAcknowledgementReference,
                        120,
                        '供货商退货确认号',
                    ),
                    returnedAt: nullableDate(input.returnedAt, '退供时间') ?? new Date(),
                    returnedByUserId: actorId(txCtx),
                    notes: optionalText(input.notes, 10_000),
                }),
            );
            let creditMicrounits = 0;
            const returnLines: PurchaseSupplierReturnLine[] = [];
            for (const returned of input.lines) {
                const line = byId.get(String(returned.purchaseOrderLineId));
                if (!line) throw new UserInputError('退供行不属于该采购单');
                if (line.acceptedQuantity - line.returnedQuantity < returned.quantity) {
                    throw new UserInputError(
                        `SKU ${String(line.variantId)} 退供数量超过该采购单剩余可退的验收合格数量`,
                    );
                }
                const lot = await this.getInventoryLot(txCtx, returned.inventoryLotId);
                if (
                    String(lot.variantId) !== String(line.variantId) ||
                    String(lot.stockLocationId) !== String(order.stockLocationId)
                ) {
                    throw new UserInputError('退供批次与采购 SKU 或收货仓库不一致');
                }
                const receiptEvidence = await this.connection
                    .getRepository(txCtx, PurchaseReceiptLine)
                    .exists({
                        where: {
                            purchaseOrderLineId: line.id,
                            inventoryLotId: lot.id,
                        },
                    });
                if (!receiptEvidence) throw new UserInputError('该批次没有与采购行匹配的收货证据');
                if (lot.quantityOnHand < returned.quantity) {
                    throw new UserInputError(`批次 ${lot.lotCode} 当前库存不足，无法退供`);
                }
                const unitCost = Number(line.unitCostMicrounits);
                const creditedQuantity = calculateReturnCreditQuantity(
                    line.orderedQuantity,
                    line.acceptedQuantity,
                    line.returnedQuantity,
                    returned.quantity,
                );
                const lineCreditMicrounits = unitCost * creditedQuantity;
                creditMicrounits += lineCreditMicrounits;
                assertSafeMoney(creditMicrounits, '累计退供贷项');
                await this.operations.changeLotQuantity(txCtx, {
                    id: lot.id,
                    productVariantId: lot.variantId,
                    stockLocationId: lot.stockLocationId,
                    lotCode: lot.lotCode,
                    manufacturedAt: lot.manufacturedAt,
                    expiresAt: lot.expiresAt,
                    quantityDelta: -returned.quantity,
                    purchaseCostMicrounits:
                        lot.purchaseCostMicrounits == null ? null : Number(lot.purchaseCostMicrounits),
                    currencyCode: lot.currencyCode,
                });
                line.returnedQuantity += returned.quantity;
                returnLines.push(
                    new PurchaseSupplierReturnLine({
                        supplierReturnId: supplierReturn.id,
                        purchaseOrderLineId: line.id,
                        inventoryLotId: lot.id,
                        quantity: returned.quantity,
                        unitCostMicrounits: String(unitCost),
                        creditMicrounits: String(lineCreditMicrounits),
                        reason: requiredText(returned.reason, 500, '退供原因'),
                    }),
                );
            }
            await this.connection.getRepository(txCtx, PurchaseSupplierReturnLine).save(returnLines);
            await this.connection.getRepository(txCtx, PurchaseOrderLine).save(lines);
            order.returnCreditMicrounits = String(Number(order.returnCreditMicrounits) + creditMicrounits);
            const paid = Number(order.paidMicrounits);
            order.paymentStatus = derivePurchasePaymentStatus(
                Number(order.totalMicrounits),
                Number(order.returnCreditMicrounits),
                paid,
            );
            await this.connection.getRepository(txCtx, PurchaseOrder).save(order);
            await this.appendEvent(
                txCtx,
                order.id,
                'RETURNED_TO_SUPPLIER',
                `退供单 ${supplierReturn.code} 已入账`,
                {
                    supplierReturnId: String(supplierReturn.id),
                    quantity: returnLines.reduce((sum, line) => sum + line.quantity, 0),
                    creditMicrounits,
                    paymentStatus: order.paymentStatus,
                },
            );
            return this.findOne(txCtx, order.id);
        });
    }

    async supplierPerformance(ctx: RequestContext, supplierId: ID, from?: Date | string, to?: Date | string) {
        await this.suppliers.findOne(ctx, supplierId);
        const start = nullableDate(from, '开始日期');
        const end = nullableDate(to, '结束日期');
        if (start && end && start > end) throw new UserInputError('开始日期不能晚于结束日期');
        const query = this.connection
            .getRepository(ctx, PurchaseOrder)
            .createQueryBuilder('purchaseOrder')
            .leftJoinAndSelect('purchaseOrder.lines', 'line')
            .leftJoinAndSelect('purchaseOrder.receipts', 'receipt')
            .where('purchaseOrder.channelId = :channelId', { channelId: ctx.channelId })
            .andWhere('purchaseOrder.supplierId = :supplierId', { supplierId })
            .andWhere("purchaseOrder.status NOT IN ('DRAFT', 'CANCELLED')");
        if (start) query.andWhere('purchaseOrder.createdAt >= :start', { start });
        if (end) query.andWhere('purchaseOrder.createdAt <= :end', { end });
        const orders = await query.getMany();
        const orderedQuantity = sumLines(orders, line => line.orderedQuantity);
        const acceptedQuantity = sumLines(orders, line => line.acceptedQuantity);
        const rejectedQuantity = sumLines(orders, line => line.rejectedQuantity);
        const returnedQuantity = sumLines(orders, line => line.returnedQuantity);
        const settledOrders = orders.filter(order =>
            ['RECEIVED', 'VARIANCE_REVIEW', 'CLOSED'].includes(order.status),
        );
        const deliveryScoreOrders = orders.filter(
            order =>
                order.expectedAt &&
                (settledOrders.includes(order) || order.expectedAt.getTime() < Date.now()),
        );
        const onTimeOrders = deliveryScoreOrders.filter(order => {
            if (!settledOrders.includes(order) || !order.receipts.length) return false;
            const completedAt = order.receipts.reduce(
                (latest, receipt) => Math.max(latest, receipt.receivedAt.getTime()),
                0,
            );
            return completedAt <= (order.expectedAt?.getTime() ?? 0);
        }).length;
        const varianceOrders = settledOrders.filter(order =>
            order.lines.some(
                line => line.receivedQuantity !== line.orderedQuantity || line.rejectedQuantity > 0,
            ),
        ).length;
        const disputeOrders = orders.filter(order => order.paymentStatus === 'DISPUTED').length;
        const onTimeRate = rate(onTimeOrders, deliveryScoreOrders.length);
        const acceptanceRate = rate(
            Math.max(0, acceptedQuantity - returnedQuantity),
            acceptedQuantity + rejectedQuantity,
        );
        const varianceFreeRate = rate(settledOrders.length - varianceOrders, settledOrders.length);
        const disputeFreeRate = rate(orders.length - disputeOrders, orders.length);
        const score = weightedScore([
            [onTimeRate, 0.4],
            [acceptanceRate, 0.35],
            [varianceFreeRate, 0.15],
            [disputeFreeRate, 0.1],
        ]);
        return {
            supplierId: String(supplierId),
            from: start,
            to: end,
            totalOrders: orders.length,
            closedOrders: orders.filter(order => order.status === 'CLOSED').length,
            orderedQuantity,
            acceptedQuantity,
            rejectedQuantity,
            returnedQuantity,
            varianceOrders,
            disputeOrders,
            onTimeRate,
            acceptanceRate,
            varianceFreeRate,
            disputeFreeRate,
            score,
        };
    }

    private async transition(
        ctx: RequestContext,
        id: ID,
        allowed: PurchaseOrderStatus[],
        status: PurchaseOrderStatus,
        summary: string,
        mutate?: (order: PurchaseOrder) => void,
    ) {
        return this.connection.withTransaction(ctx, async txCtx => {
            const order = await this.lockOrder(txCtx, id);
            if (!allowed.includes(order.status))
                throw new UserInputError(`采购单当前状态 ${order.status} 不允许该操作`);
            order.status = status;
            mutate?.(order);
            await this.connection.getRepository(txCtx, PurchaseOrder).save(order);
            await this.appendEvent(txCtx, order.id, status, summary, null);
            return this.findOne(txCtx, order.id);
        });
    }

    private async lockOrder(ctx: RequestContext, id: ID): Promise<PurchaseOrder> {
        const repository = this.connection.getRepository(ctx, PurchaseOrder);
        const query = repository
            .createQueryBuilder('purchaseOrder')
            .where('purchaseOrder.id = :id', { id })
            .andWhere('purchaseOrder.channelId = :channelId', { channelId: ctx.channelId });
        if (
            supportsLocks(repository.manager.connection.options.type) &&
            repository.manager.queryRunner?.isTransactionActive
        ) {
            query.setLock('pessimistic_write');
        }
        const order = await query.getOne();
        if (!order) throw new UserInputError('采购单不存在或不属于当前门店');
        return order;
    }

    private async lockLines(ctx: RequestContext, purchaseOrderId: ID): Promise<PurchaseOrderLine[]> {
        const repository = this.connection.getRepository(ctx, PurchaseOrderLine);
        const query = repository
            .createQueryBuilder('line')
            .where('line.purchaseOrderId = :purchaseOrderId', { purchaseOrderId })
            .orderBy('line.id', 'ASC');
        if (
            supportsLocks(repository.manager.connection.options.type) &&
            repository.manager.queryRunner?.isTransactionActive
        ) {
            query.setLock('pessimistic_write');
        }
        return query.getMany();
    }

    private async getInventoryLot(ctx: RequestContext, id: ID): Promise<InventoryLot> {
        const repository = this.connection.getRepository(ctx, InventoryLot);
        const lot = await repository.findOne({ where: { id } });
        if (!lot) throw new UserInputError('退供批次不存在');
        return lot;
    }

    private async appendEvent(
        ctx: RequestContext,
        purchaseOrderId: ID,
        type: string,
        summary: string,
        details: Record<string, string | number | boolean | null> | null,
    ) {
        await this.connection.getRepository(ctx, PurchaseOrderEvent).save(
            new PurchaseOrderEvent({
                purchaseOrderId,
                type,
                actorUserId: actorId(ctx),
                summary,
                details,
            }),
        );
    }

    private async availableCode(ctx: RequestContext, requested?: string | null): Promise<string> {
        const repository = this.connection.getRepository(ctx, PurchaseOrder);
        if (requested?.trim()) {
            const code = requiredText(requested, 64, '采购单号').toUpperCase();
            if (await repository.exists({ where: { channelId: ctx.channelId, code } })) {
                throw new UserInputError('当前门店已存在相同采购单号');
            }
            return code;
        }
        for (let attempt = 0; attempt < 5; attempt++) {
            const code = `PO-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${randomUUID().slice(0, 8).toUpperCase()}`;
            if (!(await repository.exists({ where: { channelId: ctx.channelId, code } }))) return code;
        }
        throw new UserInputError('无法生成唯一采购单号，请重试');
    }
}

export function deriveReceiptStatus(
    lines: Array<Pick<PurchaseOrderLine, 'orderedQuantity' | 'receivedQuantity' | 'rejectedQuantity'>>,
): PurchaseOrderStatus {
    const hasReceipt = lines.some(line => line.receivedQuantity > 0);
    const complete = lines.every(line => line.receivedQuantity >= line.orderedQuantity);
    if (!complete) return hasReceipt ? 'PARTIALLY_RECEIVED' : 'SUBMITTED';
    const hasVariance = lines.some(
        line => line.receivedQuantity !== line.orderedQuantity || line.rejectedQuantity > 0,
    );
    return hasVariance ? 'VARIANCE_REVIEW' : 'RECEIVED';
}

export function derivePurchasePaymentStatus(
    totalMicrounits: number,
    returnCreditMicrounits: number,
    paidMicrounits: number,
): PurchaseOrder['paymentStatus'] {
    const netPayable = Math.max(0, totalMicrounits - returnCreditMicrounits);
    if (paidMicrounits > netPayable) return 'DISPUTED';
    if (paidMicrounits === netPayable) return 'PAID';
    return paidMicrounits > 0 ? 'PARTIALLY_PAID' : 'UNPAID';
}

export function calculateReturnCreditQuantity(
    orderedQuantity: number,
    acceptedQuantity: number,
    alreadyReturnedQuantity: number,
    returnQuantity: number,
): number {
    const overageRemaining = Math.max(0, acceptedQuantity - orderedQuantity - alreadyReturnedQuantity);
    return Math.max(0, returnQuantity - overageRemaining);
}

function purchaseOrderView(order: PurchaseOrder, inventoryLots: InventoryLot[] = []) {
    const lines = order.lines ?? [];
    const now = Date.now();
    const receiptLotIdsByLine = new Map<string, Set<string>>();
    for (const receipt of order.receipts ?? []) {
        for (const receiptLine of receipt.lines ?? []) {
            if (!receiptLine.inventoryLotId || receiptLine.acceptedQuantity <= 0) continue;
            const key = String(receiptLine.purchaseOrderLineId);
            const lotIds = receiptLotIdsByLine.get(key) ?? new Set<string>();
            lotIds.add(String(receiptLine.inventoryLotId));
            receiptLotIdsByLine.set(key, lotIds);
        }
    }
    return {
        ...order,
        totalMicrounits: Number(order.totalMicrounits),
        paidMicrounits: Number(order.paidMicrounits),
        returnCreditMicrounits: Number(order.returnCreditMicrounits),
        outstandingMicrounits: Math.max(
            0,
            Number(order.totalMicrounits) -
                Number(order.returnCreditMicrounits) -
                Number(order.paidMicrounits),
        ),
        overdue:
            Boolean(order.expectedAt) &&
            (order.expectedAt?.getTime() ?? Number.MAX_SAFE_INTEGER) < now &&
            ['SUBMITTED', 'PARTIALLY_RECEIVED'].includes(order.status),
        hasVariance: lines.some(
            line => line.receivedQuantity > line.orderedQuantity || line.rejectedQuantity > 0,
        ),
        lines: lines.map(line => ({
            ...line,
            unitCostMicrounits: Number(line.unitCostMicrounits),
            outstandingQuantity: Math.max(0, line.orderedQuantity - line.receivedQuantity),
            returnableQuantity: Math.max(0, line.acceptedQuantity - line.returnedQuantity),
            returnableLots: inventoryLots
                .filter(
                    lot =>
                        String(lot.variantId) === String(line.variantId) &&
                        lot.quantityOnHand > 0 &&
                        receiptLotIdsByLine.get(String(line.id))?.has(String(lot.id)),
                )
                .map(lot => ({
                    id: String(lot.id),
                    lotCode: lot.lotCode,
                    quantityOnHand: lot.quantityOnHand,
                    expiresAt: lot.expiresAt,
                })),
        })),
        receipts: (order.receipts ?? []).map(receipt => ({
            ...receipt,
            lines: (receipt.lines ?? []).map(line => ({
                ...line,
                unitCostMicrounits: Number(line.unitCostMicrounits),
            })),
        })),
        supplierReturns: (order.supplierReturns ?? []).map(supplierReturn => ({
            ...supplierReturn,
            lines: (supplierReturn.lines ?? []).map(line => ({
                ...line,
                unitCostMicrounits: Number(line.unitCostMicrounits),
                creditMicrounits: Number(line.creditMicrounits),
            })),
        })),
    };
}

function validateCreateInput(input: CreatePurchaseOrderInput) {
    if (!input.lines.length) throw new UserInputError('采购单至少需要一个 SKU');
    if (input.lines.length > 500) throw new UserInputError('单张采购单最多 500 个 SKU');
    for (const line of input.lines) {
        if (!Number.isSafeInteger(line.orderedQuantity) || line.orderedQuantity <= 0) {
            throw new UserInputError('采购数量必须是正整数');
        }
        assertSafeMoney(line.unitCostMicrounits, '采购单价');
    }
}

function validateReceiptInput(input: ReceivePurchaseOrderInput) {
    requiredText(input.idempotencyKey, 80, '收货幂等键');
    if (!input.lines.length) throw new UserInputError('收货单至少需要一行');
    if (input.lines.length > 500) throw new UserInputError('单次收货最多 500 行');
}

function validateReturnInput(input: ReturnPurchaseOrderInput) {
    requiredText(input.idempotencyKey, 80, '退供幂等键');
    requiredText(input.supplierAcknowledgementReference, 120, '供货商退货确认号');
    if (!input.lines.length) throw new UserInputError('退供单至少需要一行');
    if (input.lines.length > 500) throw new UserInputError('单次退供最多 500 行');
    const keys = input.lines.map(
        line => `${String(line.purchaseOrderLineId)}:${String(line.inventoryLotId)}`,
    );
    if (new Set(keys).size !== keys.length) throw new UserInputError('同一采购行和批次不能重复退供');
    for (const line of input.lines) {
        if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0) {
            throw new UserInputError('退供数量必须是正整数');
        }
        requiredText(line.reason, 500, '退供原因');
    }
}

function validateReceivedLine(line: ReceivePurchaseOrderInput['lines'][number]) {
    for (const [label, value] of [
        ['到货数量', line.receivedQuantity],
        ['验收合格数量', line.acceptedQuantity],
        ['验收不合格数量', line.rejectedQuantity],
    ] as const) {
        if (!Number.isSafeInteger(value) || value < 0) throw new UserInputError(`${label}必须是非负整数`);
    }
    if (line.receivedQuantity <= 0) throw new UserInputError('到货数量必须大于 0');
    if (line.acceptedQuantity + line.rejectedQuantity !== line.receivedQuantity) {
        throw new UserInputError('验收合格与不合格数量之和必须等于到货数量');
    }
}

function validateStatus(value: string): PurchaseOrderStatus {
    const statuses: PurchaseOrderStatus[] = [
        'DRAFT',
        'SUBMITTED',
        'PARTIALLY_RECEIVED',
        'RECEIVED',
        'VARIANCE_REVIEW',
        'CLOSED',
        'CANCELLED',
    ];
    if (!statuses.includes(value as PurchaseOrderStatus)) throw new UserInputError('无效采购单状态');
    return value as PurchaseOrderStatus;
}

function actorId(ctx: RequestContext): string | null {
    return ctx.activeUserId == null ? null : String(ctx.activeUserId);
}

function nullableDate(value: Date | string | null | undefined, label: string): Date | null {
    if (value == null || value === '') return null;
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) throw new UserInputError(`${label}格式不正确`);
    return date;
}

function optionalText(value: unknown, maxLength: number): string | null {
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') return null;
    const text = String(value).trim();
    if (!text) return null;
    return text.slice(0, maxLength);
}

function requiredText(value: unknown, maxLength: number, label: string): string {
    const text = optionalText(value, maxLength);
    if (!text) throw new UserInputError(`${label}不能为空`);
    return text;
}

function positiveNumber(value: unknown): number | null {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : null;
}

function assertSafeMoney(value: number, label: string): void {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new UserInputError(`${label}必须是非负整数千分之一货币单位`);
    }
}

function supportsLocks(type: string): boolean {
    return !['sqlite', 'better-sqlite3', 'sqljs'].includes(type);
}

function sumLines(orders: PurchaseOrder[], selector: (line: PurchaseOrderLine) => number): number {
    return orders.reduce(
        (total, order) => total + order.lines.reduce((lineTotal, line) => lineTotal + selector(line), 0),
        0,
    );
}

function rate(numerator: number, denominator: number): number | null {
    return denominator <= 0 ? null : round2((numerator / denominator) * 100);
}

function round2(value: number): number {
    return Math.round(value * 100) / 100;
}

export function weightedScore(metrics: Array<[number | null, number]>): number | null {
    const available = metrics.filter((metric): metric is [number, number] => metric[0] != null);
    const totalWeight = available.reduce((sum, [, weight]) => sum + weight, 0);
    if (totalWeight <= 0) return null;
    return round2(available.reduce((sum, [value, weight]) => sum + value * weight, 0) / totalWeight);
}
