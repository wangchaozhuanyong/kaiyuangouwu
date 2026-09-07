import { ConfigService, ProcessContext } from '@vendure/core';
import { createHash } from 'crypto';
import express from 'express';
import fs from 'fs-extra';
import { Server } from 'http';
import os from 'os';
import path from 'path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AssetServer } from './asset-server';
import { ImageTransformStrategy } from './config/image-transform-strategy';
import { LocalAssetStorageStrategy } from './config/local-asset-storage-strategy';
import { PresetOnlyStrategy } from './config/preset-only-strategy';

vi.mock('@vendure/core', () => ({ Logger: { debug: vi.fn(), error: vi.fn() } }));

describe('SVG asset responses', () => {
    let root: string;
    let server: Server | undefined;
    let storage: LocalAssetStorageStrategy;
    let source: Buffer;

    beforeEach(async () => {
        root = await fs.mkdtemp(path.join(os.tmpdir(), 'vendure-svg-response-'));
        storage = new LocalAssetStorageStrategy(root);
        source = await fs.readFile(path.join(__dirname, '../e2e/fixtures/assets/test.svg'));
    });

    afterEach(async () => {
        if (server) {
            const current = server;
            current.closeAllConnections();
            await new Promise<void>((resolve, reject) =>
                current.close(error => (error ? reject(error) : resolve())),
            );
            server = undefined;
        }
        await fs.remove(root);
    });

    async function start(strategies: ImageTransformStrategy[] = []) {
        const assetServer = new AssetServer(
            { assetUploadDir: root, route: 'assets' },
            { assetOptions: { assetStorageStrategy: storage } } as ConfigService,
            { isWorker: false } as ProcessContext,
        );
        assetServer.onApplicationBootstrap();
        const app = express();
        app.use(
            '/assets',
            assetServer.createAssetServer({
                presets: [{ name: 'bounded', width: 96, height: 96, mode: 'resize' }],
                imageTransformStrategies: strategies,
            }),
        );
        server = await new Promise<Server>(resolve => {
            const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
        });
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('Missing test server address');
        return `http://127.0.0.1:${address.port}/assets`;
    }

    it.each(['icon.svg', '图标.SVG'])(
        'serves generated and cached %s with the raster MIME type',
        async name => {
            await storage.writeFileFromBuffer(`source/${name}`, source);
            const writes = vi.spyOn(storage, 'writeFileFromBuffer');
            const origin = await start([new PresetOnlyStrategy({ defaultPreset: 'bounded' })]);
            const url = `${origin}/source/${encodeURIComponent(name)}`;
            const first = await fetch(url);
            const firstBytes = Buffer.from(await first.arrayBuffer());
            expect(first.status).toBe(200);
            expect(first.headers.get('content-type')).toMatch(/^image\/png\b/);
            expect((await sharp(firstBytes).metadata()).format).toBe('png');
            expect((await sharp(firstBytes).metadata()).width).toBeLessThanOrEqual(96);
            const second = await fetch(url);
            expect(second.headers.get('content-type')).toMatch(/^image\/png\b/);
            expect(Buffer.from(await second.arrayBuffer())).toEqual(firstBytes);
            expect(writes).toHaveBeenCalledTimes(1);
            expect(writes.mock.calls[0][0]).toMatch(/\.png$/);
            expect(await storage.readFileToBuffer(`source/${name}`)).toEqual(source);
        },
    );

    it('does not reuse a legacy raster cache entry with an SVG extension', async () => {
        await storage.writeFileFromBuffer('source/icon.svg', source);
        const legacySuffix = createHash('md5').update('_transform_w96_h96_mresize').digest('hex');
        const legacyKey = `cache/source/icon${legacySuffix}.svg`;
        const legacyBytes = await sharp(source).resize(8, 8).png().toBuffer();
        await storage.writeFileFromBuffer(legacyKey, legacyBytes);
        const origin = await start([new PresetOnlyStrategy({ defaultPreset: 'bounded' })]);
        const response = await fetch(`${origin}/source/icon.svg`);
        const bytes = Buffer.from(await response.arrayBuffer());
        expect(response.headers.get('content-type')).toMatch(/^image\/png\b/);
        expect(bytes).not.toEqual(legacyBytes);
        expect(await storage.readFileToBuffer(legacyKey)).toEqual(legacyBytes);
    });

    it('preserves an untransformed SVG source and its MIME type', async () => {
        await storage.writeFileFromBuffer('source/icon.svg', source);
        const origin = await start();
        const response = await fetch(`${origin}/source/icon.svg`);
        expect(response.headers.get('content-type')).toMatch(/^image\/svg\+xml\b/);
        expect(Buffer.from(await response.arrayBuffer())).toEqual(source);
        expect(await fs.readdir(path.join(root, 'cache'))).toEqual([]);
    });

    it('retains an explicitly allowed output format', async () => {
        await storage.writeFileFromBuffer('source/icon.svg', source);
        const origin = await start([new PresetOnlyStrategy({ defaultPreset: 'bounded' })]);
        const response = await fetch(`${origin}/source/icon.svg?format=webp`);
        expect(response.headers.get('content-type')).toMatch(/^image\/webp\b/);
        expect((await sharp(Buffer.from(await response.arrayBuffer())).metadata()).format).toBe('webp');
    });

    it('uses PNG for quality-only SVG transformations', async () => {
        await storage.writeFileFromBuffer('source/icon.svg', source);
        const origin = await start();
        const response = await fetch(`${origin}/source/icon.svg?q=85`);
        expect(response.headers.get('content-type')).toMatch(/^image\/png\b/);
        expect((await sharp(Buffer.from(await response.arrayBuffer())).metadata()).format).toBe('png');
    });
});
