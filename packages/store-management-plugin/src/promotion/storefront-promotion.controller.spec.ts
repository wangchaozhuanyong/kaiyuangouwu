import { LanguageCode } from '@vendure/core';
import { load } from 'cheerio';
import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import {
    defaultStorefrontSeoDocument,
    defaultStorefrontSeoSettings,
    publicStorefrontSeoSettings,
} from '../seo/storefront-seo.contract';

import { PROMOTION_VISUAL_SCRIPT_SHA256 } from './promotion-visual-script';
import { StorefrontPromotionController } from './storefront-promotion.controller';

function responseMock() {
    const response = {
        status: vi.fn(),
        type: vi.fn(),
        send: vi.fn(),
        setHeader: vi.fn(),
        redirect: vi.fn(),
    };
    response.status.mockReturnValue(response);
    response.type.mockReturnValue(response);
    response.send.mockReturnValue(response);
    return response;
}

describe('StorefrontPromotionController', () => {
    function publishedController() {
        const ctx = {
            channel: { code: 'shop', customFields: { storefrontNameEn: 'Shop', storefrontNameZh: '店铺' } },
            channelId: 1,
            languageCode: LanguageCode.zh_Hans,
            copy: (changes: { languageCode: LanguageCode }) => ({ ...ctx, ...changes }),
        };
        const configuration = {
            payload: {
                ...publicStorefrontSeoSettings(defaultStorefrontSeoSettings()),
                indexingEnabled: true,
            },
            version: 2,
        };
        const record = {
            payload: { ...defaultStorefrontSeoDocument('PAGE'), title: 'Published promo' },
            version: 4,
        };
        const seo = {
            publishedConfiguration: vi.fn().mockResolvedValue(configuration),
            publishedRecord: vi.fn().mockResolvedValue(record),
        };
        const publicSeo = {
            primaryHost: vi.fn().mockResolvedValue('shop.test'),
            robots: vi.fn().mockResolvedValue('shared robots'),
            sitemap: vi.fn().mockResolvedValue('<shared-sitemap/>'),
        };
        const activation = { getAccessMode: vi.fn().mockResolvedValue('LIVE') };
        const access = {
            resolveRequest: vi.fn().mockResolvedValue({ ctx, host: 'shop.test' }),
            createEntryTicket: vi.fn().mockReturnValue('fixture-ticket'),
        };
        const promotion = {
            renderPublished: vi
                .fn()
                .mockResolvedValue(
                    '<html lang="en"><head><title>Published Shop</title>' +
                        '<meta name="description" content="Published description"></head>' +
                        '<body><main>Published body</main></body></html>',
                ),
        };
        const connection = {
            getRepository: vi.fn().mockReturnValue({
                findOne: vi.fn().mockResolvedValue({
                    descriptionEn: 'Actual store description',
                    descriptionZh: '真实中文简介',
                }),
            }),
        };
        const controller = new StorefrontPromotionController(
            access as never,
            promotion as never,
            {} as never,
            {} as never,
            seo as never,
            publicSeo as never,
            activation as never,
            connection as never,
        );
        return { controller, seo, publicSeo, activation, promotion, configuration, record };
    }

    it('publishes qualified language promo metadata while keeping the legacy entry noindex', async () => {
        const { controller, promotion } = publishedController();
        const localized = responseMock();
        await controller.promotion({ originalUrl: '/en/promo' } as Request, localized as never);
        expect(promotion.renderPublished).toHaveBeenCalledWith(
            expect.objectContaining({ languageCode: LanguageCode.en }),
            'fixture-ticket',
        );
        expect(localized.setHeader).toHaveBeenLastCalledWith(
            'X-Robots-Tag',
            'index, follow, max-image-preview:large',
        );
        expect(load(localized.send.mock.calls[0][0] as string)('link[rel="canonical"]').attr('href')).toBe(
            'https://shop.test/en/promo',
        );
        const legacy = responseMock();
        await controller.promotion({ originalUrl: '/promo' } as Request, legacy as never);
        expect(legacy.setHeader).toHaveBeenLastCalledWith('X-Robots-Tag', 'noindex, follow');
    });
    it('blocks a store closure or changed publication before sending rendered promotion HTML', async () => {
        const closing = publishedController();
        closing.activation.getAccessMode.mockResolvedValueOnce('LIVE').mockResolvedValueOnce('CLOSED');
        const closedResponse = responseMock();
        await expect(
            closing.controller.promotion({ originalUrl: '/en/promo' } as Request, closedResponse as never),
        ).rejects.toThrow();
        expect(closedResponse.send).not.toHaveBeenCalled();
        const changed = publishedController();
        changed.seo.publishedRecord
            .mockResolvedValueOnce(changed.record)
            .mockResolvedValueOnce({ ...changed.record, version: 5 });
        const changedResponse = responseMock();
        await expect(
            changed.controller.promotion({ originalUrl: '/en/promo' } as Request, changedResponse as never),
        ).rejects.toThrow('changed');
        expect(changedResponse.send).not.toHaveBeenCalled();
    });
    it('delegates legacy discovery endpoints to the same robots and sitemap policy', async () => {
        const { controller, publicSeo } = publishedController();
        const robots = responseMock();
        const sitemap = responseMock();
        await controller.robots({} as Request, robots as never);
        await controller.sitemap({} as Request, sitemap as never);
        expect(publicSeo.robots).toHaveBeenCalledOnce();
        expect(publicSeo.sitemap).toHaveBeenCalledOnce();
        expect(robots.send).toHaveBeenCalledWith('shared robots');
        expect(sitemap.send).toHaveBeenCalledWith('<shared-sitemap/>');
    });
    it.each([undefined, { id: 'anonymous-session' }])(
        'rejects entry cookies and anonymous sessions even when the legacy entry gate is disabled',
        async session => {
            const access = {
                enabled: false,
                resolveRequest: vi.fn().mockResolvedValue({ channelId: 'store-a' }),
                hasValidEntryCookie: vi.fn().mockReturnValue(true),
            };
            const controller = new StorefrontPromotionController(
                access as never,
                {} as never,
                { getSessionFromToken: vi.fn().mockResolvedValue(session) } as never,
                { authOptions: { tokenMethod: ['cookie', 'bearer'], apiKeyHeaderKey: 'x-api-key' } } as never,
            );
            const req = { session: { token: 'fixture-token' }, get: vi.fn() };
            const response = responseMock();
            await controller.access(req as never, response as never);
            expect(response.status).toHaveBeenCalledWith(401);
            expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
        },
    );
    it('accepts a server-validated authenticated session for protected static media', async () => {
        const controller = new StorefrontPromotionController(
            { resolveRequest: vi.fn().mockResolvedValue({ channelId: 'store-a' }) } as never,
            {} as never,
            { getSessionFromToken: vi.fn().mockResolvedValue({ user: { id: 'customer-a' } }) } as never,
            { authOptions: { tokenMethod: ['cookie', 'bearer'], apiKeyHeaderKey: 'x-api-key' } } as never,
        );
        const response = responseMock();
        await controller.access(
            { session: { token: 'fixture-token' }, get: vi.fn() } as never,
            response as never,
        );
        expect(response.status).toHaveBeenCalledWith(204);
    });
    it('allows only the trusted visual renderer and Cloudflare Insights scripts', async () => {
        const request = { ctx: {}, host: 'shop.example.com' };
        const accessService = {
            resolveRequest: vi.fn(() => Promise.resolve(request)),
            createEntryTicket: vi.fn(() => 'entry-ticket'),
        };
        const promotionService = {
            renderPublished: vi.fn(() => Promise.resolve('<!doctype html><html></html>')),
        };
        const controller = new StorefrontPromotionController(
            accessService as never,
            promotionService as never,
            {} as never,
            {} as never,
        );
        const response = responseMock();

        await controller.promotion({} as Request, response as unknown as Response);

        const contentSecurityPolicy = response.setHeader.mock.calls.find(
            ([name]) => name === 'Content-Security-Policy',
        )?.[1];
        expect(contentSecurityPolicy).toContain("script-src 'none'");
        expect(contentSecurityPolicy).toContain(
            `script-src-elem 'sha256-${PROMOTION_VISUAL_SCRIPT_SHA256}' https://static.cloudflareinsights.com`,
        );
        expect(contentSecurityPolicy).toContain("connect-src 'self' https://cloudflareinsights.com");
        expect(response.setHeader).toHaveBeenCalledWith('X-Robots-Tag', 'noindex, follow');
    });

    it('does not issue an entry cookie without a valid signed proof', async () => {
        const request = { host: 'shop.example.com' };
        const accessService = {
            resolveRequest: vi.fn(() => Promise.resolve(request)),
            validateAccountEntryProof: vi.fn(() => false),
            createEntryCookie: vi.fn(() => 'entry=cookie'),
        };
        const controller = new StorefrontPromotionController(
            accessService as never,
            {} as never,
            {} as never,
            {} as never,
        );
        const response = responseMock();

        await controller.accountEntry(
            {} as Request,
            response as unknown as Response,
            'verify-account',
            'verification-token-with-enough-entropy',
        );

        expect(response.status).toHaveBeenCalledWith(400);
        expect(response.setHeader).not.toHaveBeenCalledWith('Set-Cookie', expect.anything());
        expect(response.redirect).not.toHaveBeenCalled();
    });

    it('redirects valid promotion entries only to allow-listed storefront destinations', async () => {
        const request = { host: 'shop.example.com' };
        const accessService = {
            resolveRequest: vi.fn(() => Promise.resolve(request)),
            validateEntryTicket: vi.fn(() => true),
            createEntryCookie: vi.fn(() => 'entry=cookie'),
        };
        const controller = new StorefrontPromotionController(
            accessService as never,
            {} as never,
            {} as never,
            {} as never,
        );
        const productResponse = responseMock();
        const unsafeResponse = responseMock();

        await controller.enter({} as Request, productResponse as unknown as Response, 'ticket', 'product:42');
        await controller.enter(
            {} as Request,
            unsafeResponse as unknown as Response,
            'ticket',
            'https://evil.example',
        );

        expect(productResponse.redirect).toHaveBeenCalledWith(303, '/product?id=42');
        expect(unsafeResponse.redirect).toHaveBeenCalledWith(303, '/');
    });

    it.each([undefined, 'home'])('always sends the public homepage entry to / (%s)', async destination => {
        const accessService = {
            resolveRequest: vi.fn(() => Promise.resolve({ host: 'shop.example.com' })),
            validateEntryTicket: vi.fn(() => false),
            createEntryCookie: vi.fn(),
        };
        const controller = new StorefrontPromotionController(
            accessService as never,
            {} as never,
            {} as never,
            {} as never,
        );
        for (const ticket of [undefined, 'expired-ticket']) {
            const response = responseMock();
            await controller.enter({} as Request, response as unknown as Response, ticket, destination);
            expect(response.redirect).toHaveBeenCalledWith(303, '/');
            expect(response.setHeader).not.toHaveBeenCalledWith('Set-Cookie', expect.anything());
        }
        expect(accessService.validateEntryTicket).not.toHaveBeenCalled();
    });

    it('returns invalid non-home promotion entries to a fresh promotion page without a text download', async () => {
        const request = { host: 'shop.example.com' };
        const accessService = {
            resolveRequest: vi.fn(() => Promise.resolve(request)),
            validateEntryTicket: vi.fn(() => false),
            createEntryCookie: vi.fn(() => 'entry=cookie'),
        };
        const controller = new StorefrontPromotionController(
            accessService as never,
            {} as never,
            {} as never,
            {} as never,
        );
        const response = responseMock();

        await controller.enter(
            {} as Request,
            response as unknown as Response,
            'expired-ticket',
            'product:42',
        );

        expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
        expect(response.redirect).toHaveBeenCalledWith(303, '/promo');
        expect(response.type).not.toHaveBeenCalled();
        expect(response.send).not.toHaveBeenCalled();
        expect(response.setHeader).not.toHaveBeenCalledWith('Set-Cookie', expect.anything());
    });

    it('redirects policy and support entries through the same signed gate', async () => {
        const request = { host: 'shop.example.com' };
        const accessService = {
            resolveRequest: vi.fn(() => Promise.resolve(request)),
            validateEntryTicket: vi.fn(() => true),
            createEntryCookie: vi.fn(() => 'entry=cookie'),
        };
        const controller = new StorefrontPromotionController(
            accessService as never,
            {} as never,
            {} as never,
            {} as never,
        );
        const privacyResponse = responseMock();
        const supportResponse = responseMock();

        await controller.enter({} as Request, privacyResponse as unknown as Response, 'ticket', 'privacy');
        await controller.enter({} as Request, supportResponse as unknown as Response, 'ticket', 'support');

        expect(privacyResponse.redirect).toHaveBeenCalledWith(303, '/legal?id=privacy');
        expect(supportResponse.redirect).toHaveBeenCalledWith(303, '/support');
    });

    it('redirects only after the signed proof is accepted', async () => {
        const request = { host: 'shop.example.com' };
        const accessService = {
            resolveRequest: vi.fn(() => Promise.resolve(request)),
            validateAccountEntryProof: vi.fn(() => true),
            createEntryCookie: vi.fn(() => 'entry=cookie'),
        };
        const controller = new StorefrontPromotionController(
            accessService as never,
            {} as never,
            {} as never,
            {} as never,
        );
        const response = responseMock();

        await controller.accountEntry(
            {} as Request,
            response as unknown as Response,
            'reset-password',
            'reset-token-with-enough-entropy',
            'signed-proof',
        );

        expect(accessService.validateAccountEntryProof).toHaveBeenCalledWith(
            'signed-proof',
            'reset-password',
            'reset-token-with-enough-entropy',
            request,
        );
        expect(response.setHeader).toHaveBeenCalledWith('Set-Cookie', 'entry=cookie');
        expect(response.redirect).toHaveBeenCalledWith(
            303,
            '/#/reset-password?token=reset-token-with-enough-entropy',
        );
    });

    it('keeps the legacy constructor fail closed without advertising unpublished promotion URLs', async () => {
        const accessService = {
            resolveRequest: vi.fn().mockResolvedValue({ ctx: {}, host: 'shop.example.com' }),
        };
        const controller = new StorefrontPromotionController(
            accessService as never,
            {} as never,
            {} as never,
            {} as never,
        );
        const robotsResponse = responseMock();
        const sitemapResponse = responseMock();
        await controller.robots({} as Request, robotsResponse as unknown as Response);
        await controller.sitemap({} as Request, sitemapResponse as unknown as Response);
        expect(robotsResponse.send).toHaveBeenCalledWith(expect.stringContaining('Disallow: /\n'));
        expect(robotsResponse.send).toHaveBeenCalledWith(
            expect.stringContaining('User-agent: GPTBot\nDisallow: /'),
        );
        const xml = sitemapResponse.send.mock.calls[0][0] as string;
        expect(xml).not.toContain('<loc>');
        expect(xml).not.toMatch(/product|category|flash-sale|recommendations/);
    });
});
