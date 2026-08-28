import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

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
        expect(response.setHeader).toHaveBeenCalledWith(
            'X-Robots-Tag',
            'index, nofollow, max-image-preview:large',
        );
    });

    it('does not issue an entry cookie without a valid signed proof', async () => {
        const request = { host: 'shop.example.com' };
        const accessService = {
            resolveRequest: vi.fn(() => Promise.resolve(request)),
            validateAccountEntryProof: vi.fn(() => false),
            createEntryCookie: vi.fn(() => 'entry=cookie'),
        };
        const controller = new StorefrontPromotionController(accessService as never, {} as never);
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
        const controller = new StorefrontPromotionController(accessService as never, {} as never);
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

    it('redirects policy and support entries through the same signed gate', async () => {
        const request = { host: 'shop.example.com' };
        const accessService = {
            resolveRequest: vi.fn(() => Promise.resolve(request)),
            validateEntryTicket: vi.fn(() => true),
            createEntryCookie: vi.fn(() => 'entry=cookie'),
        };
        const controller = new StorefrontPromotionController(accessService as never, {} as never);
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
        const controller = new StorefrontPromotionController(accessService as never, {} as never);
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

    it('publishes a crawlable promotion sitemap without exposing the gated storefront', async () => {
        const request = { host: 'shop.example.com' };
        const accessService = {
            resolveRequest: vi.fn(() => Promise.resolve(request)),
        };
        const controller = new StorefrontPromotionController(accessService as never, {} as never);
        const robotsResponse = responseMock();
        const sitemapResponse = responseMock();

        await controller.robots({} as Request, robotsResponse as unknown as Response);
        await controller.sitemap({} as Request, sitemapResponse as unknown as Response);

        expect(robotsResponse.send).toHaveBeenCalledWith(
            expect.stringContaining('Sitemap: https://shop.example.com/sitemap.xml'),
        );
        expect(sitemapResponse.type).toHaveBeenCalledWith('application/xml');
        expect(sitemapResponse.send).toHaveBeenCalledWith(
            expect.stringContaining('<loc>https://shop.example.com/promo</loc>'),
        );
    });
});
