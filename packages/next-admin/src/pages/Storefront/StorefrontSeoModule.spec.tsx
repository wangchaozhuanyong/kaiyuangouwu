import { FeatureHelpProvider } from '../../components/FeatureHelp';
// @vitest-environment jsdom
import { getOperationAST, type DocumentNode } from 'graphql';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultStorefrontSeoSettings } from '../../../../store-management-plugin/src/seo/storefront-seo.contract';
import type { StorefrontSeoRecord, StorefrontSeoWorkspace } from '../../graphql/storefront-seo.graphql';
import { AdminPermissionsContext } from '../../hooks/use-admin-permissions';
import { StorefrontSeoModule } from './StorefrontSeoModule';

const mocks = vi.hoisted(() => ({
    scope: 'a',
    token: 'token-a',
    channelId: 'a',
    data: undefined as StorefrontSeoWorkspace | undefined,
    queryError: undefined as Error | undefined,
    loading: false,
    mutate: vi.fn(),
    refetch: vi.fn(),
}));
vi.mock('../../apollo', () => ({
    getActiveChannelToken: () => mocks.token,
    getAdminQueryScope: () => mocks.scope,
    channelRequestContext: (token: string) => ({ headers: { 'vendure-token': token } }),
}));
vi.mock('../../hooks/use-admin-query', () => ({
    useAdminQuery: (document: DocumentNode) => ({
        data:
            getOperationAST(document)?.name?.value === 'NextAdminStorefrontSeoWorkspace' && mocks.data
                ? {
                      activeChannel: {
                          id: mocks.channelId,
                          code: `shop-${mocks.channelId}`,
                          token: mocks.token,
                      },
                      storefrontSeoWorkspace: mocks.data,
                  }
                : undefined,
        loading: mocks.loading,
        error: mocks.queryError,
        refetch: mocks.refetch,
    }),
}));
vi.mock('@apollo/client/react', () => ({ useMutation: () => [mocks.mutate, { loading: false }] }));

let container: HTMLDivElement, root: Root;
const settingsRecord = (channelId = 'a', version = 1): StorefrontSeoRecord => ({
    id: 'record',
    channelId,
    targetType: 'SETTINGS',
    targetId: 'store',
    languageCode: 'und',
    draft: defaultStorefrontSeoSettings(),
    published: null,
    version,
    publishedVersion: 0,
    publishedAt: null,
    updatedAt: null,
    canWrite: true,
});
beforeEach(() => {
    mocks.scope = 'a';
    mocks.token = 'token-a';
    mocks.channelId = 'a';
    mocks.loading = false;
    mocks.queryError = undefined;
    mocks.data = {
        channelId: 'a',
        accessMode: 'LIVE',
        settings: settingsRecord(),
        documents: [],
        diagnostics: [],
    };
    mocks.mutate.mockReset();
    mocks.refetch.mockReset().mockResolvedValue({ data: {} });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
});
afterEach(() => {
    act(() => root.unmount());
    container.remove();
});
const render = (path = '/storefront/seo/overview') =>
    act(() =>
        root.render(
            <FeatureHelpProvider>
                <MemoryRouter initialEntries={[path]}>
                    <AdminPermissionsContext.Provider
                        value={{
                            permissions: ['ReadStorefrontContent', 'UpdateStorefrontContent'],
                            hasAnyPermission: () => true,
                        }}
                    >
                        <StorefrontSeoModule />
                    </AdminPermissionsContext.Provider>
                </MemoryRouter>
            </FeatureHelpProvider>,
        ),
    );
const button = (name: string) =>
    Array.from(container.querySelectorAll('button')).find(item => item.textContent?.includes(name))!;
const allowIndexing = () =>
    act(() => (container.querySelector('input[type=checkbox]') as HTMLInputElement).click());

describe('channel SEO draft workflow', () => {
    it('selects a supported public page rather than an absent about route', () => {
        render('/storefront/seo/pages?targetType=PAGE');
        const page = Array.from(container.querySelectorAll('select')).find(item =>
            Array.from(item.options).some(option => option.value === 'services'),
        );
        expect(page?.value).toBe('services');
        expect(page?.querySelector('option[value="about"]')).toBeNull();
    });
    it('distinguishes initial loading and failure with a read retry', () => {
        mocks.data = undefined;
        mocks.loading = true;
        render();
        expect(container.textContent).toContain('正在读取当前店铺');
        mocks.loading = false;
        mocks.queryError = new Error('read offline');
        render();
        expect(container.querySelector('[role=alert]')).not.toBeNull();
        act(() => button('重试读取').click());
        expect(mocks.refetch).toHaveBeenCalledTimes(1);
    });
    it('preserves a dirty draft when the server version changes and prevents stale writes', () => {
        render();
        allowIndexing();
        expect((container.querySelector('input[type=checkbox]') as HTMLInputElement).checked).toBe(true);
        mocks.data!.settings = settingsRecord('a', 2);
        render();
        expect(container.textContent).toContain('当前未保存草稿已保留');
        expect((container.querySelector('input[type=checkbox]') as HTMLInputElement).checked).toBe(true);
        expect(button('保存草稿').disabled).toBe(true);
    });
    it('sends the loaded CAS version, saves once and distinguishes a failed readback', async () => {
        const receipt = settingsRecord('a', 2);
        receipt.draft = { ...defaultStorefrontSeoSettings(), indexingEnabled: true };
        mocks.mutate.mockResolvedValue({ data: { saveStorefrontSeoDraft: receipt } });
        mocks.refetch.mockRejectedValue(new Error('readback failed'));
        render();
        allowIndexing();
        await act(async () => button('保存草稿').click());
        expect(mocks.mutate).toHaveBeenCalledTimes(1);
        expect(mocks.mutate.mock.calls[0][0].variables.input).toMatchObject({
            expectedVersion: 1,
            targetType: 'SETTINGS',
            targetId: 'store',
            languageCode: 'und',
            draft: { indexingEnabled: true },
        });
        expect(container.textContent).toContain('操作已完成，但最新数据读取失败');
        expect(button('保存草稿').disabled).toBe(true);
        await act(async () => button('刷新本页').click());
        expect(mocks.mutate).toHaveBeenCalledTimes(1);
    });
    it('replaces old channel data and unsaved inputs on scope switch', () => {
        render();
        allowIndexing();
        mocks.scope = 'b';
        mocks.token = 'token-b';
        mocks.channelId = 'b';
        mocks.data = {
            channelId: 'b',
            accessMode: 'PREVIEW',
            settings: settingsRecord('b'),
            documents: [],
            diagnostics: [],
        };
        render();
        expect((container.querySelector('input[type=checkbox]') as HTMLInputElement).checked).toBe(false);
        expect(container.textContent).toContain('shop-b');
        expect(container.textContent).not.toContain('shop-a');
    });
});
