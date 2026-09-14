import { createHmac } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { DigitalDeliveryTokenService } from './digital-delivery-token.service';

const secret = '4ea7f8d3c91b6a205f74e8c1d9a3b6208f51d7c4a2e9630b';
const fixtureRoot = path.resolve(process.cwd(), '../../reports/pending-migrations-20260913/fixtures');
const directories: string[] = [];
function temporaryDirectory(prefix: string): string {
    mkdirSync(fixtureRoot, { recursive: true });
    const directory = mkdtempSync(path.join(fixtureRoot, prefix));
    directories.push(directory);
    return directory;
}
afterEach(() =>
    directories.splice(0).forEach(directory => rmSync(directory, { recursive: true, force: true })),
);

describe('DigitalDeliveryTokenService', () => {
    it('creates short-lived signed tokens and rejects tampering or expiry', () => {
        const service = new DigitalDeliveryTokenService({
            signingSecret: secret,
            linkTtlSeconds: 60,
        });
        const signed = service.createToken(
            {
                orderId: '1',
                orderLineId: '2',
                channelId: 'channel-1',
                host: 'SHOP-A.TEST',
                sku: 'DIGITAL-001',
            },
            1_000_000,
        );

        expect(service.verifyToken(signed.token, 1_010_000)).toMatchObject({
            orderId: '1',
            orderLineId: '2',
            channelId: 'channel-1',
            host: 'shop-a.test',
            sku: 'DIGITAL-001',
        });
        expect(service.verifyToken(`${signed.token}x`, 1_010_000)).toBeUndefined();
        expect(service.verifyToken(signed.token, 1_061_000)).toBeUndefined();
    });

    it('resolves only SKU-named files inside the protected root directory', () => {
        const directory = temporaryDirectory('vendure-digital-delivery-');
        mkdirSync(path.join(directory, 'channel-1'));
        writeFileSync(path.join(directory, 'channel-1', 'DIGITAL-001.txt'), 'download content');
        const service = new DigitalDeliveryTokenService({
            rootDirectory: directory,
            signingSecret: secret,
        });

        expect(service.resourceForSku('channel-1', 'DIGITAL-001')).toMatchObject({
            downloadName: 'DIGITAL-001.txt',
        });
        expect(service.resourceForSku('../private', 'DIGITAL-001')).toBeUndefined();
        expect(service.resourceForSku('channel-1', '../private')).toBeUndefined();
        expect(service.resourceForSku('channel-2', 'DIGITAL-001')).toBeUndefined();
        expect(service.resourceForSku('channel-1', 'MISSING')).toBeUndefined();
    });

    it('stays disabled in production when no signing secret is configured', () => {
        const directory = temporaryDirectory('vendure-digital-disabled-');
        expect(
            new DigitalDeliveryTokenService({ rootDirectory: directory, production: true }).configured,
        ).toBe(false);
    });

    it('rejects correctly signed legacy or malformed scope fields before returning a verified payload', () => {
        const service = new DigitalDeliveryTokenService({ signingSecret: secret });
        const valid = {
            orderId: '1',
            orderLineId: '2',
            channelId: 'a',
            host: 'a.example.invalid',
            sku: 'SKU',
            expiresAt: 1001,
        };
        for (const changed of [
            { channelId: undefined, host: undefined },
            { channelId: null },
            { channelId: 1 },
            { host: undefined },
            { host: [] },
            { sku: 123 },
            { orderId: ' ' },
            { orderLineId: 1 },
        ]) {
            const body = Buffer.from(JSON.stringify({ ...valid, ...changed })).toString('base64url');
            const signature = createHmac('sha256', secret).update(body).digest('base64url');
            expect(service.verifyToken(`${body}.${signature}`, 1_000_000)).toBeUndefined();
            expect(() => service.createToken({ ...valid, ...changed } as never, 1_000_000)).toThrow();
        }
    });

    it('rejects file, Channel and root symlinks instead of following them to another store', () => {
        const directory = temporaryDirectory('vendure-digital-symlinks-');
        mkdirSync(path.join(directory, 'a'));
        mkdirSync(path.join(directory, 'b'));
        writeFileSync(path.join(directory, 'b', 'SKU.txt'), 'store-b-only');
        symlinkSync(path.join(directory, 'b', 'SKU.txt'), path.join(directory, 'a', 'SKU.txt'));
        symlinkSync(path.join(directory, 'b'), path.join(directory, 'alias'));
        const service = new DigitalDeliveryTokenService({ rootDirectory: directory, signingSecret: secret });
        expect(service.resourceForSku('a', 'SKU')).toBeUndefined();
        expect(service.resourceForSku('alias', 'SKU')).toBeUndefined();
        expect(service.resourceForSku(undefined as never, 'SKU')).toBeUndefined();
        const rootAlias = path.join(directory, 'root-alias');
        symlinkSync(directory, rootAlias);
        const aliased = new DigitalDeliveryTokenService({ rootDirectory: rootAlias, signingSecret: secret });
        expect(aliased.resourceForSku('b', 'SKU')).toBeUndefined();
    });
});
