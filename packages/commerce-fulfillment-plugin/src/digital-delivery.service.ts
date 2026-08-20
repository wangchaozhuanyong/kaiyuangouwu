import { Injectable } from '@nestjs/common';
import { Order, OrderLine, RequestContext, TransactionalConnection } from '@vendure/core';

import { getOrderLineFulfillmentType } from './fulfillment-classification';
import {
    DigitalDeliveryResource,
    DigitalDeliveryTokenPayload,
    DigitalDeliveryTokenService,
} from './digital-delivery-token.service';

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
            relations: ['lines', 'lines.productVariant', 'payments'],
        });
        return order.lines
            .filter(line => getOrderLineFulfillmentType(line) === 'digital')
            .map(line => this.deliveryForLine(order, line));
    }

    async authorizeDownload(token: string): Promise<AuthorizedDigitalDownload | undefined> {
        const payload = this.tokens.verifyToken(token);
        if (!payload) {
            return;
        }
        const order = await this.connection.rawConnection.getRepository(Order).findOne({
            where: { id: payload.orderId as any },
            relations: ['lines', 'lines.productVariant', 'payments'],
        });
        if (!order || !this.isPaid(order)) {
            return;
        }
        const line = order.lines.find(item => String(item.id) === payload.orderLineId);
        if (
            !line ||
            getOrderLineFulfillmentType(line) !== 'digital' ||
            line.productVariant.sku !== payload.sku
        ) {
            return;
        }
        const resource = this.tokens.resourceForSku(payload.sku);
        return resource ? { resource, payload } : undefined;
    }

    private deliveryForLine(order: Order, line: OrderLine): DigitalDeliveryItem {
        const base = {
            orderLineId: String(line.id),
            sku: line.productVariant.sku,
            name: line.productVariant.name,
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
