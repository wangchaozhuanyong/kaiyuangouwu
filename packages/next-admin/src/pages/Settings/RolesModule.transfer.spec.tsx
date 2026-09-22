// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FeatureHelpProvider } from '../../components/FeatureHelp';
import { ConfirmDialogContext, type ConfirmDialogOptions } from '../../components/confirm-dialog-context';
import {
    TRANSFER_PLATFORM_OWNERSHIP_MUTATION,
    TRANSFER_STORE_ADMINISTRATION_MUTATION,
    type TeamManagementResult,
} from '../../graphql/management.graphql';
import { RolesModule } from './RolesModule';

const apolloMocks = vi.hoisted(() => ({ useMutation: vi.fn(), useQuery: vi.fn() }));
const logoutMock = vi.hoisted(() => vi.fn());
vi.mock('@apollo/client/react', () => apolloMocks);
vi.mock('../../apollo', () => ({ logoutAdministrator: logoutMock, sensitiveActionContext: vi.fn() }));

const store = { id: 'store-1', code: 'moyao-ai', customFields: { storefrontNameZh: '模钥科技' } };
const otherStore = { id: 'store-2', code: 'other-store', customFields: { storefrontNameZh: '其他店铺' } };
const member = (id: string, scope: 'PLATFORM' | 'STORE', authority: 'ADMIN' | 'MANAGER' | 'STAFF') => ({
    id: `access-${id}`,
    scope,
    authority,
    status: 'ACTIVE' as const,
    channel: scope === 'STORE' ? store : null,
    administrator: {
        id,
        createdAt: '2026-09-20T00:00:00.000Z',
        updatedAt: '2026-09-20T00:00:00.000Z',
        firstName: id,
        lastName: '用户',
        emailAddress: `${id}@example.test`,
        user: { id: `user-${id}`, identifier: id, lastLogin: null, roles: [] },
    },
});

const reactTestEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean };
let container: HTMLDivElement;
let root: Root;
const confirmation = vi.fn(async (_options: ConfirmDialogOptions) => ({
    currentPassword: 'current-password',
}));
let transferStore: ReturnType<typeof vi.fn>;
let transferOwnership: ReturnType<typeof vi.fn>;

async function render(actor: TeamManagementResult['myAdministratorAccess']) {
    const data: TeamManagementResult = {
        activeAdministrator: { id: 'actor' },
        myAdministratorAccess: actor,
        manageableAdministrators: [
            member('platform', 'PLATFORM', 'ADMIN'),
            member('staff', 'STORE', 'STAFF'),
            { ...member('other', 'STORE', 'STAFF'), channel: otherStore },
        ],
        manageableRoles: [],
        manageableChannels: [store],
        permissionPolicyCatalog: { permissions: [], templates: [] },
    };
    apolloMocks.useQuery.mockReturnValue({ data, loading: false, refetch: vi.fn() });
    await act(async () => {
        root.render(
            <MemoryRouter initialEntries={['/settings/team']}>
                <FeatureHelpProvider>
                    <ConfirmDialogContext.Provider value={confirmation}>
                        <Routes>
                            <Route path="/settings/team" element={<RolesModule />} />
                            <Route path="/login" element={<div>重新登录</div>} />
                        </Routes>
                    </ConfirmDialogContext.Provider>
                </FeatureHelpProvider>
            </MemoryRouter>,
        );
    });
}

beforeEach(() => {
    reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    transferStore = vi.fn().mockResolvedValue({
        data: { transferStoreAdministration: { id: 'access-staff', authority: 'ADMIN' } },
    });
    transferOwnership = vi.fn().mockResolvedValue({
        data: { transferPlatformOwnership: { id: 'access-platform', authority: 'OWNER' } },
    });
    logoutMock.mockResolvedValue(undefined);
    apolloMocks.useMutation.mockImplementation((document: unknown) => {
        if (document === TRANSFER_STORE_ADMINISTRATION_MUTATION) return [transferStore, { loading: false }];
        if (document === TRANSFER_PLATFORM_OWNERSHIP_MUTATION) return [transferOwnership, { loading: false }];
        return [vi.fn(), { loading: false }];
    });
});

afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllMocks();
});

describe('RolesModule ownership transfer', () => {
    it('lets a store primary transfer only its own store and sends both accounts to re-login', async () => {
        await render({
            id: 'actor-access',
            scope: 'STORE',
            authority: 'ADMIN',
            status: 'ACTIVE',
            channel: store,
        });
        expect(container.querySelector('[aria-label="移交平台所有权给platform用户"]')).toBeNull();
        expect(container.querySelector('[aria-label="移交店铺主管理员给other用户"]')).toBeNull();
        const button = container.querySelector<HTMLButtonElement>(
            '[aria-label="移交店铺主管理员给staff用户"]',
        );
        expect(button).not.toBeNull();
        await act(async () => button?.click());
        expect(confirmation).toHaveBeenCalledWith(
            expect.objectContaining({ requireCurrentPassword: true, tone: 'danger' }),
        );
        expect(transferStore).toHaveBeenCalledWith({
            variables: {
                channelId: 'store-1',
                targetAdministratorId: 'staff',
                currentPassword: 'current-password',
            },
        });
        expect(logoutMock).toHaveBeenCalledOnce();
        expect(container.textContent).toContain('重新登录');
    });

    it('reserves platform ownership transfer for the owner', async () => {
        await render({
            id: 'actor-access',
            scope: 'PLATFORM',
            authority: 'ADMIN',
            status: 'ACTIVE',
            channel: null,
        });
        expect(container.querySelector('[aria-label="移交平台所有权给platform用户"]')).toBeNull();
        const button = container.querySelector<HTMLButtonElement>(
            '[aria-label="移交店铺主管理员给staff用户"]',
        );
        expect(button).not.toBeNull();
        await act(async () => button?.click());
        expect(transferStore).toHaveBeenCalledWith({
            variables: {
                channelId: 'store-1',
                targetAdministratorId: 'staff',
                currentPassword: 'current-password',
            },
        });
        expect(logoutMock).not.toHaveBeenCalled();
        expect(container.textContent).toContain('店铺主管理员已移交');
    });

    it('lets the owner use the dedicated platform transfer and invalidates the current session', async () => {
        await render({
            id: 'actor-access',
            scope: 'PLATFORM',
            authority: 'OWNER',
            status: 'ACTIVE',
            channel: null,
        });
        const button = container.querySelector<HTMLButtonElement>(
            '[aria-label="移交平台所有权给platform用户"]',
        );
        expect(button).not.toBeNull();
        await act(async () => button?.click());
        expect(transferOwnership).toHaveBeenCalledWith({
            variables: { targetAdministratorId: 'platform', currentPassword: 'current-password' },
        });
        expect(logoutMock).toHaveBeenCalledOnce();
        expect(container.textContent).toContain('重新登录');
    });
});
