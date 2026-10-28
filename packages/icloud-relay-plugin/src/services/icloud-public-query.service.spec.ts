import { RequestContext, TransactionalConnection } from '@vendure/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RATE_LIMIT_LOCKOUT_MS } from '../constants';

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
            { id: 'm1', virtualEmailId: 'v1', bodyHtml: '<p>Historical public mail</p>' },
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
        expect(result.items[0].bodyHtml).toContain("default-src 'none'");
        expect(result.items[0].bodyHtml).toContain('<p>Historical public mail</p>');
        expect(mails[0].bodyHtml).toBe('<p>Historical public mail</p>');
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
        expect((await f.authorize()).error).toContain('秒后再试');
        expect(f.repos.IcloudVirtualEmail.findOne).toHaveBeenCalledTimes(5);
        expect(f.repos.IcloudQueryAuditLog.save.mock.calls.at(-1)[0].result).toBe('RATE_LIMITED');
    });
});

// E02: failed sources must expire and stay bounded without evicting effective lockouts.
describe('bounded public mail failed-source tracking', () => {
    const capacity = 10_000;
    const ctx = {} as RequestContext;
    const queryCode = 'BUY-AAAA-BBBB';
    const source = (index: number) => `2001:db8:${index.toString(16)}::1`;

    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-10-17T00:00:00Z'));
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    function fixture() {
        const repos = {
            IcloudQueryAuditLog: { save: vi.fn().mockResolvedValue(undefined) },
            IcloudVirtualEmail: { findOne: vi.fn().mockResolvedValue(null), update: vi.fn() },
            IcloudPrimaryAccount: { findOne: vi.fn().mockResolvedValue(null) },
            IcloudReceivedMail: { find: vi.fn().mockResolvedValue([]) },
        };
        const service = new IcloudPublicQueryService(
            {
                getRepository: (_ctx: unknown, entity: { name: keyof typeof repos }) => repos[entity.name],
            } as unknown as TransactionalConnection,
            new IcloudAccessCodeService(),
            new IcloudOtpExtractorService(),
        );
        const records = Reflect.get(service, 'failedAttempts') as Map<
            string,
            { count: number; lastAttemptAt: number }
        >;
        const authorize = (ip = source(0)) => service.authorizeQueryTarget(ctx, queryCode, ip);
        const read = (ip = source(0)) => service.queryByCode(ctx, queryCode, ip);
        const fill = async (count: number) => {
            for (let i = 0; i < count; i++) await authorize(source(i));
        };
        return { service, repos, records, authorize, read, fill };
    }

    it('expires sub-threshold failures before counting a later burst', async () => {
        const f = fixture();
        for (let i = 0; i < 4; i++) await f.authorize();
        vi.advanceTimersByTime(RATE_LIMIT_LOCKOUT_MS);
        for (let i = 0; i < 5; i++) expect((await f.authorize()).error).toContain('无效');
        expect((await f.authorize()).error).toContain('秒后再试');
        expect(f.repos.IcloudVirtualEmail.findOne).toHaveBeenCalledTimes(9);
    });

    it('reclaims expired one-off sources even when those addresses never return', async () => {
        const f = fixture();
        await f.fill(100);
        vi.advanceTimersByTime(RATE_LIMIT_LOCKOUT_MS);
        await f.authorize(source(100));
        expect(f.records.size).toBe(1);
        expect(f.records.has(source(0))).toBe(false);
        expect(f.records.has(source(100))).toBe(true);
    });

    it('keeps the fifth-failure lockout until its exact deadline without extending blocked requests', async () => {
        const f = fixture();
        for (let i = 0; i < 5; i++) await f.authorize();
        expect(await f.read()).toMatchObject({
            success: false,
            message: '查询过于频繁，请 60 秒后再试。',
            retryAfterSeconds: 60,
            items: [],
        });
        vi.advanceTimersByTime(20_001);
        expect(await f.authorize()).toEqual({
            error: '查询过于频繁，请 40 秒后再试。',
            retryAfterSeconds: 40,
        });
        vi.advanceTimersByTime(RATE_LIMIT_LOCKOUT_MS - 20_002);
        expect(await f.read()).toMatchObject({ retryAfterSeconds: 1 });
        expect(f.repos.IcloudReceivedMail.find).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(await f.authorize()).toEqual({ error: '无效的查询码，请检查后重试。' });
        expect(f.repos.IcloudVirtualEmail.findOne).toHaveBeenCalledTimes(6);
        expect(f.records.get(source(0))?.count).toBe(1);
    });

    it('keeps ordinary errors out of the invalid-code counter and clears failures on an empty successful query', async () => {
        const f = fixture();
        await f.authorize();
        await f.authorize();
        const buyer = { id: 'v1', aliasEmail: 'alias@example.test', primaryAccount: { status: 'ACTIVE' } };
        f.repos.IcloudVirtualEmail.findOne.mockResolvedValue({ ...buyer, status: 'DISABLED' });
        for (let i = 0; i < 5; i++) {
            const denied = await f.read();
            expect(denied.message).toContain('已禁用');
            expect(denied.retryAfterSeconds).toBeUndefined();
        }
        f.repos.IcloudVirtualEmail.findOne.mockResolvedValue({ ...buyer, codeExpiresAt: new Date(0) });
        expect((await f.read()).message).toContain('已过期');
        expect(f.records.get(source(0))?.count).toBe(2);
        f.repos.IcloudVirtualEmail.findOne.mockRejectedValueOnce(new Error('Database unavailable'));
        await expect(f.read()).rejects.toThrow('Database unavailable');
        expect(f.records.get(source(0))?.count).toBe(2);

        f.repos.IcloudVirtualEmail.findOne.mockResolvedValue(buyer);
        const result = await f.read();
        expect(result).toMatchObject({ success: true, totalEmails: 0, items: [] });
        expect(result.retryAfterSeconds).toBeUndefined();
        expect(f.records.has(source(0))).toBe(false);
    });

    it.each(['read', 'subscription'] as const)(
        'shares five invalid %s attempts with the other authorization entry',
        async entry => {
            const f = fixture();
            for (let i = 0; i < 5; i++) {
                if (entry === 'read') await f.read();
                else await f.authorize();
            }
            const denied = entry === 'read' ? (await f.authorize()).error : (await f.read()).message;
            expect(denied).toContain('秒后再试');
            expect(f.repos.IcloudVirtualEmail.findOne).toHaveBeenCalledTimes(5);
            expect(f.repos.IcloudQueryAuditLog.save.mock.calls.at(-1)?.[0].result).toBe('RATE_LIMITED');
            expect(f.repos.IcloudReceivedMail.find).not.toHaveBeenCalled();
        },
    );

    it('preserves lockouts at capacity, denies new sources, and allows a tracked valid owner to clear a slot', async () => {
        const f = fixture();
        await f.fill(capacity);
        for (let i = 0; i < 4; i++) await f.authorize(source(0));
        const lookupCount = f.repos.IcloudVirtualEmail.findOne.mock.calls.length;
        for (let i = capacity; i < capacity + 100; i++) {
            expect((await f.authorize(source(i))).error).toContain('秒后再试');
        }
        expect((await f.read(source(capacity))).message).toContain('秒后再试');
        expect((await f.authorize(source(0))).error).toContain('秒后再试');
        expect(f.records.size).toBe(capacity);
        expect(f.records.get(source(0))?.count).toBe(5);
        expect(f.repos.IcloudVirtualEmail.findOne).toHaveBeenCalledTimes(lookupCount);

        const buyer = { id: 'v1', aliasEmail: 'alias@example.test', primaryAccount: { status: 'ACTIVE' } };
        f.repos.IcloudVirtualEmail.findOne.mockResolvedValue(buyer);
        // Saturation also rejects a valid owner from a new source until a tracked slot is freed.
        expect((await f.authorize(source(capacity))).error).toContain('秒后再试');
        expect(f.repos.IcloudVirtualEmail.findOne).toHaveBeenCalledTimes(lookupCount);
        expect((await f.authorize(source(1))).virtual).toBe(buyer);
        expect(f.records.size).toBe(capacity - 1);
        expect((await f.authorize(source(capacity))).virtual).toBe(buyer);
        expect((await f.authorize(source(0))).error).toContain('秒后再试');

        vi.advanceTimersByTime(RATE_LIMIT_LOCKOUT_MS);
        f.repos.IcloudVirtualEmail.findOne.mockResolvedValue(null);
        expect((await f.authorize(source(capacity + 1))).error).toContain('无效');
        expect(f.records.size).toBe(1);
    });

    it('never exceeds capacity when distinct failed lookups finish concurrently', async () => {
        const f = fixture();
        await f.fill(capacity - 1);
        let release!: () => void;
        const lookup = new Promise<null>(resolve => {
            release = () => resolve(null);
        });
        f.repos.IcloudVirtualEmail.findOne.mockReturnValue(lookup);
        const pending = [f.authorize(source(capacity)), f.authorize(source(capacity + 1))];
        release();
        const results = await Promise.all(pending);
        expect(results.filter(result => result.retryAfterSeconds !== undefined)).toHaveLength(1);
        expect(results.filter(result => result.error?.includes('无效'))).toHaveLength(1);
        expect(f.records.size).toBe(capacity);
        expect(f.repos.IcloudQueryAuditLog.save.mock.calls.at(-1)?.[0].result).toBe('RATE_LIMITED');
    });

    it('does not extend an effective lock when an earlier concurrent failed lookup finishes late', async () => {
        const f = fixture();
        const releases: Array<() => void> = [];
        f.repos.IcloudVirtualEmail.findOne.mockImplementation(
            () =>
                new Promise<null>(resolve => {
                    releases.push(() => resolve(null));
                }),
        );
        const pending = Array.from({ length: 6 }, () => f.authorize());
        releases.slice(0, 5).forEach(release => release());
        await Promise.all(pending.slice(0, 5));
        vi.advanceTimersByTime(1_000);
        releases[5]();
        expect((await pending[5]).error).toContain('秒后再试');
        vi.advanceTimersByTime(RATE_LIMIT_LOCKOUT_MS - 1_000);
        f.repos.IcloudVirtualEmail.findOne.mockResolvedValue(null);
        expect((await f.authorize()).error).toContain('无效');
        expect(f.records.get(source(0))?.count).toBe(1);
    });

    it('bounds full-map scans and reclaims expired capacity for new sources', async () => {
        const f = fixture();
        await f.fill(capacity);
        const scans = vi.spyOn(f.records, Symbol.iterator);
        for (let i = 0; i < 100; i++) await f.authorize(source(capacity + i));
        expect(scans).not.toHaveBeenCalled();
        vi.advanceTimersByTime(60_000);
        for (let i = 0; i < 100; i++) await f.authorize(source(capacity + i));
        expect(scans).toHaveBeenCalledTimes(1);
        expect(f.records.size).toBe(100);
    });
});
