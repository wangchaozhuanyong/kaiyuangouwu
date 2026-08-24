import { RequestContext } from '@vendure/core';
import type { Request } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAccountEntryProof } from './account-entry-proof';
import {
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
});
