import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { Readable, pipeline } from 'node:stream';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';

import { PinnedProviderUrl } from '../security/safe-provider-url.service';

import { MAX_PROVIDER_IMAGE_BYTES, REQUEST_TIMEOUT_MS } from './image-provider-constants';
import {
    AmbiguousImageProviderError,
    DefinitiveImageProviderError,
    ImageProviderError,
} from './image-provider-errors';
import { safeError } from './image-provider-telemetry';

/** Connect only to the address checked for this request, retaining Host and TLS identity. */
export async function pinnedProviderRequest(target: PinnedProviderUrl, init: RequestInit): Promise<Response> {
    const encoded = new Request(target.url, init);
    const headers = Object.fromEntries(encoded.headers.entries());
    headers.host = target.url.host;
    headers['accept-encoding'] = 'identity';
    return new Promise((resolve, reject) => {
        const transport = target.url.protocol === 'https:' ? httpsRequest : httpRequest;
        const request = transport(
            target.url,
            {
                method: encoded.method,
                headers,
                agent: false,
                signal: init.signal ?? undefined,
                lookup: (_hostname, options, callback) => {
                    if (options.all) callback(null, [{ address: target.address, family: target.family }]);
                    else callback(null, target.address, target.family);
                },
            },
            response => {
                const responseHeaders = new Headers();
                for (const [name, value] of Object.entries(response.headers)) {
                    if (Array.isArray(value)) value.forEach(item => responseHeaders.append(name, item));
                    else if (value !== undefined) responseHeaders.set(name, value);
                }
                const status = response.statusCode ?? 502;
                if (encoded.method === 'HEAD' || [204, 205, 304].includes(status)) {
                    response.resume();
                    resolve(new Response(null, { status, headers: responseHeaders }));
                    return;
                }
                const encoding = responseHeaders.get('content-encoding')?.toLowerCase();
                const decoder =
                    encoding === 'gzip'
                        ? createGunzip()
                        : encoding === 'deflate'
                          ? createInflate()
                          : encoding === 'br'
                            ? createBrotliDecompress()
                            : undefined;
                let body: Readable = response;
                if (decoder) {
                    body = decoder;
                    responseHeaders.delete('content-encoding');
                    responseHeaders.delete('content-length');
                    pipeline(response, decoder, () => undefined);
                }
                resolve(
                    new Response(Readable.toWeb(body) as ReadableStream<Uint8Array>, {
                        status,
                        headers: responseHeaders,
                    }),
                );
            },
        );
        request.on('error', reject);
        if (encoded.body) {
            const body = Readable.fromWeb(encoded.body as Parameters<typeof Readable.fromWeb>[0]);
            pipeline(body, request, error => {
                if (error) reject(error);
            });
        } else request.end();
    });
}
export async function pinnedImageDownload(input: {
    url: URL;
    address: string;
    family: number;
}): Promise<{ bytes: Buffer; mimeType: string }> {
    return new Promise((resolve, reject) => {
        const transport = input.url.protocol === 'https:' ? httpsRequest : httpRequest;
        const request = transport(
            {
                protocol: input.url.protocol,
                hostname: input.address,
                family: input.family,
                port: input.url.port || undefined,
                method: 'GET',
                path: `${input.url.pathname}${input.url.search}`,
                servername: input.url.protocol === 'https:' ? input.url.hostname : undefined,
                headers: { host: input.url.host, accept: 'image/jpeg,image/png,image/webp' },
                timeout: REQUEST_TIMEOUT_MS,
            },
            response => {
                const status = response.statusCode ?? 0;
                if (status < 200 || status >= 300) {
                    response.resume();
                    reject(
                        new DefinitiveImageProviderError(`下载中转站图片失败（HTTP ${status}）`, {
                            httpStatus: status,
                        }),
                    );
                    return;
                }
                const declared = Number(response.headers['content-length'] ?? 0);
                if (declared > MAX_PROVIDER_IMAGE_BYTES) {
                    response.destroy();
                    reject(new DefinitiveImageProviderError('中转站图片超过 25MB'));
                    return;
                }
                const chunks: Buffer[] = [];
                let total = 0;
                response.on('data', (chunk: Buffer | string) => {
                    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                    total += buffer.length;
                    if (total > MAX_PROVIDER_IMAGE_BYTES) {
                        response.destroy(new DefinitiveImageProviderError('中转站图片超过 25MB'));
                        return;
                    }
                    chunks.push(buffer);
                });
                response.on('end', () => {
                    if (!total) {
                        reject(new DefinitiveImageProviderError('中转站图片大小无效'));
                        return;
                    }
                    const contentType = Array.isArray(response.headers['content-type'])
                        ? response.headers['content-type'][0]
                        : response.headers['content-type'];
                    resolve({
                        bytes: Buffer.concat(chunks, total),
                        mimeType: contentType?.split(';')[0] ?? 'image/png',
                    });
                });
                response.on('error', error =>
                    reject(new AmbiguousImageProviderError(`读取中转站图片失败：${safeError(error)}`)),
                );
            },
        );
        request.on('timeout', () => request.destroy(new AmbiguousImageProviderError('下载中转站图片超时')));
        request.on('error', error =>
            reject(
                error instanceof ImageProviderError
                    ? error
                    : new AmbiguousImageProviderError(`下载中转站图片网络错误：${safeError(error)}`),
            ),
        );
        request.end();
    });
}

export async function readResponseText(
    response: Response,
    maxBytes: number,
    timeoutMs = REQUEST_TIMEOUT_MS,
    timeoutMessage = '中转站响应体超时',
): Promise<string> {
    return (await readResponseBytes(response, maxBytes, timeoutMs, timeoutMessage)).toString('utf8');
}

export async function readResponseBytes(
    response: Response,
    maxBytes: number,
    timeoutMs: number,
    timeoutMessage: string,
): Promise<Buffer> {
    const declared = Number(response.headers.get('content-length') ?? 0);
    if (declared > maxBytes) {
        await response.body?.cancel().catch(() => undefined);
        throw new DefinitiveImageProviderError('中转站响应超过安全大小限制');
    }
    if (!response.body) return Buffer.alloc(0);
    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let total = 0;
    const deadline = Date.now() + timeoutMs;
    while (true) {
        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) {
            await reader.cancel().catch(() => undefined);
            throw new AmbiguousImageProviderError(timeoutMessage);
        }
        let chunk: ReadableStreamReadResult<Uint8Array>;
        try {
            chunk = await readChunkWithTimeout(reader, remainingMs, timeoutMessage);
        } catch (error) {
            await reader.cancel().catch(() => undefined);
            throw error;
        }
        const { done, value } = chunk;
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
            await reader.cancel().catch(() => undefined);
            throw new DefinitiveImageProviderError('中转站响应超过安全大小限制');
        }
        chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, total);
}

export async function readChunkWithTimeout(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    timeoutMs: number,
    timeoutMessage: string,
): Promise<ReadableStreamReadResult<Uint8Array>> {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new AmbiguousImageProviderError(timeoutMessage)), timeoutMs);
        reader.read().then(
            value => {
                clearTimeout(timeout);
                resolve(value);
            },
            error => {
                clearTimeout(timeout);
                reject(new AmbiguousImageProviderError(`读取中转站响应失败：${safeError(error)}`));
            },
        );
    });
}

export function remainingTimeout(deadline: number): number {
    return Math.max(1, deadline - Date.now());
}
