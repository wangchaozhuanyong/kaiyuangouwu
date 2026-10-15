import { Injectable, Optional } from '@nestjs/common';
import {
    assertOrderSalesChannel,
    CatalogSupplySnapshot,
    Order,
    OrderLine,
    ProductVariant,
    RequestContext,
    TransactionalConnection,
} from '@vendure/core';
import { CatalogSyncSourceService } from '@vendure/store-management-plugin';
import { In } from 'typeorm';

import { AutoCardCipherService } from './auto-card-cipher.service';
import {
    DigitalDeliveryResource,
    DigitalDeliveryTokenPayload,
    DigitalDeliveryTokenService,
    normalizeDigitalDeliveryHost,
} from './digital-delivery-token.service';
import { DigitalFileService } from './digital-file.service';
import { digitalDeliverableQuantity } from './digital-order-entitlement';
import { DigitalProductService } from './digital-product.service';
import { DigitalOrderReservation } from './entities/digital-product.entity';
import { ManualDigitalDelivery } from './entities/manual-digital-delivery.entity';
import { isFileDownloadOrderLine } from './fulfillment-classification';
import { type ProcessingFileCandidate } from './order-processing-projection';

export type DigitalDeliveryStatus = 'READY' | 'PAYMENT_REQUIRED' | 'NOT_CONFIGURED' | 'FILE_MISSING';

export interface DigitalDeliveryItem {
    orderLineId: string;
    sku: string;
    name: string;
    status: DigitalDeliveryStatus;
    downloadUrl?: string;
    expiresAt?: Date;
}

export interface AuthorizedDigitalDownload {
    resource: DigitalDeliveryResource;
    payload: DigitalDeliveryTokenPayload;
}

