import { API_KEY_AUTH_STRATEGY_NAME, UserInputError } from '@vendure/core';
import { from, lastValueFrom } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
    parsed: {
        isGraphQL: true,
        req: {},
        info: { parentType: { name: 'Mutation' }, fieldName: 'updateManagedAdministrator' },
    },
    requestContext: {
        apiType: 'admin',
        activeUserId: 'actor-user',
        session: { authenticationStrategy: 'native' },
        channel: { code: '__default_channel__' },
        userHasPermissions: vi.fn().mockReturnValue(true),
    },
}));

vi.mock('@vendure/core', async importOriginal => ({
    ...(await importOriginal<typeof import('@vendure/core')>()),
    parseContext: () => state.parsed,
    internal_getRequestContext: () => state.requestContext,
}));

import { AdministratorAccessInterceptor } from './administrator-access.interceptor';

function invoke(
    field: string,
    args: Record<string, unknown>,
    value: Promise<unknown>,
    profile: { status: string; scope: string; authority: string; channelId: string | null } = {
        status: 'ACTIVE',
        scope: 'STORE',
        authority: 'ADMIN',
        channelId: 'store-1',
    },
    parentType = 'Mutation',
) {
    state.parsed.info.fieldName = field;
    state.parsed.info.parentType.name = parentType;
    const context = {
        getArgs: () => [null, args, { req: state.parsed.req }, state.parsed.info],
        getClass: () => class Resolver {},
        getHandler: () => () => undefined,
        getType: () => 'graphql',
    } as never;
    const access = {
        current: vi.fn().mockResolvedValue(profile),
    };
    const audit = { record: vi.fn().mockResolvedValue(undefined) };
    const next = { handle: vi.fn(() => from(value)) };
    const interceptor = new AdministratorAccessInterceptor(access as never, audit as never);
    return {
        run: async () => lastValueFrom(await interceptor.intercept(context, next)),
        access,
        audit,
        next,
    };
}

describe('administrator access failure audit', () => {
    beforeEach(() => {
        state.requestContext.session.authenticationStrategy = 'native';
        state.requestContext.channel.code = '__default_channel__';
        state.requestContext.userHasPermissions.mockReset().mockReturnValue(true);
    });

    it.each([
        ['icloudPrimaryAccounts', 'Query', 'ReadIcloudRelay'],
        ['createIcloudPrimaryAccount', 'Mutation', 'CreateIcloudRelay'],
        ['updateIcloudVirtualEmail', 'Mutation', 'UpdateIcloudRelay'],
        ['deleteIcloudMail', 'Mutation', 'DeleteIcloudRelay'],
    ])(
        'allows a dedicated API key to call %s without an employee profile',
        async (field, parentType, permission) => {
            state.requestContext.session.authenticationStrategy = API_KEY_AUTH_STRATEGY_NAME;
            const { run, access, next } = invoke(field, {}, Promise.resolve('ok'), undefined, parentType);
            await expect(run()).resolves.toBeTruthy();
            expect(state.requestContext.userHasPermissions).toHaveBeenCalledWith([permission]);
            expect(access.current).not.toHaveBeenCalled();
            expect(next.handle).toHaveBeenCalledOnce();
        },
    );

    it.each([
        ['activeChannel', 'Query', true, '__default_channel__'],
        ['icloudPrimaryAccounts', 'Query', false, '__default_channel__'],
        ['icloudPrimaryAccounts', 'Query', true, 'store-channel'],
    ])(
        'keeps administrator governance for %s outside the dedicated key scope',
        async (field, parentType, hasPermission, channelCode) => {
            state.requestContext.session.authenticationStrategy = API_KEY_AUTH_STRATEGY_NAME;
            state.requestContext.channel.code = channelCode;
            state.requestContext.userHasPermissions.mockReturnValue(hasPermission);
            const { run, access } = invoke(field, {}, Promise.resolve('unused'), undefined, parentType);
            access.current.mockRejectedValue(new Error('No administrator profile'));
            await expect(run()).rejects.toThrow('No administrator profile');
            expect(access.current).toHaveBeenCalledOnce();
        },
    );

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

    it('audits rejected mailbox role creation without recording the password', async () => {
        const error = new UserInputError('role creation failed');
        const { run, audit } = invoke('createMailboxIntegrationRole', {}, Promise.reject(error));
        await expect(run()).rejects.toBe(error);
        expect(audit.record).toHaveBeenCalledWith(
            state.requestContext,
            expect.objectContaining({ action: 'CREATE_MAILBOX_INTEGRATION_ROLE', result: 'FAILED' }),
        );
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

    it.each([
        'createAdministrator',
        'updateAdministrator',
        'assignRoleToAdministrator',
        'deleteAdministrator',
        'deleteAdministrators',
        'createRole',
        'updateRole',
        'deleteRole',
        'deleteRoles',
    ])('rejects legacy team mutation %s before it can change data', async field => {
        const { run, audit, next } = invoke(field, { ids: ['store-role'] }, Promise.resolve('unused'));
        await expect(run()).rejects.toThrow('受限管理接口');
        expect(next.handle).not.toHaveBeenCalled();
        expect(audit.record).toHaveBeenCalledWith(
            state.requestContext,
            expect.objectContaining({
                action: 'REJECT_LEGACY_TEAM_MUTATION',
                failureReason: 'LEGACY_TEAM_ENDPOINT_DISABLED',
            }),
        );
    });

    it('blocks store accounts from raw team queries without breaking platform dashboard queries', async () => {
        const platformAdministrator = {
            status: 'ACTIVE',
            scope: 'PLATFORM',
            authority: 'ADMIN',
            channelId: null,
        };
        for (const field of ['administrator', 'administrators', 'role', 'roles']) {
            const denied = invoke(field, {}, Promise.resolve('unused'), undefined, 'Query');
            await expect(denied.run()).rejects.toThrow('本店团队与岗位列表');
            expect(denied.next.handle).not.toHaveBeenCalled();

            const platform = invoke(field, {}, Promise.resolve('visible'), platformAdministrator, 'Query');
            await expect(platform.run()).resolves.toBeTruthy();
            expect(platform.next.handle).toHaveBeenCalledOnce();
        }
    });
});
