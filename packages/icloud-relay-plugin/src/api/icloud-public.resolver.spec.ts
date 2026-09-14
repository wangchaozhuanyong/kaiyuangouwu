import { ForbiddenError, RequestContext } from '@vendure/core';
import { describe, expect, it, vi } from 'vitest';

import { IcloudPublicQueryService } from '../services/icloud-public-query.service';

import { IcloudPublicResolver } from './icloud-public.resolver';

describe('public mail client address', () => {
    it.each([
        [{ ip: '198.51.100.10', socket: { remoteAddress: '127.0.0.1' } }, '198.51.100.10'],
        [{ socket: { remoteAddress: '127.0.0.1' } }, '127.0.0.1'],
    ])('uses the framework address or socket fallback, never raw headers', async (address, expected) => {
        const queryByCode = vi.fn().mockResolvedValue({ success: true });
        const resolver = new IcloudPublicResolver({ queryByCode } as unknown as IcloudPublicQueryService);
        const req = {
            ...address,
            headers: {
                'x-forwarded-for': '203.0.113.99',
                'x-real-ip': '203.0.113.98',
                'user-agent': 'audit',
            },
        };
        const ctx = { req } as unknown as RequestContext;
        await resolver.icloudQueryMails(ctx, 'BUY-TEST-TEST');
        expect(queryByCode).toHaveBeenCalledWith(ctx, 'BUY-TEST-TEST', expected, 'audit');
    });

    it('uses the ID Business client address only for an API key with mailbox read permission', async () => {
        const queryByCode = vi.fn().mockResolvedValue({ success: true });
        const resolver = new IcloudPublicResolver({ queryByCode } as unknown as IcloudPublicQueryService);
        const ctx = {
            req: {
                ip: '198.51.100.10',
                headers: {
                    'x-id-business-client-ip': '203.0.113.25',
                    'user-agent': 'id-business',
                },
            },
            session: { authenticationStrategy: 'apikey' },
            userHasPermissions: vi.fn().mockReturnValue(true),
        } as unknown as RequestContext;

        await resolver.icloudQueryMails(ctx, 'BUY-TEST-TEST');

        expect(queryByCode).toHaveBeenCalledWith(ctx, 'BUY-TEST-TEST', '203.0.113.25', 'id-business');
    });

    it.each([
        [{ authenticationStrategy: 'native' }, true, '203.0.113.25'],
        [{ authenticationStrategy: 'apikey' }, false, '203.0.113.25'],
        [{ authenticationStrategy: 'apikey' }, true, 'invalid, 203.0.113.25'],
    ])('ignores an untrusted ID Business address', async (session, permitted, forwardedClientIp) => {
        const queryByCode = vi.fn().mockResolvedValue({ success: true });
        const resolver = new IcloudPublicResolver({ queryByCode } as unknown as IcloudPublicQueryService);
        const ctx = {
            req: {
                ip: '198.51.100.10',
                headers: {
                    'x-id-business-client-ip': forwardedClientIp,
                    'user-agent': 'audit',
                },
            },
            session,
            userHasPermissions: vi.fn().mockReturnValue(permitted),
        } as unknown as RequestContext;

        await resolver.icloudQueryMails(ctx, 'BUY-TEST-TEST');

        expect(queryByCode).toHaveBeenCalledWith(ctx, 'BUY-TEST-TEST', '198.51.100.10', 'audit');
    });

    it.each([undefined, { headers: { 'x-forwarded-for': '203.0.113.99', 'x-real-ip': '203.0.113.98' } }])(
        'rejects a request without a framework or socket address',
        async req => {
            const queryByCode = vi.fn();
            const resolver = new IcloudPublicResolver({ queryByCode } as unknown as IcloudPublicQueryService);
            await expect(
                resolver.icloudQueryMails({ req } as unknown as RequestContext, 'BUY-TEST-TEST'),
            ).rejects.toBeInstanceOf(ForbiddenError);
            expect(queryByCode).not.toHaveBeenCalled();
        },
    );
});
