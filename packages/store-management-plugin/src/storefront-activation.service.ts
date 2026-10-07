import { Inject, Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { isControlledTestPaymentMethod } from '@vendure/common/lib/controlled-test-payment';
import type { PaymentInput } from '@vendure/common/lib/generated-shop-types';
import {
    ChannelService,
    ID,
    idsAreEqual,
    Order,
    OrderService,
    PaymentMethod,
    PaymentMethodService,
    RequestContext,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { StoreDomain } from '@vendure/store-domain-plugin';

import { StoreProfile } from './entities/store-profile.entity';
import { StorefrontUsdtPaymentIntent } from './entities/storefront-usdt-payment-intent.entity';
import { verifyUsdtPaymentProof } from './usdt/usdt-payment-proof';

export type StorefrontAccessMode = 'CLOSED' | 'PREVIEW' | 'LIVE';

export class StorefrontClosedError extends UserInputError {
    constructor() {
        super('店铺暂未开放');
        this.code = 'STOREFRONT_CLOSED';
        this.extensions.code = this.code;
    }
}

export interface OperationalStorefrontInput {
    isDefaultChannel: boolean;
    status: StoreProfile['status'] | null;
    isPublished: boolean;
    hasVerifiedPrimaryDomain: boolean;
    /** Ownership never grants public access; retained only for callers of the old input. */
    isPlatformOwned?: boolean;
}

export function storefrontAccessMode(input: OperationalStorefrontInput): StorefrontAccessMode {
    if (input.isDefaultChannel || !input.hasVerifiedPrimaryDomain) return 'CLOSED';
    if (input.status === 'ACTIVE') return 'LIVE';
    return input.status === 'DRAFT' && input.isPublished && input.hasVerifiedPrimaryDomain
        ? 'PREVIEW'
        : 'CLOSED';
}

export function isOperationalStorefront(input: OperationalStorefrontInput): boolean {
    return storefrontAccessMode(input) !== 'CLOSED';
}

const legacyDefaultChannelFields = new Set([
    'me',
    'activeCustomer',
    'myCustomerAvatar',
    'activeChannel',
    'order',
    'orderByCode',
    'orders',
    'storefrontOrderByConfirmationToken',
    'myDigitalDeliveryContents',
    'login',
    'authenticate',
    'logout',
    'verifyCustomerAccount',
    'refreshCustomerVerification',
    'requestPasswordReset',
    'resetPassword',
]);
const controlledTestMethodCode = 'controlled-test-payment-platform';

export function isExplicitControlledTestMethod(method: PaymentMethod): boolean {
    return (
        method.enabled === true &&
        method.code === controlledTestMethodCode &&
        method.handler?.code === 'controlled-test-payment-handler' &&
        method.checker?.code === 'controlled-test-payment-checker'
    );
}

@Injectable()
export class StorefrontActivationService implements OnApplicationBootstrap {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly channelService: ChannelService,
        @Inject(OrderService) private readonly orderService?: OrderService,
        @Inject(PaymentMethodService) private readonly paymentMethods?: PaymentMethodService,
    ) {}

    onApplicationBootstrap(): void {
        this.orderService?.registerCheckoutValidator(
            'storefront-preview-payment-boundary',
            async (ctx, order, input, source) => {
                try {
                    await this.assertOrderPaymentAllowed(ctx, order, input, source);
                    return {};
                } catch (error) {
                    if (!(error instanceof UserInputError)) throw error;
                    return { error: error.message };
                }
            },
        );
        // Quoting and creation share policy; historic settlement/refunds retain their handler.
        const paymentMethods = this.paymentMethods;
        if (!paymentMethods) return;
        paymentMethods.registerEligibilityFilter(
            'storefront-preview-payment-boundary',
            async (ctx, order, quotes) => {
                if (
                    order.salesChannelId == null ||
                    !idsAreEqual(order.salesChannelId, ctx.channelId) ||
                    this.hasPersistedTestPaymentIdentity(order)
                )
                    return [];
                const mode = await this.getAccessMode(ctx, order.salesChannelId);
                if (mode === 'LIVE') return quotes;
                if (mode === 'CLOSED') return [];
                const methods = await paymentMethods.getActivePaymentMethods(ctx);
                const codes = new Set(
                    methods.filter(isExplicitControlledTestMethod).map(method => method.code),
                );
                return quotes.filter(quote => codes.has(quote.code));
            },
        );
    }

    async getAccessMode(ctx: RequestContext, channelId: ID = ctx.channelId): Promise<StorefrontAccessMode> {
        const [channel, defaultChannel] = await Promise.all([
            this.channelService.findOne(ctx, channelId),
            this.channelService.getDefaultChannel(ctx),
        ]);
        if (!channel || idsAreEqual(channel.id, defaultChannel.id)) return 'CLOSED';
        const profile = await this.connection.getRepository(ctx, StoreProfile).findOne({
            where: { channelId },
            select: { id: true, status: true, isPublished: true },
        });
        if (!profile || !['DRAFT', 'ACTIVE'].includes(profile.status)) return 'CLOSED';
        if (profile.status === 'DRAFT' && !profile.isPublished) return 'CLOSED';
        const hasVerifiedPrimaryDomain = await this.connection.getRepository(ctx, StoreDomain).exists({
            where: { channelId, isPrimary: true, status: 'ACTIVE' },
        });
        return storefrontAccessMode({
            isDefaultChannel: false,
            status: profile.status,
            isPublished: profile.isPublished,
            hasVerifiedPrimaryDomain,
        });
    }

    async assertActive(ctx: RequestContext, fieldName?: string): Promise<void> {
        if (ctx.apiType !== 'shop') return;
        if ((await this.getAccessMode(ctx)) !== 'CLOSED') return;
        if (fieldName && legacyDefaultChannelFields.has(fieldName)) {
            const defaultChannel = await this.channelService.getDefaultChannel(ctx);
            if (idsAreEqual(ctx.channelId, defaultChannel.id)) return;
        }
        throw new StorefrontClosedError();
    }

    async assertNewRealPaymentAllowed(
        ctx: RequestContext,
        channelId: ID = ctx.channelId,
        order?: Pick<Order, 'payments'>,
    ): Promise<void> {
        if (order && this.hasPersistedTestPaymentIdentity(order)) {
            throw new UserInputError('模拟付款订单不能新增真实付款或补款，请重新建立正式订单');
        }
        if ((await this.getAccessMode(ctx, channelId)) !== 'LIVE') {
            throw new UserInputError('公开预览仅支持显式测试支付，当前店铺不能发起真实付款');
        }
    }

    async assertOrderPaymentAllowed(
        ctx: RequestContext,
        order: Order,
        input: PaymentInput,
        source: 'handler' | 'manual' = 'handler',
    ): Promise<void> {
        if (order.salesChannelId == null || !idsAreEqual(order.salesChannelId, ctx.channelId)) {
            throw new UserInputError('付款订单不属于当前店铺');
        }
        // A verified receipt attached to an issued intent is bookkeeping, not a new charge.
        // apiType and client-supplied test flags never provide this exception.
        if (source !== 'manual' && (await this.hasTrustedIssuedUsdtReceipt(ctx, order, input))) return;
        if (this.hasPersistedTestPaymentIdentity(order)) {
            throw new UserInputError('模拟付款订单不能再次付款或补款，请重新建立正式订单');
        }
        const mode = await this.getAccessMode(ctx, order.salesChannelId);
        if (mode === 'LIVE') return;
        if (mode === 'PREVIEW' && source !== 'manual') {
            const method = (await this.paymentMethods?.getActivePaymentMethods(ctx))?.find(
                configuredMethod => configuredMethod.code === input.method,
            );
            if (method && isExplicitControlledTestMethod(method)) return;
        }
        throw new UserInputError('公开预览仅支持显式测试支付，不能发起真实付款或补款');
    }

    private async hasTrustedIssuedUsdtReceipt(
        ctx: RequestContext,
        order: Order,
        input: PaymentInput,
    ): Promise<boolean> {
        if (input.method !== 'usdt-trc20') return false;
        const salesChannelId = order.salesChannelId;
        if (salesChannelId == null) return false;
        const proof = verifyUsdtPaymentProof(input.metadata?.proof);
        if (
            !proof ||
            proof.channelId !== String(order.salesChannelId) ||
            proof.orderId !== String(order.id) ||
            proof.fiatCurrencyCode !== String(order.currencyCode)
        )
            return false;
        const intent = await this.connection.getRepository(ctx, StorefrontUsdtPaymentIntent).findOne({
            where: {
                channelId: salesChannelId,
                orderId: order.id,
                quoteId: proof.quoteId,
                transactionId: proof.transactionId,
            },
            relations: { quote: true },
        });
        return Boolean(
            intent &&
            ['PENDING', 'EXPIRED', 'MANUAL_REVIEW'].includes(intent.status) &&
            intent.blockNumber != null &&
            intent.blockTimestamp &&
            intent.receivedUsdtAmount === proof.usdtAmount &&
            intent.expectedUsdtAmount === proof.usdtAmount &&
            intent.receivingAddressFingerprint === proof.receivingAddressFingerprint &&
            intent.quote?.fiatAmount === proof.fiatAmount &&
            String(intent.quote.fiatCurrencyCode) === proof.fiatCurrencyCode,
        );
    }

    private hasPersistedTestPaymentIdentity(order: Pick<Order, 'payments'>): boolean {
        // Persisted identity is permanent even for cancelled attempts. Client PaymentInput flags
        // never grant this identity; strict double confirmation is only for safe resource cleanup.
        return (order.payments ?? []).some(
            payment =>
                isControlledTestPaymentMethod(payment.method) ||
                payment.metadata?.public?.testPayment === true,
        );
    }
}
