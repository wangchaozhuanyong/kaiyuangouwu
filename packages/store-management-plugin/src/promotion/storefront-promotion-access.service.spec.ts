import { LanguageCode, RequestContext } from '@vendure/core';
import type { Request } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAccountEntryProof } from './account-entry-proof';
import {
    primaryLanguageFromAcceptLanguage,
    storefrontLanguageCodeFromAcceptLanguage,
    StorefrontPromotionAccessService,
    StorefrontPromotionRequest,
} from './storefront-promotion-access.service';

function createService() {
    return new StorefrontPromotionAccessService(
        undefined as never,
        undefined as never,
        undefined as never,
        undefined as never,
        {
            enabled: true,
            signingSecret: 'test-signing-secret-that-is-at-least-thirty-two-characters',
            secureCookie: true,
            trustProxyHeaders: false,
            bypassHosts: [],
        },
    );
}

function promotionRequest(overrides: Partial<StorefrontPromotionRequest> = {}): StorefrontPromotionRequest {
    return {
        ctx: {} as RequestContext,
        host: 'shop.example.com',
        channelId: '7',
        ...overrides,
    };
}

describe('StorefrontPromotionAccessService', () => {
    afterEach(() => vi.useRealTimers());

    it('binds entry tickets to the store host and Channel', () => {
        const service = createService();
        const request = promotionRequest();
        const ticket = service.createEntryTicket(request);

        expect(service.validateEntryTicket(ticket, request)).toBe(true);
        expect(service.validateEntryTicket(ticket, promotionRequest({ host: 'other.example.com' }))).toBe(
            false,
        );
        expect(service.validateEntryTicket(ticket, promotionRequest({ channelId: '8' }))).toBe(false);
        expect(service.validateEntryTicket(`${ticket}tampered`, request)).toBe(false);
    });

    it('issues a host-only secure HttpOnly cookie and rejects it after expiry', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-08-22T00:00:00Z'));
        const service = createService();
        const request = promotionRequest();
        const cookie = service.createEntryCookie(request);
        const cookiePair = cookie.split(';')[0];
        const req = { headers: { cookie: cookiePair } } as Request;

        expect(cookie).toContain('HttpOnly');
        expect(cookie).toContain('SameSite=Lax');
        expect(cookie).toContain('Secure');
        expect(cookie).not.toContain('Domain=');
        expect(service.hasValidEntryCookie(req, request)).toBe(true);

        vi.advanceTimersByTime(7 * 24 * 60 * 60 * 1000 + 1);
        expect(service.hasValidEntryCookie(req, request)).toBe(false);
    });

    it('accepts only account entry proofs bound to the current store request', () => {
        const service = createService();
        const request = promotionRequest();
        const token = 'verification-token-with-enough-entropy';
        const proof = createAccountEntryProof({
            route: 'verify-account',
            host: request.host,
            token,
            signingSecret: 'test-signing-secret-that-is-at-least-thirty-two-characters',
            expiresAt: Date.now() + 60_000,
        });

        expect(service.validateAccountEntryProof(proof, 'verify-account', token, request)).toBe(true);
        expect(
            service.validateAccountEntryProof(
                proof,
                'verify-account',
                token,
                promotionRequest({ host: 'other.example.com' }),
            ),
        ).toBe(false);
    });

    it.each([
        ['zh-CN,zh;q=0.9,en;q=0.8', 'zh-CN', LanguageCode.zh_Hans],
        ['zh-TW,zh;q=0.9,en;q=0.8', 'zh-TW', LanguageCode.zh_Hans],
        ['en-US,en;q=0.9,zh-CN;q=0.8', 'en-US', LanguageCode.en],
        ['ms-MY,ms;q=0.9,zh-CN;q=0.8', 'ms-MY', LanguageCode.en],
        ['zh-CN;q=0.4,en-US;q=1', 'en-US', LanguageCode.en],
    ])('uses the highest-priority device language from %s', (header, primary, languageCode) => {
        expect(primaryLanguageFromAcceptLanguage(header)).toBe(primary);
        expect(storefrontLanguageCodeFromAcceptLanguage(header)).toBe(languageCode);
    });
});

describe('anonymous public request resolution', () => {
    it('reuses resolution inside one request but strips cookies, authorization, session and account query state', async () => {
        const ctx = { channelId: 'a' } as RequestContext;
        const create = vi.fn(() => Promise.resolve(ctx));
        const assertActive = vi.fn(() => Promise.resolve(undefined));
        const resolveRoute = vi.fn(() => Promise.resolve({ status: 'ACTIVE', channelToken: 'channel-a' }));
        const service = new StorefrontPromotionAccessService(
            undefined as never,
            undefined as never,
            { create } as never,
            { assertActive } as never,
            {
                enabled: true,
                signingSecret: 'fixture-secret-placeholder',
                secureCookie: true,
                trustProxyHeaders: false,
                bypassHosts: [],
            },
            { resolveRoute } as never,
        );
        const req = {
            headers: {
                host: 'shop.example',
                cookie: 'private-session=fixture',
                authorization: 'Bearer fixture',
                'accept-language': 'en',
            },
            protocol: 'https',
            query: { account: 'private' },
            session: { user: 'private' },
        } as unknown as Request;
        await Promise.all([service.resolveRequest(req), service.resolveRequest(req)]);
        expect(resolveRoute).toHaveBeenCalledTimes(1);
        expect(create).toHaveBeenCalledTimes(1);
        const options = (create.mock.calls[0] as any)[0];
        expect(options.apiType).toBe('shop');
        expect(options.channelOrToken).toBe('channel-a');
        expect(options.req).not.toBe(req);
        expect(options.req.headers).toEqual({ host: 'shop.example', 'accept-language': 'en' });
        expect(options.req.query).toEqual({});
        expect(options.req.session).toBeUndefined();
        expect(options.req.user).toBeUndefined();
        expect(assertActive).toHaveBeenCalledWith(ctx);
        await service.resolveRequest({ ...req } as Request);
        expect(resolveRoute).toHaveBeenCalledTimes(2);
    });
    it('denies inactive host routes before loading public data and always honors the activation gate', async () => {
        const create = vi.fn(() => Promise.resolve({ channelId: 'a' }));
        const assertActive = vi.fn().mockRejectedValue(new Error('inactive storefront'));
        const resolveRoute = vi.fn(() => Promise.resolve({ status: 'PENDING', channelToken: 'channel-a' }));
        const service = new StorefrontPromotionAccessService(
            undefined as never,
            undefined as never,
            { create } as never,
            { assertActive } as never,
            {
                enabled: true,
                signingSecret: 'fixture-secret-placeholder',
                secureCookie: true,
                trustProxyHeaders: false,
                bypassHosts: [],
            },
            { resolveRoute } as never,
        );
        expect(await service.resolveRequest({ headers: { host: 'shop.example' } } as Request)).toBeNull();
        expect(create).not.toHaveBeenCalled();
        resolveRoute.mockResolvedValue({ status: 'ACTIVE', channelToken: 'channel-a' });
        await expect(
            service.resolveRequest({ headers: { host: 'shop.example' } } as Request),
        ).rejects.toThrow('inactive storefront');
    });
});
