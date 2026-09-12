import { RequestContext, TransactionalConnection } from '@vendure/core';
import { describe, expect, it, vi } from 'vitest';

import { IcloudAccessCodeService } from './icloud-access-code.service';
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
