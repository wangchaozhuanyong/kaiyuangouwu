import {
    AutoCardService,
    ManualDigitalDeliveryService,
    OrderConfirmationTokenService,
} from '@vendure/commerce-fulfillment-plugin';
import { Injector, RequestContext, UserInputError } from '@vendure/core';
import { EmailPluginOptions } from '@vendure/email-plugin';

/** Reject old queued plaintext and validate a revocable receipt entry immediately before transport. */
export function createManualDeliveryEmailGuard(
    storefrontUrlForChannel: (ctx: RequestContext, injector: Injector) => Promise<string>,
): NonNullable<EmailPluginOptions['beforeSend']> {
    return async (injector, ctx, email) => {
        if (!['manual-digital-delivery', 'auto-card-delivery'].includes(email.type)) return;
        const id = email.metadata?.deliveryId;
        const vars = email.templateVars;
        if (
            typeof id !== 'string' ||
            !vars ||
            vars.deliveryId !== id ||
            email.attachments.length ||
            email.cc ||
            email.bcc ||
            'packages' in vars ||
            'credentials' in vars ||
            'attachments' in vars
        ) {
            throw new UserInputError('数字交付通知必须使用领取入口，旧明文邮件已停止发送');
        }
        const current =
            email.type === 'manual-digital-delivery'
                ? await injector.get(ManualDigitalDeliveryService).queuedEmailPayload(ctx, id)
                : await injector.get(AutoCardService).notificationPayload(ctx, id);
        let receipt: URL;
        try {
            receipt = new URL(String(vars.receiptUrl));
        } catch {
            throw new UserInputError('数字交付通知领取入口无效，请重新发送');
        }
        const expected = new URL(await storefrontUrlForChannel(ctx, injector));
        const proof = injector
            .get(OrderConfirmationTokenService)
            .verifyToken(receipt.searchParams.get('token') ?? '');
        const validParameters =
            [...receipt.searchParams.keys()].every(key => ['id', 'token'].includes(key)) &&
            receipt.searchParams.getAll('id').length === 1 &&
            receipt.searchParams.getAll('token').length === 1;
        if (
            !['http:', 'https:'].includes(receipt.protocol) ||
            receipt.origin !== expected.origin ||
            receipt.username ||
            receipt.password ||
            receipt.hash ||
            !validParameters ||
            receipt.pathname !== '/order-confirmation' ||
            receipt.searchParams.get('id') !== current.orderCode ||
            !proof ||
            proof.orderId !== current.orderId ||
            proof.channelId !== String(ctx.channelId) ||
            email.recipient !== current.recipientEmail
        ) {
            throw new UserInputError('数字交付通知领取入口已失效，请重新发送');
        }
    };
}
