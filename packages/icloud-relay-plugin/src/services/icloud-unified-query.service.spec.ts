import type { RequestContext, TransactionalConnection } from '@vendure/core';
import { describe, expect, it, vi } from 'vitest';

import { IcloudManagedMailboxClient } from './icloud-managed-mailbox.client';
import { IcloudPublicQueryService } from './icloud-public-query.service';
import { IcloudUnifiedQueryService } from './icloud-unified-query.service';

function fixture(enabled = true, localMatch: unknown = null) {
    const localResult = { success: true, totalEmails: 0, items: [], targetType: 'VIRTUAL' };
    const managedResult = { success: true, totalEmails: 0, items: [], targetType: 'MANAGED' };
    const local = { queryByCode: vi.fn().mockResolvedValue(localResult) };
    const managed = { enabled, query: vi.fn().mockResolvedValue(managedResult) };
    const findOne = vi.fn().mockResolvedValue(localMatch);
    const connection = { getRepository: vi.fn(() => ({ findOne })) };
    const service = new IcloudUnifiedQueryService(
        connection as unknown as TransactionalConnection,
        local as unknown as IcloudPublicQueryService,
        managed as unknown as IcloudManagedMailboxClient,
    );
    return { service, local, managed, connection, findOne, localResult, managedResult };
}

describe('unified mailbox query routing', () => {
    it.each(['BUY-TEST-TEST', 'MSTR-TEST-TEST'])(
        'preserves the existing authorization path for %s',
        async code => {
            const f = fixture();
            const ctx = {} as RequestContext;
            expect(await f.service.queryByCode(ctx, code, '127.0.0.1', 'fixture')).toBe(f.localResult);
            expect(f.local.queryByCode).toHaveBeenCalledWith(ctx, code, '127.0.0.1', 'fixture');
            expect(f.managed.query).not.toHaveBeenCalled();
            expect(f.connection.getRepository).not.toHaveBeenCalled();
        },
    );

    it('routes a workspace buyer code once, preserving case and avoiding a proxy loop', async () => {
        const f = fixture();
        const code = 'AbCdEfGhJkMnPqRsTuV2';
        expect(await f.service.queryByCode({} as RequestContext, ` ${code} `, '127.0.0.1')).toBe(
            f.managedResult,
        );
        expect(f.managed.query).toHaveBeenCalledExactlyOnceWith(code);
        expect(f.local.queryByCode).not.toHaveBeenCalled();
    });

    it('keeps custom local codes on the original disabled/expiry/rate-limit path', async () => {
        const f = fixture(true, { id: 'local-account' });
        expect(await f.service.queryByCode({} as RequestContext, 'CustomLocalCode', '127.0.0.1')).toBe(
            f.localResult,
        );
        expect(f.managed.query).not.toHaveBeenCalled();
    });

    it('keeps the original behavior until the external endpoint is configured', async () => {
        const f = fixture(false);
        expect(await f.service.queryByCode({} as RequestContext, 'AbCdEfGhJkMnPqRsTuV2', '127.0.0.1')).toBe(
            f.localResult,
        );
        expect(f.connection.getRepository).not.toHaveBeenCalled();
    });
});
