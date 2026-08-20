import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { DigitalDeliveryTokenService } from './digital-delivery-token.service';

const secret = '4ea7f8d3c91b6a205f74e8c1d9a3b6208f51d7c4a2e9630b';

describe('DigitalDeliveryTokenService', () => {
    it('creates short-lived signed tokens and rejects tampering or expiry', () => {
        const service = new DigitalDeliveryTokenService({
            signingSecret: secret,
            linkTtlSeconds: 60,
        });
        const signed = service.createToken(
            { orderId: '1', orderLineId: '2', sku: 'DIGITAL-001' },
            1_000_000,
        );

        expect(service.verifyToken(signed.token, 1_010_000)).toMatchObject({
            orderId: '1',
            orderLineId: '2',
            sku: 'DIGITAL-001',
        });
        expect(service.verifyToken(`${signed.token}x`, 1_010_000)).toBeUndefined();
        expect(service.verifyToken(signed.token, 1_061_000)).toBeUndefined();
    });

    it('resolves only SKU-named files inside the protected root directory', () => {
        const directory = mkdtempSync(path.join(tmpdir(), 'vendure-digital-delivery-'));
        writeFileSync(path.join(directory, 'DIGITAL-001.txt'), 'download content');
        const service = new DigitalDeliveryTokenService({
            rootDirectory: directory,
            signingSecret: secret,
        });

        expect(service.resourceForSku('DIGITAL-001')).toMatchObject({
            downloadName: 'DIGITAL-001.txt',
        });
        expect(service.resourceForSku('../private')).toBeUndefined();
        expect(service.resourceForSku('MISSING')).toBeUndefined();
    });

    it('stays disabled in production when no signing secret is configured', () => {
        const directory = mkdtempSync(path.join(tmpdir(), 'vendure-digital-disabled-'));
        expect(
            new DigitalDeliveryTokenService({ rootDirectory: directory, production: true }).configured,
        ).toBe(false);
    });
});
