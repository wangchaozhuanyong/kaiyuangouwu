import { describe, expect, it } from 'vitest';

import { createAccountEntryProof, validateAccountEntryProof } from './account-entry-proof';

const signingSecret = 'test-signing-secret-that-is-at-least-thirty-two-characters';

describe('account entry proof', () => {
    it('binds the proof to the route, host, token and expiry', () => {
        const now = Date.parse('2026-08-23T00:00:00.000Z');
        const proof = createAccountEntryProof({
            route: 'verify-account',
            host: 'Shop.Example.com',
            token: 'verification-token',
            signingSecret,
            expiresAt: now + 60_000,
        });

        expect(
            validateAccountEntryProof({
                proof,
                route: 'verify-account',
                host: 'shop.example.com',
                token: 'verification-token',
                signingSecret,
                now,
            }),
        ).toBe(true);
        expect(
            validateAccountEntryProof({
                proof,
                route: 'reset-password',
                host: 'shop.example.com',
                token: 'verification-token',
                signingSecret,
                now,
            }),
        ).toBe(false);
        expect(
            validateAccountEntryProof({
                proof,
                route: 'verify-account',
                host: 'other.example.com',
                token: 'verification-token',
                signingSecret,
                now,
            }),
        ).toBe(false);
        expect(
            validateAccountEntryProof({
                proof,
                route: 'verify-account',
                host: 'shop.example.com',
                token: 'different-token',
                signingSecret,
                now,
            }),
        ).toBe(false);
        expect(
            validateAccountEntryProof({
                proof,
                route: 'verify-account',
                host: 'shop.example.com',
                token: 'verification-token',
                signingSecret,
                now: now + 60_001,
            }),
        ).toBe(false);
    });

    it('rejects a modified proof', () => {
        const proof = createAccountEntryProof({
            route: 'reset-password',
            host: 'shop.example.com',
            token: 'reset-token',
            signingSecret,
            expiresAt: Date.now() + 60_000,
        });

        expect(
            validateAccountEntryProof({
                proof: `${proof}tampered`,
                route: 'reset-password',
                host: 'shop.example.com',
                token: 'reset-token',
                signingSecret,
            }),
        ).toBe(false);
    });
});
