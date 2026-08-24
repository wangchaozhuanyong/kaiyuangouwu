import { Injectable } from '@nestjs/common';
import { Order, OrderLine, RequestContext, TransactionalConnection } from '@vendure/core';

import {
    DigitalDeliveryResource,
    DigitalDeliveryTokenPayload,
    DigitalDeliveryTokenService,
} from './digital-delivery-token.service';
import { getOrderLineFulfillmentType, isAutoCardOrderLine } from './fulfillment-classification';

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
    ) {}

    async deliveriesForOrder(ctx: RequestContext, orderId: string): Promise<DigitalDeliveryItem[]> {
        const order = await this.connection.getEntityOrThrow(ctx, Order, orderId, {
            relations: ['lines', 'lines.productVariant', 'lines.productVariant.translations', 'payments'],
        });
        return order.lines
            .filter(line => getOrderLineFulfillmentType(line) === 'digital' && !isAutoCardOrderLine(line))
            .map(line => this.deliveryForLine(ctx, order, line));
    }

    async authorizeDownload(token: string): Promise<AuthorizedDigitalDownload | undefined> {
        const payload = this.tokens.verifyToken(token);
        if (!payload) {
            return;
        }
        const order = await this.connection.rawConnection.getRepository(Order).findOne({
            where: { id: payload.orderId },
            relations: ['lines', 'lines.productVariant', 'payments'],
        });
        if (!order || !this.isPaid(order)) {
            return;
        }
        const line = order.lines.find(item => String(item.id) === payload.orderLineId);
        if (
            !line ||
            getOrderLineFulfillmentType(line) !== 'digital' ||
            isAutoCardOrderLine(line) ||
            line.productVariant.sku !== payload.sku
        ) {
            return;
        }
        const resource = this.tokens.resourceForSku(payload.sku);
        return resource ? { resource, payload } : undefined;
    }

    private deliveryForLine(ctx: RequestContext, order: Order, line: OrderLine): DigitalDeliveryItem {
        const base = {
            orderLineId: String(line.id),
            sku: line.productVariant.sku,
            name: digitalDeliveryName(ctx, line),
        };
        if (!this.isPaid(order)) {
            return { ...base, status: 'PAYMENT_REQUIRED' };
        }
        if (!this.tokens.configured) {
            return { ...base, status: 'NOT_CONFIGURED' };
        }
        if (!this.tokens.resourceForSku(line.productVariant.sku)) {
            return { ...base, status: 'FILE_MISSING' };
        }
        const signed = this.tokens.createToken({
            orderId: String(order.id),
            orderLineId: String(line.id),
            sku: line.productVariant.sku,
        });
        return {
            ...base,
            status: 'READY',
            downloadUrl: `/digital-delivery/${encodeURIComponent(signed.token)}`,
            expiresAt: signed.expiresAt,
        };
    }

    private isPaid(order: Order): boolean {
        return (order.payments ?? []).some(payment => ['Authorized', 'Settled'].includes(payment.state));
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
