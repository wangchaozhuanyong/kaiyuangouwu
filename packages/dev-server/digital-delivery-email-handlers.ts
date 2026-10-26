import {
    AutoCardDeliveryReadyEvent,
    AutoCardService,
    ManualDigitalDeliveryReadyEvent,
    ManualDigitalDeliveryService,
} from '@vendure/commerce-fulfillment-plugin';
import { Injector, RequestContext } from '@vendure/core';
import { EmailEventListener } from '@vendure/email-plugin';

/** Shared by production and the local API-to-SMTP acceptance test. */
export function createDigitalDeliveryEmailHandlers(
    storefrontUrlForChannel: (ctx: RequestContext, injector: Injector) => Promise<string>,
) {
    const autoCardDeliveryEmailHandler = new EmailEventListener('auto-card-delivery')
        .on(AutoCardDeliveryReadyEvent)
        .loadData(async ({ event, injector }) => {
            const data = await injector.get(AutoCardService).notificationPayload(event.ctx, event.deliveryId);
            const storefrontUrl = await storefrontUrlForChannel(event.ctx, injector);
            return { ...data, receiptUrl: `${storefrontUrl}${data.receiptPath}` };
        })
        .setRecipient(event => event.data.recipientEmail)
        .setFrom('{{ fromAddress }}')
        .setSubject(event =>
            event.data.isChinese ? '您购买的数字商品可以领取了' : 'Your digital item is ready to claim',
        )
        .setTemplateVars(event => event.data)
        .setMetadata(event => ({
            type: 'auto-card-delivery',
            deliveryId: event.data.deliveryId,
        }));

    const manualDigitalDeliveryEmailHandler = new EmailEventListener('manual-digital-delivery')
        .on(ManualDigitalDeliveryReadyEvent)
        .loadData(async ({ event, injector }) => {
            const data = await injector
                .get(ManualDigitalDeliveryService)
                .notificationPayload(event.ctx, event.deliveryId);
            const storefrontUrl = await storefrontUrlForChannel(event.ctx, injector);
            return { ...data, receiptUrl: `${storefrontUrl}${data.receiptPath}` };
        })
        .setRecipient(event => event.data.recipientEmail)
        .setFrom('{{ fromAddress }}')
        .setSubject(event =>
            event.data.isChinese ? '您购买的数字商品可以领取了' : 'Your digital item is ready to claim',
        )
        .setTemplateVars(event => event.data)
        .setMetadata(event => ({
            type: 'manual-digital-delivery',
            deliveryId: event.data.deliveryId,
        }));

    return [autoCardDeliveryEmailHandler, manualDigitalDeliveryEmailHandler];
}
