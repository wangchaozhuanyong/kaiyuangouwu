import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

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
    it('allows only the Cloudflare Insights resources injected into promotion pages', async () => {
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
        expect(contentSecurityPolicy).toContain('script-src-elem https://static.cloudflareinsights.com');
        expect(contentSecurityPolicy).toContain('connect-src https://cloudflareinsights.com');
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
});
