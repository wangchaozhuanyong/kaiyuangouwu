import { Inject, Injectable, Optional } from '@nestjs/common';
import {
    ActiveOrderService,
    Order,
    RelationPaths,
    RequestContext,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export interface OrderConfirmationTokenPayload {
    version: 1;
    orderId: string;
    channelId: string;
    expiresAt: number;
}

export interface OrderConfirmationTokenConfiguration {
    signingSecret?: string;
    tokenTtlSeconds?: number;
    emailTokenTtlSeconds?: number;
    production?: boolean;
}

export interface OrderConfirmationTokenResult {
    token: string;
    expiresAt: Date;
}

export const ORDER_CONFIRMATION_TOKEN_CONFIGURATION = 'ORDER_CONFIRMATION_TOKEN_CONFIGURATION';

const MINIMUM_SECRET_LENGTH = 32;
const DEFAULT_TOKEN_TTL_SECONDS = 2 * 60 * 60;
const DEFAULT_EMAIL_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;
const MAX_EMAIL_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
const MAXIMUM_TOKEN_LENGTH = 2048;
const MAXIMUM_ID_LENGTH = 128;

@Injectable()
export class OrderConfirmationTokenService {
    private readonly signingSecret: string;
    private readonly tokenTtlSeconds: number;
    private readonly emailTokenTtlSeconds: number;

    constructor(
        private readonly activeOrderService: ActiveOrderService,
        private readonly connection: TransactionalConnection,
        @Optional()
        @Inject(ORDER_CONFIRMATION_TOKEN_CONFIGURATION)
        configuration?: OrderConfirmationTokenConfiguration,
    ) {
        const production = configuration?.production ?? process.env.NODE_ENV === 'production';
        const configuredSecret = configuration?.signingSecret ?? process.env.ORDER_CONFIRMATION_TOKEN_SECRET;
        const normalizedSecret = configuredSecret?.trim() ?? '';
        if (production && !isAcceptableSecret(normalizedSecret)) {
            throw new Error(
                'ORDER_CONFIRMATION_TOKEN_SECRET must be a non-placeholder secret of at least 32 characters in production',
            );
        }
        this.signingSecret = isAcceptableSecret(normalizedSecret)
            ? normalizedSecret
            : randomBytes(32).toString('base64url');
        const configuredTtl = configuration?.tokenTtlSeconds ?? DEFAULT_TOKEN_TTL_SECONDS;
        this.tokenTtlSeconds = Number.isInteger(configuredTtl)
            ? Math.min(DEFAULT_TOKEN_TTL_SECONDS, Math.max(60, configuredTtl))
            : DEFAULT_TOKEN_TTL_SECONDS;
        const configuredEmailTtl =
            configuration?.emailTokenTtlSeconds ??
            Number(
                process.env.ORDER_CONFIRMATION_EMAIL_TOKEN_TTL_SECONDS ||
                    DEFAULT_EMAIL_TOKEN_TTL_SECONDS,
            );
        this.emailTokenTtlSeconds = Number.isInteger(configuredEmailTtl)
            ? Math.min(MAX_EMAIL_TOKEN_TTL_SECONDS, Math.max(60, configuredEmailTtl))
            : DEFAULT_EMAIL_TOKEN_TTL_SECONDS;
    }

    async createForActiveOrder(
        ctx: RequestContext,
        nowMilliseconds = Date.now(),
    ): Promise<OrderConfirmationTokenResult> {
        const order = await this.activeOrderService.getActiveOrder(ctx, undefined);
        if (!order || !order.active || order.state !== 'ArrangingPayment') {
            throw new UserInputError('No active order is ready for payment confirmation');
        }
        return this.issueToken(
            String(order.id),
            String(ctx.channelId),
            this.tokenTtlSeconds,
            nowMilliseconds,
        );
    }

    createForSettledOrder(
        ctx: RequestContext,
        order: Pick<Order, 'id' | 'state'>,
        nowMilliseconds = Date.now(),
    ): OrderConfirmationTokenResult {
        if (order.state !== 'PaymentSettled') {
            throw new UserInputError('Only settled orders can receive an email confirmation token');
        }
        return this.issueToken(
            String(order.id),
            String(ctx.channelId),
            this.emailTokenTtlSeconds,
            nowMilliseconds,
        );
    }

    private issueToken(
        orderId: string,
        channelId: string,
        ttlSeconds: number,
        nowMilliseconds: number,
    ): OrderConfirmationTokenResult {
        const payload: OrderConfirmationTokenPayload = {
            version: 1,
            orderId,
            channelId,
            expiresAt: Math.floor(nowMilliseconds / 1000) + ttlSeconds,
        };
        const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
        return {
            token: `${encodedPayload}.${this.signature(encodedPayload)}`,
            expiresAt: new Date(payload.expiresAt * 1000),
        };
    }

    async orderForToken(
        ctx: RequestContext,
        token: string,
        relations: RelationPaths<Order> = [],
        nowMilliseconds = Date.now(),
    ): Promise<Order | undefined> {
        const payload = this.verifyToken(token, nowMilliseconds);
        if (!payload || payload.channelId !== String(ctx.channelId)) {
            return;
        }
        return this.connection.findOneInChannel(ctx, Order, payload.orderId, ctx.channelId, {
            relations,
        });
    }

    verifyToken(token: string, nowMilliseconds = Date.now()): OrderConfirmationTokenPayload | undefined {
        if (!token || token.length > MAXIMUM_TOKEN_LENGTH) {
            return;
        }
        const [encodedPayload, suppliedSignature, extra] = token.split('.');
        if (!encodedPayload || !suppliedSignature || extra) {
            return;
        }
        const expectedSignature = this.signature(encodedPayload);
        const supplied = Buffer.from(suppliedSignature);
        const expected = Buffer.from(expectedSignature);
        if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
            return;
        }
        try {
            const payload = JSON.parse(
                Buffer.from(encodedPayload, 'base64url').toString('utf8'),
            ) as OrderConfirmationTokenPayload;
            if (
                payload.version !== 1 ||
                !isSafeId(payload.orderId) ||
                !isSafeId(payload.channelId) ||
                !Number.isInteger(payload.expiresAt) ||
                payload.expiresAt <= Math.floor(nowMilliseconds / 1000)
            ) {
                return;
            }
            return payload;
        } catch {
            return;
        }
    }

    private signature(encodedPayload: string): string {
        return createHmac('sha256', this.signingSecret)
            .update(`storefront-order-confirmation:v1:${encodedPayload}`)
            .digest('base64url');
    }
}

function isSafeId(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= MAXIMUM_ID_LENGTH;
}

function isAcceptableSecret(value: string): boolean {
    return (
        value.length >= MINIMUM_SECRET_LENGTH &&
        !/(?:replace|example|change[-_ ]?me|development|test[-_ ]?secret)/iu.test(value)
    );
}
