import { RequestContext, TransactionalConnection, UserInputError } from '@vendure/core';
import { describe, expect, it, vi } from 'vitest';

import { IcloudAccessCodeService } from './icloud-access-code.service';
import { IcloudAdminService } from './icloud-admin.service';
import { IcloudCipherService } from './icloud-cipher.service';
import { IcloudImapSyncService } from './icloud-imap-sync.service';
import { IcloudMailHistoryService } from './icloud-mail-history.service';

describe('batch virtual mailbox import', () => {
    it('parses the documented separators, preserves notes and reports invalid or duplicate rows', async () => {
        const save = vi.fn().mockImplementation(item => Promise.resolve({ ...item, id: item.aliasEmail }));
        const history = { reconcileCreated: vi.fn() };
        const repos: Record<string, unknown> = {
            IcloudPrimaryAccount: {
                findOne: vi.fn().mockResolvedValue({ id: 'p1', codeResetIntervalDays: 30 }),
            },
            IcloudVirtualEmail: {
                save,
                findOne: vi.fn(({ where }) =>
                    Promise.resolve(where.aliasEmail === 'duplicate@example.com' ? { id: 'existing' } : null),
                ),
            },
        };
        const connection = {
            rawConnection: { options: { type: 'sqljs' } },
            withTransaction: async (ctx: RequestContext, work: (ctx: RequestContext) => Promise<unknown>) =>
                work(ctx),
            getRepository: (_ctx: unknown, entity: { name: string }) => repos[entity.name],
        };
        const service = new IcloudAdminService(
            connection as unknown as TransactionalConnection,
            {} as IcloudCipherService,
            new IcloudAccessCodeService(),
            {} as IcloudImapSyncService,
            history as unknown as IcloudMailHistoryService,
        );
        const result = await service.batchCreateVirtualEmails({} as RequestContext, {
            primaryAccountId: 'p1',
            rawInput:
                'FIRST@example.com  备注 一\nsecond@example.com,备注,二\nthird@example.com\t备注三\nfourth@example.com|备注四\nbare@example.com\ninvalid@\nduplicate@example.com',
        });
        expect(history.reconcileCreated).toHaveBeenCalledTimes(1);
        expect(history.reconcileCreated.mock.calls[0][2]).toHaveLength(5);
        expect(result).toMatchObject({ createdCount: 5, skippedCount: 2 });
        expect(result.errors).toHaveLength(2);
        expect(save.mock.calls.map(([item]) => [item.aliasEmail, item.note])).toEqual([
            ['first@example.com', '备注 一'],
            ['second@example.com', '备注,二'],
            ['third@example.com', '备注三'],
            ['fourth@example.com', '备注四'],
            ['bare@example.com', null],
        ]);
    });
});

function mutationService(options: {
    mail: { id: string; primaryAccountId: string; virtualEmailId: string | null } | null;
    virtual?: { id: string; primaryAccountId: string } | null;
}) {
    const execute = vi.fn().mockResolvedValue(undefined);
    const queryBuilder: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const method of ['subQuery', 'select', 'from', 'where', 'update', 'set']) {
        queryBuilder[method] = vi.fn(() => queryBuilder);
    }
    queryBuilder.getQuery = vi.fn(() => '(SELECT COUNT(*))');
    queryBuilder.execute = execute;
    const mailRepo = {
        findOne: vi.fn().mockResolvedValue(options.mail),
        save: vi.fn().mockImplementation(mail => Promise.resolve({ ...mail })),
        delete: vi.fn().mockResolvedValue({ affected: 1 }),
    };
    const virtualRepo = {
        findOne: vi.fn().mockResolvedValue(options.virtual ?? null),
        createQueryBuilder: vi.fn(() => queryBuilder),
    };
    const primaryRepo = {
        findOne: vi.fn().mockResolvedValue({ id: options.mail?.primaryAccountId }),
    };
    const repos: Record<string, unknown> = {
        IcloudPrimaryAccount: primaryRepo,
        IcloudReceivedMail: mailRepo,
        IcloudVirtualEmail: virtualRepo,
    };
    const connection = {
        rawConnection: { options: { type: 'sqljs' } },
        withTransaction: async (ctx: RequestContext, work: (ctx: RequestContext) => Promise<unknown>) =>
            work(ctx),
        getRepository: (_ctx: unknown, entity: { name: string }) => repos[entity.name],
    };
    const service = new IcloudAdminService(
        connection as unknown as TransactionalConnection,
        {} as IcloudCipherService,
        new IcloudAccessCodeService(),
        {} as IcloudImapSyncService,
        {} as IcloudMailHistoryService,
    );
    return { execute, mailRepo, service, virtualRepo };
}

describe('received mail ownership integrity', () => {
    it('rejects assigning a mail to a virtual mailbox owned by another primary account', async () => {
        const { mailRepo, service } = mutationService({
            mail: { id: 'mail-1', primaryAccountId: 'primary-1', virtualEmailId: 'alias-old' },
            virtual: { id: 'alias-other', primaryAccountId: 'primary-2' },
        });

        await expect(
            service.reassignMail({} as RequestContext, 'mail-1', 'alias-other'),
        ).rejects.toBeInstanceOf(UserInputError);
        expect(mailRepo.save).not.toHaveBeenCalled();
    });

    it('recounts both the previous and target virtual mailbox after reassignment', async () => {
        const { execute, mailRepo, service } = mutationService({
            mail: { id: 'mail-1', primaryAccountId: 'primary-1', virtualEmailId: 'alias-old' },
            virtual: { id: 'alias-new', primaryAccountId: 'primary-1' },
        });

        await service.reassignMail({} as RequestContext, 'mail-1', 'alias-new');

        expect(mailRepo.save).toHaveBeenCalledWith(expect.objectContaining({ virtualEmailId: 'alias-new' }));
        expect(execute).toHaveBeenCalledTimes(2);
    });

    it('recounts the former virtual mailbox after deleting an assigned mail', async () => {
        const { execute, mailRepo, service } = mutationService({
            mail: { id: 'mail-1', primaryAccountId: 'primary-1', virtualEmailId: 'alias-old' },
        });

        await service.deleteMail({} as RequestContext, 'mail-1');

        expect(mailRepo.delete).toHaveBeenCalledWith({ id: 'mail-1' });
        expect(execute).toHaveBeenCalledOnce();
    });
});
