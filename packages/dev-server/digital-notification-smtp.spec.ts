import { Channel, CurrencyCode, LanguageCode, RequestContext } from '@vendure/core';
import { FileBasedTemplateLoader } from '@vendure/email-plugin';
import { simpleParser } from 'mailparser';
import assert from 'node:assert/strict';
import { createServer, Socket } from 'node:net';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
    AutoCardService,
    ManualDigitalDeliveryService,
    OrderConfirmationTokenService,
} from '../commerce-fulfillment-plugin/src';
import { EmailProcessor } from '../email-plugin/src/email-processor';

import { emailLanguageVariables } from './email-localization';
import { createManualDeliveryEmailGuard } from './manual-delivery-email-guard';
// A real local SMTP protocol sink. No external recipient, credentials or customer content.
const messages: string[] = [];
const sockets = new Set<Socket>();
let rejectRecipient = false;
const smtp = createServer(socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.write('220 local-order-closure ESMTP\r\n');
    let buffer = '';
    let data: string[] | null = null;
    socket.on('data', chunk => {
        buffer += chunk.toString();
        let end: number;
        while ((end = buffer.indexOf('\r\n')) >= 0) {
            const line = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            if (data) {
                if (line === '.') {
                    messages.push(data.join('\r\n'));
                    data = null;
                    socket.write('250 queued locally\r\n');
                } else data.push(line.replace(/^\.\./, '.'));
            } else if (/^(EHLO|HELO)/i.test(line)) socket.write('250 local-order-closure\r\n');
            else if (/^RCPT/i.test(line))
                socket.write(
                    rejectRecipient ? '450 synthetic recipient unavailable\r\n' : '250 accepted\r\n',
                );
            else if (/^DATA$/i.test(line)) {
                data = [];
                socket.write('354 End with dot\r\n');
            } else if (/^QUIT$/i.test(line)) {
                socket.end('221 goodbye\r\n');
            } else socket.write('250 OK\r\n');
        }
    });
});
let port: number;
beforeAll(async () => {
    await new Promise<void>(resolve => smtp.listen(0, '127.0.0.1', resolve));
    port = (
        smtp.address() as {
            port: number;
        }
    ).port;
});
afterAll(async () => {
    sockets.forEach(socket => socket.destroy());
    await new Promise<void>(resolve => smtp.close(() => resolve()));
});
async function fixture(type: string, language: string) {
    const ctx = new RequestContext({
        apiType: 'admin',
        channel: new Channel({
            id: 1,
            code: 'synthetic-smtp-store',
            defaultLanguageCode: LanguageCode.zh_Hans,
            defaultCurrencyCode: CurrencyCode.CNY,
        }),
        isAuthorized: true,
        authorizedAsOwnerOnly: false,
    });
    let revoked = false;
    const current = {
        orderId: '1',
        orderCode: 'SYNTHETIC-SMTP',
        recipientEmail: 'synthetic-recipient@example.invalid',
    };
    const moduleRef = {
        get: (token: unknown) => {
            if (token === OrderConfirmationTokenService)
                return { verifyToken: () => ({ orderId: '1', channelId: '1' }) };
            if (token === ManualDigitalDeliveryService || token === AutoCardService)
                return {
                    queuedEmailPayload: () => {
                        return Promise.resolve().then(() => {
                            if (revoked) throw new Error('Synthetic revoked entitlement');
                            return current;
                        });
                    },
                    notificationPayload: () => {
                        return Promise.resolve().then(() => {
                            if (revoked) throw new Error('Synthetic revoked entitlement');
                            return current;
                        });
                    },
                };
            throw new Error('Unexpected SMTP fixture dependency');
        },
    };
    const events: any[] = [];
    const processor = new EmailProcessor(
        {
            transport: { type: 'smtp', host: '127.0.0.1', port, secure: false, ignoreTLS: true },
            templateLoader: new FileBasedTemplateLoader(path.join(__dirname, 'email-templates')),
            beforeSend: createManualDeliveryEmailGuard(() => Promise.resolve('https://shop.example.invalid')),
        } as any,
        moduleRef as any,
        {
            publish: (event: unknown) => {
                return Promise.resolve().then(() => {
                    events.push(event);
                });
            },
        } as any,
    );
    await processor.init();
    const email: any = {
        ctx: ctx.serialize(),
        type,
        templateFile: 'body.hbs',
        from: 'synthetic-sender@example.invalid',
        recipient: current.recipientEmail,
        subject: 'Synthetic safe notification',
        attachments: [],
        metadata: { type, deliveryId: 'delivery-1' },
        templateVars: {
            ...emailLanguageVariables(language, {
                storefrontNameZh: '本地测试店铺',
                storefrontNameEn: 'Local Test Store',
            }),
            deliveryId: 'delivery-1',
            orderCode: current.orderCode,
            productName: 'Synthetic digital item',
            receiptUrl:
                'https://shop.example.invalid/order-confirmation?id=SYNTHETIC-SMTP&token=synthetic-proof',
        },
    };
    return {
        processor,
        email,
        events,
        revoke: () => {
            revoked = true;
        },
    };
}
describe('digital notification rendered and transported over local SMTP', () => {
    it.each([
        ['manual-digital-delivery', 'zh_Hans'],
        ['auto-card-delivery', 'en'],
    ])('delivers %s as a safe %s link notification', async (type, language) => {
        const f = await fixture(type, language);
        const before = messages.length;
        await expect(f.processor.process(f.email)).resolves.toBe(true);
        expect(messages).toHaveLength(before + 1);
        const mime = await simpleParser(requireFixture(messages.at(-1)));
        expect(mime.to?.text).toBe(f.email.recipient);
        expect(mime.html).toContain('/order-confirmation');
        expect(mime.attachments).toHaveLength(0);
        expect(f.events.at(-1)).toMatchObject({ success: true, metadata: { deliveryId: 'delivery-1' } });
    });
    it('records SMTP failure and resends the original link after the transport recovers', async () => {
        const f = await fixture('manual-digital-delivery', 'zh_Hans');
        const before = messages.length;
        rejectRecipient = true;
        try {
            await expect(f.processor.process(f.email)).rejects.toThrow();
        } finally {
            rejectRecipient = false;
        }
        expect(messages).toHaveLength(before);
        expect(f.events.at(-1)).toMatchObject({ success: false });
        await expect(f.processor.process(f.email)).resolves.toBe(true);
        expect(messages).toHaveLength(before + 1);
        expect(f.events.at(-1)).toMatchObject({ success: true });
    });
    it.each(['revoked', 'legacy-plaintext'])(
        'blocks %s before SMTP even after successful template rendering',
        async reason => {
            const f = await fixture('auto-card-delivery', 'en');
            const before = messages.length;
            if (reason === 'revoked') f.revoke();
            else f.email.templateVars.credentials = [{ rawPayload: 'SYNTHETIC-PRIVATE-CONTENT' }];
            await expect(f.processor.process(f.email)).rejects.toThrow();
            expect(messages).toHaveLength(before);
            expect(f.events.at(-1)).toMatchObject({ success: false });
        },
    );
});

function requireFixture<T>(value: T | null | undefined): T {
    assert(value !== null && value !== undefined, 'Required synthetic fixture is missing');
    return value;
}
