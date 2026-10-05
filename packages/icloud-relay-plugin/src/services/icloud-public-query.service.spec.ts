import { RequestContext, TransactionalConnection } from '@vendure/core';
import { describe, expect, it, vi } from 'vitest';

import { IcloudAccessCodeService } from './icloud-access-code.service';
import { IcloudOtpExtractorService } from './icloud-otp-extractor.service';
import { IcloudPublicQueryService } from './icloud-public-query.service';

describe('public mail recipient mapping', () => {
    it('returns stable alias IDs and the actual masked recipient for master queries', async () => {
        const virtuals = [
            { id: 'v1', aliasEmail: 'alias-one@example.com' },
            { id: 'v2', aliasEmail: 'alias-two@example.com' },
        ];
        const mails = [
            { id: 'm1', virtualEmailId: 'v1' },
            { id: 'm2', virtualEmailId: 'v2' },
            { id: 'm3', virtualEmailId: null },
        ];
        const repos: Record<string, unknown> = {
            IcloudQueryAuditLog: { save: vi.fn() },
            IcloudVirtualEmail: {
                findOne: vi.fn().mockResolvedValue(null),
                find: vi.fn().mockResolvedValue(virtuals),
            },
            IcloudPrimaryAccount: {
                findOne: vi.fn().mockResolvedValue({ id: 'p1', email: 'owner@example.com' }),
                update: vi.fn(),
            },
            IcloudReceivedMail: { find: vi.fn().mockResolvedValue(mails) },
        };
        const connection = { getRepository: (_ctx: unknown, entity: { name: string }) => repos[entity.name] };
        const service = new IcloudPublicQueryService(
            connection as unknown as TransactionalConnection,
            new IcloudAccessCodeService(),
            new IcloudOtpExtractorService(),
        );
        const result = await service.queryByCode({} as RequestContext, 'MSTR-TEST-TEST', '127.0.0.1');
        expect(result.items.map(item => [item.virtualEmailId, item.targetEmail])).toEqual([
            ['v1', 'ali***@example.com'],
            ['v2', 'ali***@example.com'],
            [null, 'own***@example.com'],
        ]);
        expect(result.virtualEmailsList?.map(item => item.id)).toEqual(['v1', 'v2']);
    });
});

describe('public mail verification codes', () => {
    it.each(['PRIMARY', 'VIRTUAL'])(
        'corrects historical codes for %s queries without rewriting mail',
        async target => {
            const subject = 'Your temporary ChatGPT verification code';
            const mails = [
                {
                    id: 'm1',
                    virtualEmailId: 'v1',
                    subject,
                    bodyText: 'ChatGPT\nEnter this temporary verification code to continue:\n482913',
                    extractedCode: 'ChatGPT',
                },
                {
                    id: 'm2',
                    virtualEmailId: 'v1',
                    subject,
                    bodyText: 'ChatGPT',
                    extractedCode: 'ChatGPT',
                },
            ];
            const mailRepo = { find: vi.fn().mockResolvedValue(mails), save: vi.fn(), update: vi.fn() };
            const repos: Record<string, unknown> = {
                IcloudQueryAuditLog: { save: vi.fn() },
                IcloudVirtualEmail: {
                    findOne: vi
                        .fn()
                        .mockResolvedValue(
                            target === 'VIRTUAL' ? { id: 'v1', aliasEmail: 'alias@example.com' } : null,
                        ),
                    find: vi.fn().mockResolvedValue([]),
                    update: vi.fn(),
                },
                IcloudPrimaryAccount: {
                    findOne: vi.fn().mockResolvedValue({ id: 'p1', email: 'owner@example.com' }),
                    update: vi.fn(),
                },
                IcloudReceivedMail: mailRepo,
            };
            const connection = {
                getRepository: (_ctx: unknown, entity: { name: string }) => repos[entity.name],
            };
            const service = new IcloudPublicQueryService(
                connection as unknown as TransactionalConnection,
                new IcloudAccessCodeService(),
                new IcloudOtpExtractorService(),
            );

            const result = await service.queryByCode({} as RequestContext, 'TEST-QUERY', '127.0.0.1');

            expect(result.success).toBe(true);
            expect(result.targetType).toBe(target);
            expect(result.items.map(item => item.extractedCode)).toEqual(['482913', null]);
            expect(mails.map(mail => mail.extractedCode)).toEqual(['ChatGPT', 'ChatGPT']);
            expect(mailRepo.save).not.toHaveBeenCalled();
            expect(mailRepo.update).not.toHaveBeenCalled();
        },
    );
});

describe('shared public mail authorization', () => {
    function fixture(virtual: unknown = null, primary: unknown = null) {
        const repos: Record<string, any> = {
            IcloudQueryAuditLog: { save: vi.fn() },
            IcloudVirtualEmail: { findOne: vi.fn().mockResolvedValue(virtual) },
            IcloudPrimaryAccount: { findOne: vi.fn().mockResolvedValue(primary) },
            IcloudReceivedMail: { find: vi.fn() },
        };
        const service = new IcloudPublicQueryService(
            { getRepository: (_ctx: unknown, entity: { name: string }) => repos[entity.name] } as never,
            new IcloudAccessCodeService(),
            new IcloudOtpExtractorService(),
        );
        return {
            service,
            repos,
            authorize: () =>
                service.authorizeQueryTarget({} as RequestContext, ' buy-aaaa-bbbb ', '127.0.0.1'),
        };
    }
    it('authorizes the exact buyer without reading any mails or the primary query code', async () => {
        const buyer = { id: 'v1', aliasEmail: 'alias@example.test', primaryAccount: { status: 'ACTIVE' } };
        const f = fixture(buyer);
        expect((await f.authorize()).virtual).toBe(buyer);
        expect(f.repos.IcloudVirtualEmail.findOne.mock.calls[0][0].where).toEqual({
            buyerQueryCode: 'BUY-AAAA-BBBB',
        });
        expect(f.repos.IcloudPrimaryAccount.findOne).not.toHaveBeenCalled();
        expect(f.repos.IcloudReceivedMail.find).not.toHaveBeenCalled();
    });
    it.each([
        [{ id: 'v1', status: 'DISABLED' }, null, 'DISABLED'],
        [{ id: 'v1', primaryAccount: { status: 'DISABLED' } }, null, 'DISABLED'],
        [null, { id: 'p1', status: 'DISABLED' }, 'DISABLED'],
        [{ id: 'v1', codeExpiresAt: new Date(0) }, null, 'EXPIRED'],
        [null, { id: 'p1', codeExpiresAt: new Date(0) }, 'EXPIRED'],
    ])(
        'applies the same expiry and disabled checks to reads and subscriptions',
        async (virtual, primary, result) => {
            const f = fixture(virtual, primary);
            expect((await f.authorize()).error).toBeTruthy();
            expect(f.repos.IcloudQueryAuditLog.save.mock.calls[0][0].result).toBe(result);
            expect(f.repos.IcloudReceivedMail.find).not.toHaveBeenCalled();
        },
    );
    it('shares invalid-code lockout and records rate-limit audit entries', async () => {
        const f = fixture();
        for (let i = 0; i < 5; i++) await f.authorize();
        expect((await f.authorize()).error).toContain('15');
        expect(f.repos.IcloudVirtualEmail.findOne).toHaveBeenCalledTimes(5);
        expect(f.repos.IcloudQueryAuditLog.save.mock.calls.at(-1)[0].result).toBe('RATE_LIMITED');
    });
});
