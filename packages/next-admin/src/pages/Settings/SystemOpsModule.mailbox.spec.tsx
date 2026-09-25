// @vitest-environment jsdom

import { print } from 'graphql';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmDialogContext } from '../../components/confirm-dialog-context';
import { CREATE_MAILBOX_INTEGRATION_ROLE_MUTATION } from '../../graphql/management.graphql';
import { SystemOpsModule } from './SystemOpsModule';
import { MAILBOX_INTEGRATION_PERMISSIONS, MAILBOX_INTEGRATION_ROLE_CODE } from './mailbox-integration-role';

const mocks = vi.hoisted(() => ({
    roleData: null as null | Record<string, unknown>,
    createMailboxRole: vi.fn(),
    updateApiKey: vi.fn(),
    confirm: vi.fn(),
}));

vi.mock('@apollo/client/react', () => ({
    useQuery: (document: { definitions: Array<{ kind: string; name?: { value?: string } }> }) => {
        const operation = document.definitions.find(definition => definition.kind === 'OperationDefinition')
            ?.name?.value;
        if (operation === 'NextAdminMailboxIntegrationAccess') {
            return {
                data: mocks.roleData,
                loading: false,
                error: undefined,
                refetch: vi.fn().mockResolvedValue({ data: mocks.roleData }),
            };
        }
        return {
            data: {
                jobs: { items: [], totalItems: 0 },
                jobQueues: [],
                scheduledTasks: [],
                settingsStoreFieldDefinitions: [],
                apiKeys: {
                    totalItems: 1,
                    items: [
                        {
                            id: 'key-1',
                            name: 'ID Business Vendure Mailbox',
                            lookupId: 'lookup-1',
                            lastUsedAt: null,
                            owner: null,
                            user: {
                                id: 'key-user',
                                roles: [{ id: 'old-role', code: 'old', description: '旧角色' }],
                            },
                            translations: [],
                        },
                    ],
                },
                activeAdministrator: { id: 'owner', user: { id: 'user', roles: [] } },
            },
            loading: false,
            error: undefined,
            refetch: vi.fn().mockResolvedValue({ data: { apiKeys: { totalItems: 1 } } }),
        };
    },
    useMutation: (document: { definitions: Array<{ kind: string; name?: { value?: string } }> }) => {
        const operation = document.definitions.find(definition => definition.kind === 'OperationDefinition')
            ?.name?.value;
        if (operation === 'NextAdminCreateMailboxIntegrationRole') {
            return [mocks.createMailboxRole, { loading: false }];
        }
        if (operation === 'NextAdminUpdateApiKey') {
            return [mocks.updateApiKey, { loading: false }];
        }
        return [vi.fn(), { loading: false }];
    },
}));
vi.mock('../../components/FeatureHelp', () => ({ FeatureHelpButton: () => null }));
vi.mock('../../hooks/use-admin-permissions', () => ({
    useAdminPermissions: () => ({ hasAnyPermission: () => true }),
}));
vi.mock('../../apollo', () => ({
    getServerHealthUrl: () => '',
    sensitiveActionContext: (password: string) => ({
        headers: { 'x-vendure-sensitive-action-password': password },
    }),
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    mocks.createMailboxRole
        .mockReset()
        .mockResolvedValue({ data: { createMailboxIntegrationRole: { id: 'mail-role' } } });
    mocks.updateApiKey.mockReset().mockResolvedValue({ data: { updateApiKey: { id: 'key-1' } } });
    mocks.confirm.mockReset().mockResolvedValue({ currentPassword: 'test-password' });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
});

afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
});

async function renderPage() {
    await act(async () => {
        root.render(
            <MemoryRouter initialEntries={['/?tab=api-keys']}>
                <ConfirmDialogContext.Provider value={mocks.confirm}>
                    <SystemOpsModule />
                </ConfirmDialogContext.Provider>
            </MemoryRouter>,
        );
    });
}

async function clickButton(label: string) {
    const button = [...container.querySelectorAll('button')].find(item => item.textContent?.includes(label));
    expect(button, `missing button: ${label}`).toBeDefined();
    await act(async () => (button as HTMLButtonElement).click());
}

describe('mailbox API key recovery', () => {
    it('uses the restricted mailbox role endpoint instead of the blocked legacy role endpoint', () => {
        const operation = print(CREATE_MAILBOX_INTEGRATION_ROLE_MUTATION);
        expect(operation).toContain('createMailboxIntegrationRole');
        expect(operation).not.toContain('createRole(');
    });

    it('creates a default-channel role with only mailbox permissions', async () => {
        mocks.roleData = {
            activeChannel: { id: 'default-channel', code: '__default_channel__' },
            roles: { totalItems: 0, items: [] },
        };
        await renderPage();
        await clickButton('创建邮箱专用角色');
        expect(mocks.createMailboxRole).toHaveBeenCalledWith({
            context: { headers: { 'x-vendure-sensitive-action-password': 'test-password' } },
        });
    });

    it('replaces every old key role with the dedicated mailbox role', async () => {
        mocks.roleData = {
            activeChannel: { id: 'default-channel', code: '__default_channel__' },
            roles: {
                totalItems: 1,
                items: [
                    {
                        id: 'mail-role',
                        code: MAILBOX_INTEGRATION_ROLE_CODE,
                        description: '邮箱专用',
                        permissions: ['Authenticated', ...MAILBOX_INTEGRATION_PERMISSIONS],
                        channels: [{ id: 'default-channel', code: '__default_channel__' }],
                    },
                ],
            },
        };
        await renderPage();
        await clickButton('设为邮箱专用密钥');
        expect(mocks.updateApiKey).toHaveBeenCalledWith({
            variables: { input: { id: 'key-1', roleIds: ['mail-role'] } },
            context: { headers: { 'x-vendure-sensitive-action-password': 'test-password' } },
        });
    });

    it('hides the key action when the role has extra permissions', async () => {
        mocks.roleData = {
            activeChannel: { id: 'default-channel', code: '__default_channel__' },
            roles: {
                totalItems: 1,
                items: [
                    {
                        id: 'mail-role',
                        code: MAILBOX_INTEGRATION_ROLE_CODE,
                        permissions: ['Authenticated', ...MAILBOX_INTEGRATION_PERMISSIONS, 'ReadOrder'],
                        channels: [{ id: 'default-channel', code: '__default_channel__' }],
                    },
                ],
            },
        };
        await renderPage();
        expect(container.textContent).toContain('同名角色的权限或渠道不符合专用要求');
        expect(container.textContent).not.toContain('设为邮箱专用密钥');
        expect(mocks.updateApiKey).not.toHaveBeenCalled();
    });
});
