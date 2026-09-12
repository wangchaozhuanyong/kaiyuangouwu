import { RequestContext, TransactionalConnection } from '@vendure/core';
import { describe, expect, it, vi } from 'vitest';

import { IcloudAccessCodeService } from './icloud-access-code.service';
import { IcloudAdminService } from './icloud-admin.service';
import { IcloudCipherService } from './icloud-cipher.service';
import { IcloudImapSyncService } from './icloud-imap-sync.service';

describe('batch virtual mailbox import', () => {
    it('parses the documented separators, preserves notes and reports invalid or duplicate rows', async () => {
        const save = vi.fn();
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
        const connection = { getRepository: (_ctx: unknown, entity: { name: string }) => repos[entity.name] };
        const service = new IcloudAdminService(
            connection as unknown as TransactionalConnection,
            {} as IcloudCipherService,
            new IcloudAccessCodeService(),
            {} as IcloudImapSyncService,
        );
        const result = await service.batchCreateVirtualEmails({} as RequestContext, {
            primaryAccountId: 'p1',
            rawInput:
                'FIRST@example.com  备注 一\nsecond@example.com,备注,二\nthird@example.com\t备注三\nfourth@example.com|备注四\nbare@example.com\ninvalid@\nduplicate@example.com',
        });
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
