import { S3Client } from '@aws-sdk/client-s3';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { PrivateImageObjectStore } from './private-image-object-store';

describe('private image storage with the real S3 SDK over loopback HTTP', () => {
    it('round-trips bytes, conditional writes, metadata, list and deletion through the SDK', async () => {
        const bytes = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#fff' } })
            .png()
            .toBuffer();
        const digest = createHash('sha256').update(bytes).digest('hex');
        const key = 'private/v1/reference/synthetic.png';
        let saved: Buffer | undefined;
        const requests: string[] = [];
        const headers: Array<IncomingMessage['headers']> = [];
        const handle = async (request: IncomingMessage, response: ServerResponse) => {
            const url = new URL(request.url ?? '/', 'http://fixture.invalid');
            requests.push(`${request.method} ${url.pathname}`);
            if (request.method === 'HEAD' && url.pathname === '/synthetic-images/') {
                response.writeHead(200).end();
                return;
            }
            if (request.method === 'PUT') {
                const chunks: Buffer[] = [];
                for await (const chunk of request) chunks.push(Buffer.from(chunk));
                if (saved) {
                    response.writeHead(412, { 'Content-Type': 'application/xml' });
                    response.end('<Error><Code>PreconditionFailed</Code></Error>');
                    return;
                }
                saved = Buffer.concat(chunks);
                // Keep only content-related headers; never collect authorization headers.
                headers.push({
                    'if-none-match': request.headers['if-none-match'],
                    'content-type': request.headers['content-type'],
                    'cache-control': request.headers['cache-control'],
                    'x-amz-meta-sha256': request.headers['x-amz-meta-sha256'],
                    'x-amz-server-side-encryption': request.headers['x-amz-server-side-encryption'],
                    'x-amz-acl': request.headers['x-amz-acl'],
                });
                response.writeHead(200).end();
                return;
            }
            if (request.method === 'GET' && url.searchParams.get('list-type') === '2') {
                expect(url.searchParams.get('prefix')).toBe('private/v1/');
                response.writeHead(200, { 'Content-Type': 'application/xml' });
                response.end(
                    '<ListBucketResult><IsTruncated>false</IsTruncated>' +
                        `<Contents><Key>${key}</Key><LastModified>2026-09-01T00:00:00Z</LastModified></Contents>` +
                        '</ListBucketResult>',
                );
                return;
            }
            if (request.method === 'DELETE') {
                saved = undefined;
                response.writeHead(204).end();
                return;
            }
            if (!saved) {
                response.writeHead(404).end();
                return;
            }
            response.writeHead(200, {
                'Content-Type': 'image/png',
                'Content-Length': saved.length,
                'x-amz-meta-sha256': digest,
            });
            response.end(request.method === 'HEAD' ? undefined : saved);
        };
        const server = createServer((request, response) => {
            void handle(request, response).catch(() => response.destroy());
        });
        server.listen(0, '127.0.0.1');
        await once(server, 'listening');
        const client = new S3Client({
            endpoint: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
            region: 'us-east-1',
            forcePathStyle: true,
            maxAttempts: 1,
            // Synthetic signing material for the loopback fixture, never an AWS identity.
            credentials: { accessKeyId: 'synthetic-id', secretAccessKey: 'synthetic-fixture-only' },
        });
        const storage = new PrivateImageObjectStore('synthetic-images', 'private/v1/', client);
        try {
            await storage.put(key, bytes);
            expect(saved).toEqual(bytes);
            expect(headers).toEqual([
                {
                    'if-none-match': '*',
                    'content-type': 'image/png',
                    'cache-control': 'private, no-store',
                    'x-amz-meta-sha256': digest,
                    'x-amz-server-side-encryption': 'AES256',
                    'x-amz-acl': undefined,
                },
            ]);
            await storage.put(key, bytes);
            expect(await storage.get(key)).toEqual(bytes);
            expect(await storage.has(key)).toBe(true);
            expect((await storage.list(20)).items).toEqual([
                { key, modifiedAt: new Date('2026-09-01T00:00:00Z') },
            ]);
            await storage.delete(key);
            expect(await storage.has(key)).toBe(false);
            expect(requests.filter(value => value === 'HEAD /synthetic-images/')).toHaveLength(1);
        } finally {
            storage.destroy();
            server.close();
            await once(server, 'close');
        }
    });
});
