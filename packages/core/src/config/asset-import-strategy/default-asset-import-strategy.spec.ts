import { once } from 'node:events';
import { createServer, RequestListener } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DefaultAssetImportStrategy } from './default-asset-import-strategy';

async function withOrigin(handler: RequestListener, test: (origin: string) => Promise<void>) {
    const server = createServer(handler).listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing loopback server address');
    try {
        await test(`http://127.0.0.1:${address.port}`);
    } finally {
        server.closeAllConnections();
        await new Promise<void>(resolve => server.close(() => resolve()));
    }
}

describe('DefaultAssetImportStrategy remote transfer deadline', () => {
    afterEach(() => vi.restoreAllMocks());

    const strategy = new DefaultAssetImportStrategy({
        allowPrivateNetworks: true,
        retryDelayMs: 0,
        retryCount: 1,
    });

    it.each([false, true])('aborts a stalled socket with headers already sent: %s', async headersSent => {
        const controller = new AbortController();
        const deadline = vi.spyOn(AbortSignal, 'timeout').mockReturnValueOnce(controller.signal);
        let received!: () => void;
        const arrived = new Promise<void>(resolve => {
            received = resolve;
        });
        let closed!: () => void;
        const disconnected = new Promise<void>(resolve => {
            closed = resolve;
        });
        await withOrigin(
            (_request, response) => {
                response.once('close', closed);
                if (headersSent) response.write('partial body');
                received();
            },
            async origin => {
                const download = strategy.getStreamFromPath(`${origin}/image.png`);
                const checked = expect(
                    headersSent ? Promise.resolve(download).then(stream => stream.toArray()) : download,
                ).rejects.toThrow();
                await arrived;
                if (headersSent) await download;
                controller.abort();
                await checked;
                await disconnected;
                expect(deadline).toHaveBeenCalledWith(5_000);
            },
        );
    });

    it('closes a non-200 response and does not follow its redirect', async () => {
        const paths: Array<string | undefined> = [];
        let closed!: () => void;
        const disconnected = new Promise<void>(resolve => {
            closed = resolve;
        });
        await withOrigin(
            (request, response) => {
                paths.push(request.url);
                response.once('close', closed);
                response.writeHead(302, { Location: '/redirected.png' });
                response.write('partial body');
            },
            async origin => {
                await expect(strategy.getStreamFromPath(`${origin}/image.png`)).rejects.toThrow();
                await disconnected;
                expect(paths).toEqual(['/image.png']);
            },
        );
    });

    it('streams a complete response unchanged', async () => {
        await withOrigin(
            (_request, response) => response.end('bitmap-bytes'),
            async origin => {
                const stream = await strategy.getStreamFromPath(`${origin}/image.png`);
                expect(Buffer.concat(await stream.toArray()).toString()).toBe('bitmap-bytes');
            },
        );
    });
});