@Injectable()
export class DigitalDeliveryService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly tokens: DigitalDeliveryTokenService,
        @Optional() private readonly digitalProducts?: DigitalProductService,
        @Optional() private readonly files?: DigitalFileService,
        @Optional() private readonly cipher?: AutoCardCipherService,
        @Optional() private readonly sources?: CatalogSyncSourceService,
    ) {}

    /** Same filesystem/path checks as downloads, once per unique source, without signing links. */
    async processingFileAvailability(
        candidates: ProcessingFileCandidate[],
    ): Promise<ProcessingFileCandidate[]> {
        if (!this.tokens.configured) return [];
        const byChannel = new Map<string, ProcessingFileCandidate[]>();
        const versions = candidates.flatMap(candidate =>
            candidate.fileVersionId ? [candidate.fileVersionId] : [],
        );
        const sourceRows =
            this.sources && versions.length
                ? await this.connection.rawConnection
                      .getRepository(CatalogSupplySnapshot)
                      .createQueryBuilder('snapshot')
                      .innerJoin(
                          DigitalOrderReservation,
                          'reservation',
                          'reservation.orderLineId = snapshot.orderLineId AND reservation.channelId = snapshot.channelId',
                      )
                      .innerJoin(ProductVariant, 'variant', 'variant.id = snapshot.productVariantId')
                      .select('snapshot.channelId', 'channelId')
                      .addSelect('snapshot.sourceChannelId', 'sourceChannelId')
                      .addSelect('reservation.fileVersionId', 'fileVersionId')
                      .addSelect('variant.sku', 'sku')
                      .distinct(true)
                      .where('snapshot.channelId IN (:...channels)', {
                          channels: [...new Set(candidates.map(c => c.channelId))],
                      })
                      .andWhere('reservation.fileVersionId IN (:...versions)', { versions })
                      .getRawMany<{
                          channelId: string;
                          sourceChannelId: string;
                          fileVersionId: string;
                          sku: string;
                      }>()
                : [];
        const sources = new Map(
            sourceRows.map(row => [
                `${row.channelId}:${row.fileVersionId}:${row.sku}`,
                String(row.sourceChannelId),
            ]),
        );
        for (const candidate of candidates) {
            const sourceId =
                sources.get(`${candidate.channelId}:${candidate.fileVersionId}:${candidate.sku}`) ??
                String(candidate.channelId);
            const rows = byChannel.get(sourceId) ?? [];
            rows.push(candidate);
            byChannel.set(sourceId, rows);
        }
        const ready: ProcessingFileCandidate[] = [];
        await Promise.all(
            [...byChannel].map(async ([channelId, rows]) => {
                const resources = await this.files?.resources(
                    channelId,
                    rows.flatMap(row => (row.fileVersionId == null ? [] : [row.fileVersionId])),
                );
                for (const row of rows) {
                    if (
                        row.fileVersionId != null
                            ? resources?.has(String(row.fileVersionId))
                            : this.tokens.resourceForSku(channelId, row.sku)
                    )
                        ready.push(row);
                }
            }),
        );
        return ready;
    }

    async deliveriesForOrder(
        ctx: RequestContext,
        orderId: string,
        options: { metadataOnly?: boolean } = {},
    ): Promise<DigitalDeliveryItem[]> {
        const order = await this.connection.getEntityOrThrow(ctx, Order, orderId, {
            relations: [
                'lines',
                'lines.productVariant',
                'lines.productVariant.translations',
                'payments',
                'payments.refunds',
                'payments.refunds.lines',
            ],
        });
        assertOrderSalesChannel(ctx, order);
        return Promise.all(
            order.lines
                .filter(line => isFileDownloadOrderLine(line))
                .map(line => this.deliveryForLine(ctx, order, line, options.metadataOnly === true)),
        );
    }

    /** Bulk read-only readiness for already scoped orders; never signs links or loads an order again. */
    async metadataForOrders(
        ctx: RequestContext,
        orders: Order[],
    ): Promise<Map<string, DigitalDeliveryItem[]>> {
        orders.forEach(order => assertOrderSalesChannel(ctx, order));
        const lines = orders.flatMap(order => order.lines.filter(isFileDownloadOrderLine));
        const result = new Map<string, DigitalDeliveryItem[]>();
        if (!lines.length) return result;
        const reservations = this.digitalProducts
            ? await this.connection.getRepository(ctx, DigitalOrderReservation).find({
                  where: { channelId: ctx.channelId, orderLineId: In(lines.map(line => line.id)) },
                  select: ['orderLineId', 'fileVersionId'],
              })
            : [];
        const byLine = new Map(reservations.map(item => [String(item.orderLineId), item]));
        const sourceChannels =
            (await this.sources?.historicalChannelsForLines(
                ctx.channelId,
                lines.map(line => line.id),
            )) ?? new Map<string, string | number>();
        const groups = new Map<string, Array<string | number>>();
        for (const item of reservations)
            if (item.fileVersionId) {
                const source = String(sourceChannels.get(String(item.orderLineId)) ?? ctx.channelId);
                groups.set(source, [...(groups.get(source) ?? []), item.fileVersionId]);
            }
        const resources = new Set<string>();
        for (const [source, ids] of groups) {
            const files = await this.files?.resources(source, ids);
            for (const id of files?.keys() ?? []) resources.add(`${source}:${id}`);
        }
        const skuResources = new Map<string, boolean>();
        for (const order of orders) {
            result.set(
                String(order.id),
                order.lines.filter(isFileDownloadOrderLine).map(line => {
                    const base = {
                        orderLineId: String(line.id),
                        sku: line.productVariant.sku,
                        name: digitalDeliveryName(ctx, line),
                    };
                    if (!this.hasDownloadEntitlement(order, line))
                        return { ...base, status: 'PAYMENT_REQUIRED' as const };
                    if (!this.tokens.configured) return { ...base, status: 'NOT_CONFIGURED' as const };
                    const reservation = byLine.get(String(line.id));
                    const sourceId = String(sourceChannels.get(String(line.id)) ?? ctx.channelId);
                    let ready: boolean;
                    if (reservation?.fileVersionId)
                        ready = resources.has(`${sourceId}:${reservation.fileVersionId}`);
                    else {
                        if (!skuResources.has(`${sourceId}:${base.sku}`))
                            skuResources.set(
                                `${sourceId}:${base.sku}`,
                                Boolean(this.tokens.resourceForSku(sourceId, base.sku)),
                            );
                        ready = skuResources.get(`${sourceId}:${base.sku}`) ?? false;
                    }
                    return { ...base, status: ready ? ('READY' as const) : ('FILE_MISSING' as const) };
                }),
            );
        }
        return result;
    }

    async authorizeDownload(
        token: string,
        requestHost: unknown,
    ): Promise<AuthorizedDigitalDownload | undefined> {
        const payload = this.tokens.verifyToken(token);
        if (!payload || normalizeDigitalDeliveryHost(requestHost) !== payload.host) {
            return;
        }
        const order = await this.connection.rawConnection.getRepository(Order).findOne({
            where: { id: payload.orderId },
            relations: [
                'lines',
                'lines.productVariant',
                'payments',
                'payments.refunds',
                'payments.refunds.lines',
            ],
        });
        if (!order || order.salesChannelId == null || String(order.salesChannelId) !== payload.channelId) {
            return;
        }
        const line = order.lines.find(item => String(item.id) === payload.orderLineId);
        if (!line) return;
        if (payload.manualDeliveryId) {
            const fileVersionId = payload.fileVersionId;
            if (
                !fileVersionId ||
                !this.cipher ||
                !this.hasDownloadEntitlement(order, line) ||
                line.customFields.digitalDeliveryModeSnapshot !== 'manual_service'
            )
                return;
            const manual = await this.connection.rawConnection.getRepository(ManualDigitalDelivery).findOne({
                where: {
                    id: payload.manualDeliveryId,
                    channelId: payload.channelId,
                    orderLineId: line.id,
                },
            });
            if (
                !manual?.encryptedPackages ||
                !['SENDING', 'SENT', 'EMAIL_FAILED', 'MANUAL_REVIEW'].includes(manual.state)
            )
                return;
            const packages = JSON.parse(
                this.cipher.decrypt(manual.encryptedPackages).payload ?? '[]',
            ) as Array<{ attachmentFileVersionIds?: string[] }>;
            if (
                !packages
                    .slice(0, digitalDeliverableQuantity(order, line))
                    .some(item => item.attachmentFileVersionIds?.includes(fileVersionId))
            )
                return;
            const attachmentResource = await this.files?.resource(payload.channelId, fileVersionId);
            return attachmentResource ? { resource: attachmentResource, payload } : undefined;
        }
        if (
            !line ||
            !this.hasDownloadEntitlement(order, line) ||
            !isFileDownloadOrderLine(line) ||
            (!payload.fileVersionId && line.productVariant.sku !== payload.sku)
        ) {
            return;
        }
        const reservation = this.digitalProducts
            ? await this.connection.rawConnection
                  .getRepository(DigitalOrderReservation)
                  .findOne({ where: { orderLineId: line.id, channelId: payload.channelId } })
            : null;
        if (payload.fileVersionId && String(reservation?.fileVersionId) !== payload.fileVersionId) return;
        const sourceChannelId =
            (await this.sources?.historicalChannelId(payload.channelId, line.id)) ?? payload.channelId;
        const resource = payload.fileVersionId
            ? await this.files?.resource(sourceChannelId, payload.fileVersionId)
            : this.tokens.resourceForSku(String(sourceChannelId), payload.sku);
        return resource ? { resource, payload } : undefined;
    }

    private async deliveryForLine(
        ctx: RequestContext,
        order: Order,
        line: OrderLine,
        metadataOnly = false,
    ): Promise<DigitalDeliveryItem> {
        const base = {
            orderLineId: String(line.id),
            sku: line.productVariant.sku,
            name: digitalDeliveryName(ctx, line),
        };
        if (!this.hasDownloadEntitlement(order, line)) {
            return { ...base, status: 'PAYMENT_REQUIRED' };
        }
        if (!this.tokens.configured) {
            return { ...base, status: 'NOT_CONFIGURED' };
        }
        const channelId = String(ctx.channelId);
        const reservation = await this.digitalProducts?.reservation(ctx, line.id);
        const sourceChannelId =
            (await this.sources?.historicalChannelId(ctx.channelId, line.id)) ?? channelId;
        const resource = reservation?.fileVersionId
            ? await this.files?.resource(sourceChannelId, reservation.fileVersionId)
            : this.tokens.resourceForSku(String(sourceChannelId), line.productVariant.sku);
        if (!resource) {
            return { ...base, status: 'FILE_MISSING' };
        }
        // Background reminders and fulfillment guards inspect the same file readiness without
        // an HTTP host, token creation, or customer access side effects.
        if (metadataOnly) return { ...base, status: 'READY' };
        const host = normalizeDigitalDeliveryHost(
            ctx.req?.headers?.['x-forwarded-host'] ?? ctx.req?.headers?.host,
        );
        if (!host) return { ...base, status: 'NOT_CONFIGURED' };
        const signed = this.tokens.createToken({
            orderId: String(order.id),
            orderLineId: String(line.id),
            channelId,
            host,
            sku: line.productVariant.sku,
            ...(reservation?.fileVersionId ? { fileVersionId: String(reservation.fileVersionId) } : {}),
        });
        return {
            ...base,
            status: 'READY',
            downloadUrl: `/digital-delivery/${encodeURIComponent(signed.token)}`,
            expiresAt: signed.expiresAt,
        };
    }

    private hasDownloadEntitlement(order: Order, line: OrderLine): boolean {
        return digitalDeliverableQuantity(order, line) > 0;
    }
}

function digitalDeliveryName(ctx: RequestContext, line: OrderLine): string {
    const variant = line.productVariant;
    const translations = variant.translations ?? [];
    const localizedName = translations
        .find(translation => translation.languageCode === ctx.languageCode)
        ?.name?.trim();
    const directName = variant.name?.trim();
    const translatedName = translations
        .map(translation => translation.name?.trim())
        .find((name): name is string => Boolean(name));
    return localizedName || directName || translatedName || variant.sku;
}
