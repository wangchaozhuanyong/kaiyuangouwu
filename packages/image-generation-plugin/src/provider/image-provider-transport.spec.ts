import { execFileSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import dns from 'node:dns';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
import { type TLSSocket } from 'node:tls';
import { gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SafeProviderUrlService } from '../security/safe-provider-url.service';

import { pinnedProviderRequest, readResponseText } from './image-provider-io';
import { ImageProviderTransport } from './image-provider-transport';

describe('Pinned provider HTTP transport', () => {
    let server: Server;
    let url: URL;
    let hits: string[];
    beforeEach(async () => {
        hits = [];
        const handleRequest = async (request: IncomingMessage, response: ServerResponse) => {
            hits.push(request.url ?? '');
            if (request.url === '/redirect') {
                response.writeHead(302, { location: '/must-not-follow' }).end();
            } else if (request.url === '/slow') {
                response.writeHead(200).flushHeaders();
                response.write('partial');
            } else if (request.url === '/gzip') {
                response.writeHead(200, { 'content-encoding': 'gzip' }).end(gzipSync('decoded-response'));
            } else if (request.url === '/empty') {
                response.writeHead(204).end();
            } else {
                const chunks: Buffer[] = [];
                for await (const chunk of request) chunks.push(Buffer.from(chunk));
                response.end(
                    JSON.stringify({
                        host: request.headers.host,
                        contentType: request.headers['content-type'],
                        body: Buffer.concat(chunks).toString(),
                    }),
                );
            }
        };
        server = createServer((request, response) => void handleRequest(request, response));
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        const address = server.address();
        if (!address || typeof address === 'string') throw Error('Missing fixture address');
        url = new URL(`http://provider-pin.invalid:${address.port}/echo`);
        // A second system lookup would represent the changed DNS answer. Never allow it.
        vi.spyOn(dns, 'lookup').mockImplementation(() => {
            throw Error('Unexpected second DNS lookup');
        });
    });
    afterEach(async () => {
        vi.restoreAllMocks();
        server.closeAllConnections();
        await new Promise<void>(resolve => server.close(() => resolve()));
    });

    const pinned = (targetUrl: URL) => ({ url: targetUrl, address: '127.0.0.1', family: 4 });

    it('connects to the pinned fixture without system DNS and preserves Host and JSON', async () => {
        const response = await pinnedProviderRequest(pinned(url), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{"synthetic":true}',
        });
        expect(await response.json()).toEqual({
            host: url.host,
            contentType: 'application/json',
            body: '{"synthetic":true}',
        });
        expect(dns.lookup).not.toHaveBeenCalled();
    });
    it('streams multipart bodies with the generated boundary', async () => {
        const form = new FormData();
        form.set('file', new Blob(['synthetic-file'], { type: 'image/png' }), 'fixture.png');
        const response = await pinnedProviderRequest(pinned(url), { method: 'POST', body: form });
        const body = await response.json();
        expect(body.contentType).toMatch(/^multipart\/form-data; boundary=/u);
        expect(body.body).toContain('synthetic-file');
        expect(body.body).toContain('fixture.png');
    });
    it('does not follow redirects', async () => {
        url.pathname = '/redirect';
        const response = await pinnedProviderRequest(pinned(url), {});
        expect(response.status).toBe(302);
        await response.text();
        expect(hits).toEqual(['/redirect']);
    });
    it('decodes compressed responses within the existing response budget', async () => {
        url.pathname = '/gzip';
        const response = await pinnedProviderRequest(pinned(url), {});
        expect(await readResponseText(response, 100)).toBe('decoded-response');
        await expect(readResponseText(await pinnedProviderRequest(pinned(url), {}), 5)).rejects.toThrow(
            '大小',
        );
    });
    it('cancels a stalled response when the body deadline expires', async () => {
        url.pathname = '/slow';
        const response = await pinnedProviderRequest(pinned(url), {});
        await expect(readResponseText(response, 100, 30, 'fixture timeout')).rejects.toThrow(
            'fixture timeout',
        );
    });
    it('honors an aborted request before connecting', async () => {
        const controller = new AbortController();
        controller.abort();
        await expect(pinnedProviderRequest(pinned(url), { signal: controller.signal })).rejects.toThrow();
        expect(hits).toEqual([]);
    });
    it('handles no-content responses', async () => {
        url.pathname = '/empty';
        const response = await pinnedProviderRequest(pinned(url), {});
        expect(response.status).toBe(204);
        expect(await response.text()).toBe('');
    });
    it('resolves and validates each actual transport request', async () => {
        const resolveForRequest = vi
            .fn()
            .mockResolvedValueOnce(pinned(url))
            .mockRejectedValueOnce(Error('Private address rejected'));
        const safeUrls = { resolveForRequest } as unknown as SafeProviderUrlService;
        const transport = new ImageProviderTransport(safeUrls);
        await (await transport.request(url, {})).text();
        await expect(transport.request(url, {})).rejects.toThrow('网络安全校验');
        expect(resolveForRequest).toHaveBeenCalledTimes(2);
        expect(hits).toHaveLength(1);
    });
});

describe('Pinned provider TLS identity', () => {
    it('retains certificate validation and verifies the original hostname and SNI', async () => {
        const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
        const key = privateKey.export({ type: 'pkcs8', format: 'pem' });
        // OpenSSL 3 on Linux cannot reopen Node's socket-backed stdin as a file.
        // A POSIX pipe keeps the ephemeral key in memory on both Linux and macOS.
        const cert = execFileSync(
            'sh',
            ['-c', 'cat | openssl req -new -x509 -key /dev/stdin -subj /CN=provider-tls.invalid -days 1'],
            { input: key, stdio: ['pipe', 'pipe', 'ignore'] },
        );
        let servername: string | false | undefined;
        const server = https.createServer({ key, cert }, (request, response) => {
            servername = (request.socket as TLSSocket).servername;
            response.end('trusted-fixture');
        });
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        try {
            const address = server.address();
            if (!address || typeof address === 'string') throw Error('Missing fixture address');
            const target = {
                url: new URL(`https://provider-tls.invalid:${address.port}/`),
                address: '127.0.0.1',
                family: 4,
            };
            await expect(pinnedProviderRequest(target, {})).rejects.toThrow(/self.signed/iu);
            // Trust only the ephemeral test certificate; production keeps default TLS verification.
            const nativeRequest = https.request;
            vi.spyOn(https, 'request').mockImplementation((url, options, callback) =>
                nativeRequest(url, { ...options, ca: cert }, callback),
            );
            syncBuiltinESMExports();
            expect(await (await pinnedProviderRequest(target, {})).text()).toBe('trusted-fixture');
            expect(servername).toBe('provider-tls.invalid');
            target.url.hostname = 'wrong-provider.invalid';
            await expect(pinnedProviderRequest(target, {})).rejects.toThrow(/hostname|altnames/iu);
        } finally {
            vi.restoreAllMocks();
            syncBuiltinESMExports();
            server.closeAllConnections();
            await new Promise<void>(resolve => server.close(() => resolve()));
        }
    });
});
