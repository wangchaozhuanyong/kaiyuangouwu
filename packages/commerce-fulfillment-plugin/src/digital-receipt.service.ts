import { Injectable } from '@nestjs/common';
import {
    EventBus,
    ID,
    Order,
    RequestContext,
    TransactionalConnection,
    UserInputError,
    assertOrderSalesChannel,
} from '@vendure/core';
import { In } from 'typeorm';

import { AutoCardService } from './auto-card.service';
import { DigitalDeliveryTokenService, normalizeDigitalDeliveryHost } from './digital-delivery-token.service';
import { DigitalDeliveryService } from './digital-delivery.service';
import { DigitalFileService } from './digital-file.service';
import { digitalDeliverableQuantity } from './digital-order-entitlement';
import { DigitalProductService } from './digital-product.service';
import { AutoCardDelivery } from './entities/auto-card-delivery.entity';
import { AutoCardPoolItem } from './entities/auto-card-pool-item.entity';
import { DigitalReceiptAccess } from './entities/digital-product.entity';
import { ManualDigitalDelivery } from './entities/manual-digital-delivery.entity';
import { getOrderLineDigitalDeliveryMode, getOrderLineFulfillmentType } from './fulfillment-classification';
import { ManualDigitalDeliveryService } from './manual-digital-delivery.service';
import { OrderConfirmationTokenService } from './order-confirmation-token.service';
import { OrderProcessingChangedEvent } from './order-processing-changed.event';
import { type ProcessingFileCandidate } from './order-processing-projection';

