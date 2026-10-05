import { Injectable, Optional } from '@nestjs/common';
import {
    assertOrderSalesChannel,
    Order,
    OrderLine,
    RequestContext,
    TransactionalConnection,
} from '@vendure/core';

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
    ) {}

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
        const resource = payload.fileVersionId
            ? await this.files?.resource(payload.channelId, payload.fileVersionId)
            : this.tokens.resourceForSku(payload.channelId, payload.sku);
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
        const resource = reservation?.fileVersionId
            ? await this.files?.resource(channelId, reservation.fileVersionId)
            : this.tokens.resourceForSku(channelId, line.productVariant.sku);
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
