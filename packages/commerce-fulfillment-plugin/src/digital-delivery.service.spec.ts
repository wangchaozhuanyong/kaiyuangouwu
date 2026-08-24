import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { DigitalDeliveryTokenService } from './digital-delivery-token.service';
import { DigitalDeliveryService } from './digital-delivery.service';

const secret = '4ea7f8d3c91b6a205f74e8c1d9a3b6208f51d7c4a2e9630b';

function digitalOrder(paymentState = 'Settled') {
    return {
        id: 'order-1',
        payments: paymentState ? [{ state: paymentState }] : [],
        lines: [
            {
                id: 'line-1',
                quantity: 1,
                customFields: {
                    fulfillmentTypeSnapshot: 'digital',
                    digitalDeliveryModeSnapshot: 'file_download',
                },
                productVariant: {
                    sku: 'DIGITAL-001',
                    name: 'Digital product',
                    customFields: {
                        fulfillmentType: 'digital',
                        digitalDeliveryMode: 'file_download',
                    },
                },
            },
        ],
    } as any;
}

function createService(order: any) {
    const directory = mkdtempSync(path.join(tmpdir(), 'vendure-digital-service-'));
    writeFileSync(path.join(directory, 'DIGITAL-001.txt'), 'secure content');
    const repository = { findOne: vi.fn().mockResolvedValue(order) };
    const connection = {
        getEntityOrThrow: vi.fn().mockResolvedValue(order),
        rawConnection: { getRepository: vi.fn().mockReturnValue(repository) },
    };
    const tokens = new DigitalDeliveryTokenService({
        rootDirectory: directory,
        signingSecret: secret,
        linkTtlSeconds: 60,
    });
    return { service: new DigitalDeliveryService(connection as any, tokens), repository };
}

describe('DigitalDeliveryService', () => {
    it('returns a signed link only after an authorized or settled payment', async () => {
        const paid = createService(digitalOrder('Settled'));
        const pending = createService(digitalOrder(''));

        await expect(paid.service.deliveriesForOrder({} as any, 'order-1')).resolves.toEqual([
            expect.objectContaining({
                orderLineId: 'line-1',
                sku: 'DIGITAL-001',
                status: 'READY',
                downloadUrl: expect.stringMatching(/^\/digital-delivery\//u),
            }),
        ]);
        const pendingDeliveries = await pending.service.deliveriesForOrder({} as any, 'order-1');
        expect(pendingDeliveries).toEqual([expect.objectContaining({ status: 'PAYMENT_REQUIRED' })]);
        expect(pendingDeliveries[0]).not.toHaveProperty('downloadUrl');
    });

    it('revalidates the order line and payment before authorizing a download', async () => {
        const { service } = createService(digitalOrder('Authorized'));
        const [delivery] = await service.deliveriesForOrder({} as any, 'order-1');
        const token = delivery?.downloadUrl?.split('/').at(-1);
        if (!token) {
            throw new Error('Expected a signed digital delivery token');
        }

        await expect(service.authorizeDownload(token)).resolves.toMatchObject({
            resource: { downloadName: 'DIGITAL-001.txt' },
            payload: { orderId: 'order-1', orderLineId: 'line-1', sku: 'DIGITAL-001' },
        });
        await expect(service.authorizeDownload(`${token}x`)).resolves.toBeUndefined();
    });

    it('returns a translated name or SKU when the raw variant name is unavailable', async () => {
        const order = digitalOrder('Settled');
        order.lines[0].productVariant.name = undefined;
        order.lines[0].productVariant.translations = [
            { languageCode: 'en', name: 'Translated digital product' },
        ];
        const { service } = createService(order);

        await expect(service.deliveriesForOrder({ languageCode: 'en' } as any, 'order-1')).resolves.toEqual([
            expect.objectContaining({ name: 'Translated digital product' }),
        ]);

        order.lines[0].productVariant.translations = [];
        await expect(service.deliveriesForOrder({ languageCode: 'en' } as any, 'order-1')).resolves.toEqual([
            expect.objectContaining({ name: 'DIGITAL-001' }),
        ]);
    });

    it('does not expose download links for manual services or auto-card products', async () => {
        const order = digitalOrder('Settled');
        const { service } = createService(order);

        order.lines[0].customFields.digitalDeliveryModeSnapshot = 'manual_service';
        await expect(service.deliveriesForOrder({} as any, 'order-1')).resolves.toEqual([]);

        order.lines[0].customFields.digitalDeliveryModeSnapshot = 'auto_card';
        await expect(service.deliveriesForOrder({} as any, 'order-1')).resolves.toEqual([]);
    });
});
