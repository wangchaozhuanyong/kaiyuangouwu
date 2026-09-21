import { UserInputError } from '@vendure/core';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
    parsed: {
        isGraphQL: true,
        req: {},
        info: { parentType: { name: 'Mutation' }, fieldName: 'updateManagedAdministrator' },
    },
    requestContext: { apiType: 'admin', activeUserId: 'actor-user' },
}));

vi.mock('@vendure/core', async importOriginal => ({
    ...(await importOriginal<typeof import('@vendure/core')>()),
    parseContext: () => state.parsed,
    internal_getRequestContext: () => state.requestContext,
}));

import { AdministratorAccessInterceptor } from './administrator-access.interceptor';

function invoke(field: string, args: Record<string, unknown>, value: Promise<unknown>) {
    state.parsed.info.fieldName = field;
    const context = {
        getArgs: () => [null, args, { req: state.parsed.req }, state.parsed.info],
        getClass: () => class Resolver {},
        getHandler: () => () => undefined,
        getType: () => 'graphql',
    } as never;
    const access = {
        current: vi.fn().mockResolvedValue({
            status: 'ACTIVE',
            scope: 'STORE',
            channelId: 'store-1',
        }),
    };
    const audit = { record: vi.fn().mockResolvedValue(undefined) };
    const next = { handle: vi.fn(() => of(value)) };
    const interceptor = new AdministratorAccessInterceptor(access as never, audit as never);
    return { run: () => interceptor.intercept(context, next), audit, next };
}

describe('administrator access failure audit', () => {
    it('records failed managed mutations after rejection without retaining secrets', async () => {
        const error = new UserInputError('password=private-value is invalid');
        const { run, audit } = invoke(
            'updateManagedAdministrator',
            { input: { id: 'target-1', password: 'private-value' } },
            Promise.reject(error),
        );
        await expect(run()).rejects.toBe(error);
        expect(audit.record).toHaveBeenCalledWith(
            state.requestContext,
            expect.objectContaining({
                action: 'UPDATE_MANAGED_ADMINISTRATOR',
                targetAdministratorId: 'target-1',
                channelId: 'store-1',
                result: 'FAILED',
                failureReason: 'INVALID_INPUT',
            }),
        );
        expect(JSON.stringify(audit.record.mock.calls)).not.toContain('private-value');
    });

    it('does not add a failure entry for a successful managed mutation', async () => {
        const { run, audit } = invoke(
            'createManagedRole',
            { input: { code: 'store-role' } },
            Promise.resolve('ok'),
        );
        await expect(run()).resolves.toBe('ok');
        expect(audit.record).not.toHaveBeenCalled();
    });

    it('records rejected legacy account mutation entry points', async () => {
        const { run, audit, next } = invoke('createAdministrator', {}, Promise.resolve('unused'));
        await expect(run()).rejects.toThrow('受限管理接口');
        expect(next.handle).not.toHaveBeenCalled();
        expect(audit.record).toHaveBeenCalledWith(
            state.requestContext,
            expect.objectContaining({
                action: 'REJECT_LEGACY_TEAM_MUTATION',
                result: 'FAILED',
                failureReason: 'LEGACY_TEAM_ENDPOINT_DISABLED',
            }),
        );
    });
});
