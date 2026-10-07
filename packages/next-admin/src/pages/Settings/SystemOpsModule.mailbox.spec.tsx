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
    emptyApiKeys: false,
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
                    totalItems: mocks.emptyApiKeys ? 0 : 1,
                    items: mocks.emptyApiKeys
                        ? []
                        : [
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
    mocks.emptyApiKeys = false;
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

async function renderPage(tab = 'api-keys') {
    await act(async () => {
        root.render(
            <MemoryRouter initialEntries={[`/?tab=${tab}`]}>
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
    it.each([
        ['api-keys', '当前页没有 API 密钥'],
        ['jobs', '当前条件下没有任务记录'],
        ['schedules', '服务端没有注册定时任务'],
    ])('keeps the %s empty state outside the horizontally scrolling table', async (tab, message) => {
        mocks.emptyApiKeys = true;
        await renderPage(tab);
        const emptyMessage = [...container.querySelectorAll('div')].find(
            element => element.textContent?.trim() === message && !element.children.length,
        );
        expect(emptyMessage).toBeDefined();
        expect(emptyMessage?.closest('.admin-comparison-scroll')).toBeNull();
        expect(emptyMessage?.closest('table')).toBeNull();
        expect(container.querySelectorAll('tbody tr')).toHaveLength(0);
        expect(mocks.updateApiKey).not.toHaveBeenCalled();
        expect(mocks.createMailboxRole).not.toHaveBeenCalled();
    });

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
        await clickButton('操作');
        await clickButton('设为邮箱专用密钥');
        expect(mocks.updateApiKey).toHaveBeenCalledWith({
            variables: { input: { id: 'key-1', roleIds: ['mail-role'] } },
            context: { headers: { 'x-vendure-sensitive-action-password': 'test-password' } },
        });
    });

    it('separates six API metadata fields and opening operations does not mutate the key', async () => {
        mocks.roleData = {
            activeChannel: { id: 'shop-a', code: 'shop-a' },
            roles: { totalItems: 0, items: [] },
        };
        await renderPage();
        expect(Array.from(container.querySelectorAll('thead th')).map(node => node.textContent)).toEqual([
            '用途名称',
            '查询编号',
            '创建者',
            '最近使用',
            '当前角色',
            '操作',
        ]);
        expect(container.querySelectorAll('tbody tr')).toHaveLength(1);
        expect(container.querySelectorAll('tbody td')).toHaveLength(6);
        await clickButton('操作');
        expect(container.querySelector('[role="dialog"]')?.textContent).toContain('轮转');
        expect(mocks.updateApiKey).not.toHaveBeenCalled();
        expect(mocks.confirm).not.toHaveBeenCalled();
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
        await clickButton('操作');
        expect(container.textContent).toContain('同名角色的权限或渠道不符合专用要求');
        expect(container.textContent).not.toContain('设为邮箱专用密钥');
        expect(mocks.updateApiKey).not.toHaveBeenCalled();
    });
});

// The business fixtures own mocked data; lifecycle behavior is tested with real Apollo.
vi.mock('../../hooks/use-admin-query', () => import('../../test/admin-query-mock'));
vi.mock('../../hooks/use-admin-read-resource', () => import('../../test/admin-query-mock'));
