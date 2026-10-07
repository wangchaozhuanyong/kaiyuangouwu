import { Logger } from '@vendure/core';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { parsePublicPerformanceBatch, publicPerformanceRegion } from './storefront-performance';
import { StorefrontPublicPageController } from './storefront-public-page.controller';

const batch = () => ({
    sampleId: '842d232d-2c7a-46a7-bb76-2dc46824962e',
    revision: 'index-B4aHg53p',
    pageType: 'product',
    device: 'mobile',
    network: '4g',
    metrics: [
        {
            name: 'LCP',
            value: 2100,
            phases: {
                ttfb: 200,
                resourceLoadDelay: 300,
                resourceLoadDuration: 1500,
                elementRenderDelay: 100,
            },
        },
    ],
});
const response = () => {
    const res = { setHeader: vi.fn(), status: vi.fn(), end: vi.fn() };
    res.status.mockReturnValue(res);
    return res;
};

describe('anonymous bounded performance samples', () => {
    afterEach(() => vi.restoreAllMocks());

    it('accepts only bounded numbers and finite categories', () => {
        expect(parsePublicPerformanceBatch(batch())).toEqual(batch());
        for (const value of [-1, Infinity, NaN, 120_001]) {
            expect(() =>
                parsePublicPerformanceBatch({ ...batch(), metrics: [{ name: 'LCP', value }] }),
            ).toThrow();
        }
        expect(() =>
            parsePublicPerformanceBatch({ ...batch(), metrics: [{ name: 'CLS', value: 101 }] }),
        ).toThrow();
        expect(() =>
            parsePublicPerformanceBatch({ ...batch(), metrics: Array(6).fill({ name: 'LCP', value: 1 }) }),
        ).toThrow();
        expect(() => parsePublicPerformanceBatch({ ...batch(), revision: 'a'.repeat(81) })).toThrow();
        expect(() => parsePublicPerformanceBatch({ ...batch(), sampleId: 'user-123' })).toThrow();
        expect(() => parsePublicPerformanceBatch({ ...batch(), url: '/private?token=secret' })).toThrow();
        expect(() =>
            parsePublicPerformanceBatch({
                ...batch(),
                metrics: [{ name: 'LCP', value: 1, phases: { selector: '#private' } }],
            }),
        ).toThrow();
    });

    it('requires proxy-confirmed Cloudflare provenance and never infers location from currency or language', () => {
        const request = {
            socket: { remoteAddress: '127.0.0.1' },
            headers: {
                'cf-ipcountry': 'CN',
                'x-storefront-country': 'CN',
                'accept-language': 'zh-CN',
            },
        };
        expect(publicPerformanceRegion(request as never)).toBe('UNKNOWN');
        expect(
            publicPerformanceRegion({
                ...request,
                headers: {
                    ...request.headers,
                    'x-storefront-country-verified': '1',
                },
            } as never),
        ).toBe('CN');
        expect(
            publicPerformanceRegion({
                ...request,
                socket: { remoteAddress: '203.0.113.1' },
                headers: {
                    ...request.headers,
                    'x-storefront-country-verified': '1',
                },
            } as never),
        ).toBe('UNKNOWN');
    });

    it('logs only the sanitized sample, public store code and verified region after host verification', async () => {
        const log = vi.spyOn(Logger, 'info').mockImplementation(() => undefined);
        const access = {
            resolveRequest: vi.fn().mockResolvedValue({ ctx: { channel: { code: 'store-a' } } }),
        };
        const pages = { read: vi.fn() };
        const controller = new StorefrontPublicPageController(access as never, {} as never, pages as never);
        const res = response();
        await controller.performance(
            {
                body: batch(),
                socket: { remoteAddress: '127.0.0.1' },
                headers: {
                    cookie: 'private-cookie',
                    authorization: 'private-token',
                    'x-storefront-country': 'MY',
                    'x-storefront-country-verified': '1',
                },
            } as never,
            res as never,
        );
        expect(res.status).toHaveBeenCalledWith(204);
        expect(log).toHaveBeenCalledWith(
            JSON.stringify({
                event: 'storefront-performance',
                store: 'store-a',
                region: 'MY',
                ...batch(),
            }),
            'StorefrontPerformance',
        );
        expect(pages.read).not.toHaveBeenCalled();
        log.mockClear();
        access.resolveRequest.mockResolvedValue(null);
        await controller.performance({ body: batch() } as never, response() as never);
        expect(log).not.toHaveBeenCalled();
    });

    it('bounds the Nginx route and excludes loopback from trusted Cloudflare geolocation', () => {
        const nginx = readFileSync(resolve(__dirname, '../../../deploy/nginx/damatong.conf'), 'utf8');
        const route = nginx.match(/location = \/_storefront\/performance \{([\s\S]*?)\n    \}/u)?.[1] ?? '';
        expect(route).toContain('client_max_body_size 8k;');
        expect(route).toContain('limit_req zone=vendure_storefront_performance');
        expect(route).toContain('proxy_set_header Cookie "";');
        expect(route).toContain('proxy_set_header Authorization "";');
        expect(nginx).toContain(
            'map "$trusted_cloudflare_origin|$storefront_loopback_origin" $storefront_country_verified',
        );
        expect(nginx).toContain('"1|0" 1;');
    });
});
