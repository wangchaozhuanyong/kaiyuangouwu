import { API_KEY_AUTH_STRATEGY_NAME, UserInputError } from '@vendure/core';
import { defer, from, lastValueFrom } from 'rxjs';
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
import { MerchantCatalogAccessInterceptor } from './merchant-catalog-access.interceptor';
import { MerchantCatalogAccessService } from './merchant-catalog-access.service';

const mailboxRootPermissions = [
    ['Query', 'icloudPrimaryAccounts', 'ReadIcloudRelay'],
    ['Query', 'icloudPrimaryAccount', 'ReadIcloudRelay'],
    ['Query', 'icloudVirtualEmails', 'ReadIcloudRelay'],
    ['Query', 'icloudVirtualEmail', 'ReadIcloudRelay'],
    ['Query', 'icloudReceivedMails', 'ReadIcloudRelay'],
    ['Mutation', 'createIcloudPrimaryAccount', 'CreateIcloudRelay'],
    ['Mutation', 'createIcloudVirtualEmail', 'CreateIcloudRelay'],
    ['Mutation', 'batchCreateIcloudVirtualEmails', 'CreateIcloudRelay'],
    ['Mutation', 'reconcileIcloudMailHistory', 'UpdateIcloudRelay'],
    ['Mutation', 'updateIcloudPrimaryAccount', 'UpdateIcloudRelay'],
    ['Mutation', 'testIcloudConnection', 'UpdateIcloudRelay'],
    ['Mutation', 'syncIcloudAccount', 'UpdateIcloudRelay'],
    ['Mutation', 'resetIcloudMasterCode', 'UpdateIcloudRelay'],
    ['Mutation', 'updateIcloudVirtualEmail', 'UpdateIcloudRelay'],
    ['Mutation', 'resetIcloudVirtualEmailCode', 'UpdateIcloudRelay'],
    ['Mutation', 'reassignIcloudMail', 'UpdateIcloudRelay'],
    ['Mutation', 'deleteIcloudPrimaryAccount', 'DeleteIcloudRelay'],
    ['Mutation', 'deleteIcloudVirtualEmail', 'DeleteIcloudRelay'],
    ['Mutation', 'deleteIcloudMail', 'DeleteIcloudRelay'],
] as const;

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
        currentForChannel: vi.fn().mockResolvedValue(profile),
    };
    const audit = { record: vi.fn().mockResolvedValue(undefined) };
    const next = { handle: vi.fn(() => from(value)) };
    const interceptor = new AdministratorAccessInterceptor(access as never, audit as never);
    return {
        run: async () => lastValueFrom(await interceptor.intercept(context, next)),
        access,
        audit,
        next,
        context,
        interceptor,
    };
}

function invokeMailboxChain(field: string, parentType = 'Query') {
    const first = invoke(field, {}, Promise.resolve('ok'), undefined, parentType);
    first.access.currentForChannel.mockRejectedValue(new Error('Machine users have no employee profile'));
    const connection = { getRepository: vi.fn() };
    const merchant = new MerchantCatalogAccessInterceptor(
        new MerchantCatalogAccessService(connection as never, {} as never, {} as never),
    );
    const nextGate = {
        handle: vi.fn(() =>
            defer(async () => lastValueFrom(await merchant.intercept(first.context, first.next))),
        ),
    };
    return {
        ...first,
        connection,
        nextGate,
        runChain: async () => lastValueFrom(await first.interceptor.intercept(first.context, nextGate)),
    };
}

