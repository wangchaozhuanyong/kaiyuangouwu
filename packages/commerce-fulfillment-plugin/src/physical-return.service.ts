import { Injectable } from '@nestjs/common';
import { InventoryLot, InventoryLotMovement } from '@vendure/catalog-management-plugin';
import {
    ID,
    Order,
    OrderLine,
    ProductVariant,
    RequestContext,
    Sale,
    StockLevel,
    StockMovementService,
    TransactionalConnection,
    UserInputError,
    assertOrderSalesChannel,
} from '@vendure/core';

import { DigitalProductService } from './digital-product.service';
import { AfterSalesRequest } from './entities/after-sales-request.entity';
import { PhysicalReturnReceipt } from './entities/physical-return-receipt.entity';

export interface ReceivePhysicalReturnInput {
    requestId: ID;
    orderLineId: ID;
    stockLocationId: ID;
    quantity: number;
    quality: 'GOOD' | 'DAMAGED' | 'EXPIRED';
    idempotencyKey: string;
}

/** Financial refunds do not call this service. Actual receipt and quality inspection are separate. */
@Injectable()
export class PhysicalReturnService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly locks: DigitalProductService,
        private readonly stock: StockMovementService,
    ) {}

    async receipts(ctx: RequestContext, requestId: ID) {
        const request = await this.connection.getEntityOrThrow(ctx, AfterSalesRequest, requestId);
        if (String(request.channelId) !== String(ctx.channelId))
            throw new UserInputError('售后工单不属于当前店铺');
        return this.connection
            .getRepository(ctx, PhysicalReturnReceipt)
            .find({ where: { channelId: ctx.channelId, requestId }, order: { createdAt: 'ASC' } });
    }

    async receive(ctx: RequestContext, input: ReceivePhysicalReturnInput) {
        if (
            !Number.isSafeInteger(input.quantity) ||
            input.quantity < 1 ||
            !['GOOD', 'DAMAGED', 'EXPIRED'].includes(input.quality) ||
            !/^[a-zA-Z0-9_-]{8,80}$/.test(input.idempotencyKey)
        )
            throw new UserInputError('退货验收数量、质量或操作标识无效');
        const request = await this.connection.getEntityOrThrow(ctx, AfterSalesRequest, input.requestId, {
            relations: ['items', 'order'],
        });
        if (
            String(request.channelId) !== String(ctx.channelId) ||
            request.type !== 'RETURN_AND_REFUND' ||
            !['APPROVED', 'COMPLETED'].includes(request.state)
        )
            throw new UserInputError('仅当前店铺已通过审核的实物退货工单可以验收');
        assertOrderSalesChannel(ctx, request.order);
        await this.locks.lock(ctx, Order, request.orderId);
        const lockedRequest = await this.locks.lock(ctx, AfterSalesRequest, request.id);
        if (!lockedRequest) throw new UserInputError('售后工单已变化，请重新核对');
        Object.assign(request, lockedRequest);
        assertOrderSalesChannel(ctx, request.order);
        const repository = this.connection.getRepository(ctx, PhysicalReturnReceipt);
        const previousQuery = repository
            .createQueryBuilder('receipt')
            .where('receipt.channelId = :channelId AND receipt.idempotencyKey = :key', {
                channelId: ctx.channelId,
                key: input.idempotencyKey,
            });
        if (
            repository.manager.queryRunner?.isTransactionActive &&
            !['sqljs', 'sqlite', 'better-sqlite3'].includes(repository.manager.connection.options.type)
        )
            previousQuery.setLock('pessimistic_write');
        const previous = await previousQuery.getOne();
        if (previous) {
            if (
                String(previous.requestId) !== String(input.requestId) ||
                String(previous.orderLineId) !== String(input.orderLineId) ||
                String(previous.stockLocationId) !== String(input.stockLocationId) ||
                previous.quantity !== input.quantity ||
                previous.quality !== input.quality
            )
                throw new UserInputError('同一验收操作不能修改内容');
            return previous;
        }
        // Historical receipts remain replayable. New workflow requests have one
        // receipt/inspection ledger, so the legacy writer must not restock them.
        if (
            String(request.channelId) !== String(ctx.channelId) ||
            request.type !== 'RETURN_AND_REFUND' ||
            !['APPROVED', 'COMPLETED'].includes(request.state) ||
            (request.returnStatus && request.returnStatus !== 'NOT_REQUIRED')
        ) {
            throw new UserInputError('请使用售后工单的统一退货签收和质检入口，历史验收记录仍可查看');
        }
        const item = request.items.find(
            requestItem =>
                String(requestItem.orderLineId) === String(input.orderLineId) &&
                requestItem.fulfillmentType === 'physical',
        );
        if (!item) throw new UserInputError('所选商品不属于该实物退货工单');
        const line = await this.connection.getEntityOrThrow(ctx, OrderLine, input.orderLineId);
        await this.connection.getEntityOrThrow(ctx, ProductVariant, line.productVariantId, {
            channelId: ctx.channelId,
        });
        let level = await this.connection.getRepository(ctx, StockLevel).findOne({
            where: { productVariantId: line.productVariantId, stockLocationId: input.stockLocationId },
            relations: ['stockLocation', 'stockLocation.channels'],
        });
        if (
            !level ||
            !level.stockLocation.channels.some(channel => String(channel.id) === String(ctx.channelId))
        )
            throw new UserInputError('验收仓库不属于当前店铺');
        level = await this.locks.lock(ctx, StockLevel, level.id);
        if (!level) throw new UserInputError('验收仓库库存已变化，请重新核对');
        const sales = await this.connection
            .getRepository(ctx, Sale)
            .find({ where: { orderLine: { id: line.id }, stockLocation: { id: input.stockLocationId } } });
        const receivedQuery = repository
            .createQueryBuilder('receipt')
            .where('receipt.channelId = :channelId AND receipt.orderLineId = :lineId', {
                channelId: ctx.channelId,
                lineId: line.id,
            });
        if (
            repository.manager.queryRunner?.isTransactionActive &&
            !['sqljs', 'sqlite', 'better-sqlite3'].includes(repository.manager.connection.options.type)
        )
            receivedQuery.setLock('pessimistic_write');
        const received = await receivedQuery.getMany();
        const requestReceived = received
            .filter(record => String(record.requestId) === String(request.id))
            .reduce((sum, record) => sum + record.quantity, 0);
        const sold = sales.reduce((sum, sale) => sum + Math.abs(sale.quantity), 0);
        const receivedAtLocation = received
            .filter(record => String(record.stockLocationId) === String(input.stockLocationId))
            .reduce((sum, record) => sum + record.quantity, 0);
        if (input.quantity + requestReceived > item.quantity || input.quantity + receivedAtLocation > sold)
            throw new UserInputError('验收数量超过实际已发货且尚未验收的数量');
        const receipt = await repository.save(
            new PhysicalReturnReceipt({
                ...input,
                channelId: ctx.channelId,
                orderId: request.orderId,
                state: 'RECORDED',
                actorId: ctx.activeUserId ? String(ctx.activeUserId) : null,
            }),
        );
        if (input.quality === 'GOOD') {
            const lots = this.connection.getRepository(ctx, InventoryLot);
            const hasLots = await lots.exists({
                where: { variantId: line.productVariantId, stockLocationId: input.stockLocationId },
            });
            const hasOriginalLot = await this.connection.getRepository(ctx, InventoryLotMovement).exists({
                where: {
                    orderLineId: line.id,
                    variantId: line.productVariantId,
                    stockLocationId: input.stockLocationId,
                    type: 'SALE',
                },
            });
            await this.stock.createCancellationsForOrderLines(ctx, [
                { orderLineId: line.id, quantity: input.quantity },
            ]);
            if (hasLots && !hasOriginalLot)
                await lots.save(
                    new InventoryLot({
                        variantId: line.productVariantId,
                        stockLocationId: input.stockLocationId,
                        lotCode: `RETURN-${String(receipt.id)}`,
                        quantityOnHand: input.quantity,
                        state: 'ACTIVE',
                        currencyCode: ctx.currencyCode,
                        manufacturedAt: null,
                        expiresAt: null,
                        purchaseCostMicrounits: null,
                    }),
                );
        } else {
            const lots = this.connection.getRepository(ctx, InventoryLot);
            const existing = await lots.find({
                where: { variantId: line.productVariantId, stockLocationId: input.stockLocationId },
            });
            if (!existing.length && level.stockOnHand > 0)
                await lots.save(
                    new InventoryLot({
                        variantId: line.productVariantId,
                        stockLocationId: input.stockLocationId,
                        lotCode: `LEGACY-${String(receipt.id)}`,
                        quantityOnHand: level.stockOnHand,
                        state: 'ACTIVE',
                        currencyCode: ctx.currencyCode,
                        manufacturedAt: null,
                        expiresAt: null,
                        purchaseCostMicrounits: null,
                    }),
                );
            await lots.save(
                new InventoryLot({
                    variantId: line.productVariantId,
                    stockLocationId: input.stockLocationId,
                    lotCode: `RETURN-${String(receipt.id)}`,
                    quantityOnHand: input.quantity,
                    state: input.quality === 'EXPIRED' ? 'EXPIRED' : 'VOID',
                    currencyCode: ctx.currencyCode,
                    manufacturedAt: null,
                    expiresAt: input.quality === 'EXPIRED' ? new Date() : null,
                    purchaseCostMicrounits: null,
                }),
            );
            await this.stock.adjustProductVariantStock(ctx, line.productVariantId, [
                { stockLocationId: input.stockLocationId, stockOnHand: level.stockOnHand + input.quantity },
            ]);
        }
        receipt.state = 'RECEIVED';
        return repository.save(receipt);
    }
}