@Injectable()
export class DigitalReceiptService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly cards: AutoCardService,
        private readonly manual: ManualDigitalDeliveryService,
        private readonly downloads: DigitalDeliveryService,
        private readonly products: DigitalProductService,
        private readonly tokens: OrderConfirmationTokenService,
        private readonly events: EventBus,
        private readonly files: DigitalFileService,
        private readonly fileTokens: DigitalDeliveryTokenService,
    ) {}

    private async ownedOrder(ctx: RequestContext, id: ID, token?: string) {
        const order = await this.connection.getEntityOrThrow(ctx, Order, id, {
            relations: [
                'customer',
                'customer.user',
                'lines',
                'lines.productVariant',
                'payments',
                'payments.refunds',
                'payments.refunds.lines',
            ],
        });
        assertOrderSalesChannel(ctx, order);
        const proof = token ? this.tokens.verifyToken(token) : undefined;
        if (
            !(ctx.activeUserId && String(order.customer?.user?.id) === String(ctx.activeUserId)) &&
            !(proof && proof.orderId === String(order.id) && proof.channelId === String(ctx.channelId))
        ) {
            throw new UserInputError('无权查看该订单的数字交付内容');
        }
        return order;
    }

    /** A read only returns metadata. Email scanners and refreshes never claim or decrypt content. */
    async myDigitalDeliveryContents(ctx: RequestContext, id: ID, token?: string) {
        return this.statuses(ctx, await this.ownedOrder(ctx, id, token));
    }

    async statuses(ctx: RequestContext, order: Order) {
        return (await this.statusesForOrders(ctx, [order])).get(String(order.id)) ?? [];
    }

    processingFileAvailability(candidates: ProcessingFileCandidate[]) {
        return this.downloads.processingFileAvailability(candidates);
    }

    /** Metadata only, bounded queries for a page; encrypted content never leaves the database. */
    async statusesForOrders(ctx: RequestContext, orders: Order[]) {
        orders.forEach(order => assertOrderSalesChannel(ctx, order));
        const lines = orders.flatMap(order =>
            order.lines.filter(line => getOrderLineFulfillmentType(line) === 'digital'),
        );
        const result = new Map<
            string,
            Array<{
                orderLineId: ID;
                mode: ReturnType<typeof getOrderLineDigitalDeliveryMode>;
                state: 'UNAVAILABLE' | 'READY' | 'WAITING';
                eligibleQuantity: number;
                readyQuantity: number;
                claimedQuantity: number;
                notificationState: string;
                instructions: string;
                packages: never[];
                downloadUrl: null;
            }>
        >();
        if (!lines.length) return result;
        const lineIds = lines.map(line => line.id);
        const [cards, manual, access, downloads] = await Promise.all([
            this.connection.getRepository(ctx, AutoCardDelivery).find({
                where: { channelId: ctx.channelId, orderLineId: In(lineIds) },
                select: ['id', 'orderLineId', 'state', 'quantity'],
            }),
            this.connection
                .getRepository(ctx, ManualDigitalDelivery)
                .createQueryBuilder('manual')
                .select('manual.orderLineId', 'orderLineId')
                .addSelect('manual.state', 'state')
                .addSelect('manual.quantity', 'quantity')
                .addSelect(
                    "CASE WHEN manual.encryptedPackages IS NOT NULL AND manual.encryptedPackages <> '' THEN 1 ELSE 0 END",
                    'hasPackages',
                )
                .where('manual.channelId = :channelId AND manual.orderLineId IN (:...lineIds)', {
                    channelId: ctx.channelId,
                    lineIds,
                })
                .getRawMany<{
                    orderLineId: ID;
                    state: string;
                    quantity: number;
                    hasPackages: number | string;
                }>(),
            this.connection.getRepository(ctx, DigitalReceiptAccess).find({
                where: { channelId: ctx.channelId, orderLineId: In(lineIds) },
                select: ['orderLineId', 'claimedQuantity'],
            }),
            this.downloads.metadataForOrders(ctx, orders),
        ]);
        const quantities = cards.length
            ? await this.connection
                  .getRepository(ctx, AutoCardPoolItem)
                  .createQueryBuilder('pool')
                  .select('pool.deliveryId', 'deliveryId')
                  .addSelect('COUNT(*)', 'quantity')
                  .innerJoin(
                      AutoCardDelivery,
                      'poolDelivery',
                      'poolDelivery.id = pool.deliveryId AND poolDelivery.channelId = :channelId',
                      { channelId: ctx.channelId },
                  )
                  .where('pool.deliveryId IN (:...deliveryIds) AND pool.state = :state', {
                      deliveryIds: cards.map(card => card.id),
                      state: 'ASSIGNED',
                  })
                  .groupBy('pool.deliveryId')
                  .getRawMany<{ deliveryId: ID; quantity: number | string }>()
            : [];
        const cardByLine = new Map(cards.map(item => [String(item.orderLineId), item]));
        const manualByLine = new Map(manual.map(item => [String(item.orderLineId), item]));
        const accessByLine = new Map(access.map(item => [String(item.orderLineId), item.claimedQuantity]));
        const cardQuantities = new Map(
            quantities.map(item => [String(item.deliveryId), Number(item.quantity)]),
        );
        for (const order of orders)
            result.set(
                String(order.id),
                order.lines
                    .filter(line => getOrderLineFulfillmentType(line) === 'digital')
                    .map(line => {
                        const mode = getOrderLineDigitalDeliveryMode(line);
                        const card = mode === 'auto_card' ? cardByLine.get(String(line.id)) : undefined;
                        const task =
                            mode === 'manual_service' ? manualByLine.get(String(line.id)) : undefined;
                        const entitled = digitalDeliverableQuantity(order, line);
                        const cardQuantity = card ? (cardQuantities.get(String(card.id)) ?? 0) : 0;
                        const ready =
                            mode === 'file_download'
                                ? (downloads
                                      .get(String(order.id))
                                      ?.some(
                                          item =>
                                              item.orderLineId === String(line.id) && item.status === 'READY',
                                      ) ?? false)
                                : card
                                  ? cardQuantity > 0
                                  : Boolean(
                                        Number(task?.hasPackages) &&
                                        ['SENDING', 'SENT', 'EMAIL_FAILED', 'MANUAL_REVIEW'].includes(
                                            task?.state ?? '',
                                        ),
                                    );
                        return {
                            orderLineId: line.id,
                            mode,
                            state: !entitled
                                ? ('UNAVAILABLE' as const)
                                : ready && (card ? cardQuantity : (task?.quantity ?? line.quantity)) > 0
                                  ? ('READY' as const)
                                  : ('WAITING' as const),
                            eligibleQuantity: entitled,
                            readyQuantity: ready
                                ? Math.min(entitled, card ? cardQuantity : (task?.quantity ?? line.quantity))
                                : 0,
                            claimedQuantity: accessByLine.get(String(line.id)) ?? 0,
                            notificationState: card?.state ?? task?.state ?? 'NOT_REQUIRED',
                            instructions: '',
                            packages: [],
                            downloadUrl: null,
                        };
                    }),
            );
        return result;
    }

    /** Explicit POST mutation, idempotent access audit, followed by current entitlement validation. */
    async claimDigitalDelivery(ctx: RequestContext, id: ID, lineId: ID, token?: string) {
        return this.connection.withTransaction(
            ctx,
            async ctxValue => {
                await this.ownedOrder(ctxValue, id, token);
                await this.products.lock(ctxValue, Order, id);
                const order = await this.ownedOrder(ctxValue, id, token);
                const line = order.lines.find(
                    item =>
                        String(item.id) === String(lineId) && getOrderLineFulfillmentType(item) === 'digital',
                );
                if (!line) throw new UserInputError('该订单没有此数字商品');
                const status = (await this.statuses(ctxValue, order)).find(
                    item => String(item.orderLineId) === String(line.id),
                );
                if (!status || status.state !== 'READY')
                    throw new UserInputError('该商品尚未准备好、正在退款或已停止交付');
                let content = {
                    ...status,
                    packages: [] as Array<{
                        number: number;
                        note: string;
                        fields: Array<{ label: string; value: string }>;
                        attachments: Array<{ name: string; downloadUrl: string }>;
                    }>,
                    downloadUrl: null as string | null,
                };
                if (status.mode === 'file_download') {
                    const download = (await this.downloads.deliveriesForOrder(ctxValue, String(id))).find(
                        item => item.orderLineId === String(lineId),
                    );
                    content.downloadUrl = download?.downloadUrl ?? null;
                } else if (status.mode === 'auto_card') {
                    const delivery = await this.connection
                        .getRepository(ctxValue, AutoCardDelivery)
                        .findOneOrFail({ where: { channelId: ctxValue.channelId, orderLineId: line.id } });
                    const payload = await this.cards.emailPayload(ctxValue, delivery.id);
                    content = {
                        ...content,
                        instructions: payload.instructions,
                        packages: payload.credentials.map(item => ({
                            number: item.number,
                            note: '',
                            attachments: [],
                            fields: item.fields.map(field => ({ label: field.label, value: field.value })),
                        })),
                    };
                } else {
                    const delivery = await this.connection
                        .getRepository(ctxValue, ManualDigitalDelivery)
                        .findOneOrFail({ where: { channelId: ctxValue.channelId, orderLineId: line.id } });
                    const payload = await this.manual.emailPayload(ctxValue, delivery.id);
                    const host = normalizeDigitalDeliveryHost(
                        ctxValue.req?.headers?.['x-forwarded-host'] ?? ctxValue.req?.headers?.host,
                    );
                    content.packages = await Promise.all(
                        payload.packages.map(async item => {
                            const attachments = [] as Array<{ name: string; downloadUrl: string }>;
                            for (const version of item.attachmentFileVersionIds ?? []) {
                                const resource = await this.files.resource(ctxValue.channelId, version);
                                if (!resource || !host)
                                    throw new UserInputError('交付附件尚不可用，请联系商家处理');
                                const signed = this.fileTokens.createToken({
                                    orderId: String(id),
                                    orderLineId: String(lineId),
                                    channelId: String(ctxValue.channelId),
                                    host,
                                    sku: line.productVariant.sku,
                                    fileVersionId: version,
                                    manualDeliveryId: String(delivery.id),
                                });
                                attachments.push({
                                    name: resource.downloadName,
                                    downloadUrl: `/digital-delivery/${encodeURIComponent(signed.token)}`,
                                });
                            }
                            return {
                                number: item.number,
                                note: item.note,
                                fields: item.fields.map(field => ({
                                    label: field.label,
                                    value: field.value,
                                })),
                                attachments,
                            };
                        }),
                    );
                }
                const repository = this.connection.getRepository(ctxValue, DigitalReceiptAccess);
                const previous = await repository.findOne({
                    where: { channelId: ctxValue.channelId, orderLineId: line.id },
                });
                if (!previous || previous.claimedQuantity < status.readyQuantity)
                    await repository.save(
                        new DigitalReceiptAccess({
                            ...previous,
                            channelId: ctxValue.channelId,
                            orderId: id,
                            orderLineId: line.id,
                            claimedQuantity: status.readyQuantity,
                            actorId: ctxValue.activeUserId ? String(ctxValue.activeUserId) : null,
                        }),
                    );
                await this.events.publish(new OrderProcessingChangedEvent(ctxValue, String(id)));
                return {
                    ...content,
                    claimedQuantity: Math.max(previous?.claimedQuantity ?? 0, status.readyQuantity),
                };
            },
            ['mysql', 'mariadb'].includes(this.connection.rawConnection.options.type)
                ? 'READ COMMITTED'
                : undefined,
        );
    }
}