describe('administrator access failure audit', () => {
    it.each(mailboxRootPermissions)(
        'passes exact %s.%s permission through both gates',
        async (parentType, fieldName, permission) => {
            state.requestContext.session.authenticationStrategy = API_KEY_AUTH_STRATEGY_NAME;
            state.requestContext.userHasPermissions.mockImplementation((requested: string[]) =>
                requested.includes(permission),
            );
            const { runChain, access, next, nextGate, connection } = invokeMailboxChain(
                fieldName,
                parentType,
            );
            await expect(runChain()).resolves.toBe('ok');
            expect(state.requestContext.userHasPermissions).toHaveBeenCalledWith([permission]);
            expect(access.currentForChannel).not.toHaveBeenCalled();
            expect(nextGate.handle).toHaveBeenCalledOnce();
            expect(next.handle).toHaveBeenCalledOnce();
            expect(connection.getRepository).not.toHaveBeenCalled();
        },
    );

    it.each(
        [
            ['Query', 'icloudPrimaryAccounts', 'ReadIcloudRelay'],
            ['Mutation', 'createIcloudPrimaryAccount', 'CreateIcloudRelay'],
            ['Mutation', 'updateIcloudVirtualEmail', 'UpdateIcloudRelay'],
            ['Mutation', 'deleteIcloudMail', 'DeleteIcloudRelay'],
        ].flatMap(([parentType, fieldName, requiredPermission]) =>
            ['ReadIcloudRelay', 'CreateIcloudRelay', 'UpdateIcloudRelay', 'DeleteIcloudRelay']
                .filter(permission => permission !== requiredPermission)
                .map(grantedPermission => ({ parentType, fieldName, grantedPermission })),
        ),
    )(
        'rejects $parentType.$fieldName with only $grantedPermission before either service runs',
        async ({ parentType, fieldName, grantedPermission }) => {
            state.requestContext.session.authenticationStrategy = API_KEY_AUTH_STRATEGY_NAME;
            state.requestContext.userHasPermissions.mockImplementation((requested: string[]) =>
                requested.includes(grantedPermission),
            );
            const { runChain, access, next, nextGate, connection } = invokeMailboxChain(
                fieldName,
                parentType,
            );
            await expect(runChain()).rejects.toThrow('Machine users have no employee profile');
            expect(access.currentForChannel).toHaveBeenCalledOnce();
            expect(nextGate.handle).not.toHaveBeenCalled();
            expect(next.handle).not.toHaveBeenCalled();
            expect(connection.getRepository).not.toHaveBeenCalled();
        },
    );

    beforeEach(() => {
        state.requestContext.session.authenticationStrategy = 'native';
        state.requestContext.channel.code = '__default_channel__';
        state.requestContext.userHasPermissions.mockReset().mockReturnValue(true);
    });

    it.each(['icloudPrimaryAccounts', 'icloudVirtualEmails'])(
        'passes a read-only mailbox API key through both authorization gates for %s',
        async field => {
            state.requestContext.session.authenticationStrategy = API_KEY_AUTH_STRATEGY_NAME;
            state.requestContext.userHasPermissions.mockImplementation((permissions: string[]) =>
                permissions.includes('ReadIcloudRelay'),
            );
            const { runChain, access, next, nextGate, connection } = invokeMailboxChain(field);
            await expect(runChain()).resolves.toBe('ok');
            expect(access.currentForChannel).not.toHaveBeenCalled();
            expect(nextGate.handle).toHaveBeenCalledOnce();
            expect(next.handle).toHaveBeenCalledOnce();
            expect(connection.getRepository).not.toHaveBeenCalled();
        },
    );

    it.each(['adminBeginLogin', 'adminCompleteTwoFactorLogin'])(
        'allows public %s without loading an old administrator profile',
        async field => {
            const { run, access, next } = invoke(field, {}, Promise.resolve('ok'));
            access.currentForChannel.mockRejectedValue(new Error('stale session profile'));
            await expect(run()).resolves.toBe('ok');
            expect(access.currentForChannel).not.toHaveBeenCalled();
            expect(next.handle).toHaveBeenCalledOnce();
        },
    );

    it.each([
        ['icloudPrimaryAccounts', 'Query', 'ReadIcloudRelay'],
        ['createIcloudPrimaryAccount', 'Mutation', 'CreateIcloudRelay'],
        ['updateIcloudVirtualEmail', 'Mutation', 'UpdateIcloudRelay'],
        ['deleteIcloudMail', 'Mutation', 'DeleteIcloudRelay'],
    ])(
        'allows a dedicated API key to call %s without an employee profile',
        async (field, parentType, permission) => {
            state.requestContext.session.authenticationStrategy = API_KEY_AUTH_STRATEGY_NAME;
            state.requestContext.userHasPermissions.mockImplementation((requested: string[]) =>
                requested.includes(permission),
            );
            const { run, access, next } = invoke(field, {}, Promise.resolve('ok'), undefined, parentType);
            await expect(run()).resolves.toBeTruthy();
            expect(state.requestContext.userHasPermissions).toHaveBeenCalledWith([permission]);
            expect(access.currentForChannel).not.toHaveBeenCalled();
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
            access.currentForChannel.mockRejectedValue(new Error('No administrator profile'));
            await expect(run()).rejects.toThrow('No administrator profile');
            expect(access.currentForChannel).toHaveBeenCalledOnce();
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
