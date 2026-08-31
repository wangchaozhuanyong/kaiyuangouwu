import { describe, expect, it } from 'vitest';

import { resolveRuntimeAdminCredentials } from './runtime-admin-credentials';

describe('runtime admin credentials', () => {
    it('keeps the documented local development defaults', () => {
        expect(resolveRuntimeAdminCredentials({}, false)).toEqual({
            identifier: 'superadmin',
            password: 'superadmin',
            cookieSecret: 'abc',
        });
    });

    it('accepts explicit hardened production credentials', () => {
        expect(
            resolveRuntimeAdminCredentials(
                {
                    SUPERADMIN_USERNAME: 'operations-owner',
                    SUPERADMIN_PASSWORD: 'correct-horse-battery-staple',
                    COOKIE_SECRET: 'cookie-signing-secret-with-more-than-32-characters',
                },
                true,
            ),
        ).toEqual({
            identifier: 'operations-owner',
            password: 'correct-horse-battery-staple',
            cookieSecret: 'cookie-signing-secret-with-more-than-32-characters',
        });
    });

    it.each([
        [{}, 'SUPERADMIN_USERNAME'],
        [{ SUPERADMIN_USERNAME: 'replace-with-admin' }, 'SUPERADMIN_USERNAME'],
        [
            {
                SUPERADMIN_USERNAME: 'operations-owner',
                SUPERADMIN_PASSWORD: 'short',
            },
            'SUPERADMIN_PASSWORD',
        ],
        [
            {
                SUPERADMIN_USERNAME: 'operations-owner',
                SUPERADMIN_PASSWORD: 'correct-horse-battery-staple',
                COOKIE_SECRET: 'replace-with-a-cookie-secret-that-is-long-enough',
            },
            'COOKIE_SECRET',
        ],
    ])('rejects unsafe production credentials', (env, expectedName) => {
        expect(() => resolveRuntimeAdminCredentials(env, true)).toThrow(expectedName);
    });
});
