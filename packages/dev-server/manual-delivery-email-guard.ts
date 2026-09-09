import { ManualDigitalDeliveryService } from '@vendure/commerce-fulfillment-plugin';
import { UserInputError } from '@vendure/core';
import { EmailPluginOptions } from '@vendure/email-plugin';
import path from 'node:path';

/** Queued email is a snapshot; check the current task and attachment grants at send time. */
export function createManualDeliveryEmailGuard(
    assetRoot: string,
): NonNullable<EmailPluginOptions['beforeSend']> {
    const root = path.resolve(assetRoot);
    return async (injector, ctx, email) => {
        if (email.type !== 'manual-digital-delivery') return;
        const id = email.metadata?.deliveryId;
        if (typeof id !== 'string' || email.templateVars?.deliveryId !== id) {
            throw new UserInputError('人工交付邮件任务标识无效');
        }
        const current = await injector.get(ManualDigitalDeliveryService).queuedEmailPayload(ctx, id);
        const expectedAttachments = current.attachments.map(attachment => {
            const resolved = path.resolve(root, attachment.source);
            if (resolved === root || !resolved.startsWith(`${root}${path.sep}`)) {
                throw new UserInputError('人工交付附件路径无效');
            }
            return { filename: attachment.filename, path: resolved };
        });
        const actualAttachments = email.attachments.map(attachment => ({
            filename: attachment.filename,
            path: typeof attachment.path === 'string' ? path.resolve(attachment.path) : null,
        }));
        if (
            email.recipient !== current.recipientEmail ||
            JSON.stringify(email.templateVars.packages) !== JSON.stringify(current.packages) ||
            JSON.stringify(actualAttachments) !== JSON.stringify(expectedAttachments) ||
            email.attachments.some(attachment => attachment.content != null)
        ) {
            throw new UserInputError('人工交付邮件快照已失效，需要重新核对任务');
        }
    };
}
