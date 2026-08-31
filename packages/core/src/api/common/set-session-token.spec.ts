import { type Request, type Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { type AuthOptions } from '../../config/vendure-config';
import { setSessionToken } from './set-session-token';

const authOptions = {
    tokenMethod: 'bearer',
    authTokenHeaderKey: 'vendure-auth-token',
} as Required<AuthOptions>;

describe('setSessionToken', () => {
    it('sets a bearer token while response headers are writable', () => {
        const set = vi.fn();
        setSessionToken({
            sessionToken: 'test-token',
            rememberMe: false,
            authOptions,
            req: {} as Request,
            res: { headersSent: false, set } as unknown as Response,
        });

        expect(set).toHaveBeenCalledWith('vendure-auth-token', 'test-token');
    });

    it('does not throw when a concurrent GraphQL field already sent the response', () => {
        const set = vi.fn();
        expect(() => setSessionToken({
            sessionToken: '',
            rememberMe: false,
            authOptions,
            req: {} as Request,
            res: { headersSent: true, set } as unknown as Response,
        })).not.toThrow();

        expect(set).not.toHaveBeenCalled();
    });
});
