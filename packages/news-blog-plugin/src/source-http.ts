import { Injectable } from '@nestjs/common';
import { EditorialProviderService } from '@vendure/image-generation-plugin';
import { request } from 'node:https';

import { imageAllowed } from './source-images';
import { decodeSourceResponse } from './source-response';
import { sourceAllows } from './sources';
@Injectable()
export class BlogSourceHttp {
    constructor(private readonly provider: EditorialProviderService) {}
    async read(
        code: string,
        url: string,
        conditional: { etag?: string | null; lastModified?: string | null } = {},
    ) {
        const r = await this.fetch(code, url, { conditional });
        return {
            body: r.body.toString('utf8'),
            status: r.status,
            etag: r.headers.etag ?? null,
            lastModified: r.headers['last-modified'] ?? null,
        };
    }
    async imageVersion(code: string, url: string, page: string) {
        const r = await this.fetch(code, url, { page, head: true });
        return String(r.headers.etag ?? r.headers['last-modified'] ?? '');
    }
    async image(code: string, url: string, page: string) {
        const r = await this.fetch(code, url, { page });
        if (!/^image\/(jpeg|png|webp|gif)(?:;|$)/iu.test(String(r.headers['content-type'] ?? '')))
            throw new Error('来源图片格式不支持');
        return r.body;
    }
    private async fetch(
        code: string,
        rawUrl: string,
        options: {
            page?: string;
            head?: boolean;
            conditional?: { etag?: string | null; lastModified?: string | null };
        },
        hops = 0,
    ): Promise<{ body: Buffer; status: number; headers: import('node:http').IncomingHttpHeaders }> {
        if (
            !(options.page ? imageAllowed(code, rawUrl, options.page) : sourceAllows(code, rawUrl)) ||
            hops > 3
        )
            throw new Error('资讯来源地址不在白名单');
        const target = await this.provider.safeUrls.resolveForRequest(rawUrl, false);
        const response = await new Promise<{
            body: Buffer;
            status: number;
            headers: import('node:http').IncomingHttpHeaders;
        }>((resolve, reject) => {
            const req = request(
                target.url,
                {
                    method: options.head ? 'HEAD' : 'GET',
                    signal: AbortSignal.timeout(15000),
                    lookup: (_hostname, opts, done) =>
                        opts.all
                            ? done(null, [{ address: target.address, family: target.family }] as never)
                            : done(null, target.address, target.family),
                    headers: {
                        'User-Agent': 'VendureNewsBlog/1.0',
                        'Accept-Encoding': 'gzip, br, deflate',
                        Accept: options.page
                            ? 'image/png,image/jpeg,image/webp,image/gif'
                            : code === 'gemini-api'
                              ? 'text/markdown,text/plain;q=0.9,text/html;q=0.8'
                              : 'application/rss+xml,application/xml,text/html',
                        ...(options.conditional?.etag ? { 'If-None-Match': options.conditional.etag } : {}),
                        ...(options.conditional?.lastModified
                            ? { 'If-Modified-Since': options.conditional.lastModified }
                            : {}),
                    },
                },
                res => {
                    const chunks: Buffer[] = [];
                    let size = 0;
                    res.on('data', (chunk: Buffer) => {
                        size += chunk.length;
                        if (size > (options.page ? 8000000 : 2000000)) {
                            res.destroy();
                            reject(new Error('来源响应过大'));
                        } else chunks.push(chunk);
                    });
                    res.on('end', () =>
                        resolve({
                            body: Buffer.concat(chunks),
                            status: res.statusCode ?? 0,
                            headers: res.headers,
                        }),
                    );
                    res.on('error', () => reject(new Error('来源读取中断')));
                },
            );
            req.on('error', () => reject(new Error('来源读取失败或超时')));
            req.end();
        });
        if ([301, 302, 303, 307, 308].includes(response.status)) {
            if (!response.headers.location) throw new Error('来源重定向无效');
            return this.fetch(code, new URL(response.headers.location, rawUrl).href, options, hops + 1);
        }
        if (![200, 304].includes(response.status)) throw new Error(`来源暂不可用（HTTP ${response.status}）`);
        response.body = decodeSourceResponse(
            response.body,
            response.headers['content-encoding'],
            options.page ? 8000000 : 2000000,
        );
        return response;
    }
}
