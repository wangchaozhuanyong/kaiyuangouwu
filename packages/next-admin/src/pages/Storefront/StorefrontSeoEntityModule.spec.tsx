import { FeatureHelpProvider } from '../../components/FeatureHelp';
// @vitest-environment jsdom
import { getOperationAST, type DocumentNode } from 'graphql';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultStorefrontSeoDocument } from '../../../../store-management-plugin/src/seo/storefront-seo.contract';
import type { StorefrontSeoRecord } from '../../graphql/storefront-seo.graphql';
import { AdminPermissionsContext } from '../../hooks/use-admin-permissions';
import { StorefrontSeoEntityModule } from './StorefrontSeoEntityModule';

const mocks = vi.hoisted(() => ({
    calls: [] as Array<{ name: string; skip: boolean }>,
    mutate: vi.fn(),
    refetch: vi.fn(),
    writable: true,
}));
vi.mock('../../apollo', () => ({
    getActiveChannelToken: () => 'token-a',
    getAdminQueryScope: () => 'scope-a',
    channelRequestContext: () => ({}),
}));
vi.mock('@apollo/client/react', () => ({ useMutation: () => [mocks.mutate, { loading: false }] }));
vi.mock('../../hooks/use-admin-query', () => ({
    useAdminQuery: (
        document: DocumentNode,
        options: { skip: boolean; variables: { input: StorefrontSeoRecord } },
    ) => {
        const name = getOperationAST(document)?.name?.value ?? '';
        mocks.calls.push({ name, skip: options.skip });
        const identity = options.variables.input;
        return {
            data:
                !options.skip && name === 'NextAdminStorefrontSeoEntityRecord'
                    ? {
                          activeChannel: { id: 'a', code: 'store-a', token: 'token-a' },
                          storefrontSeoRecord: {
                              ...identity,
                              id: 'r',
                              channelId: 'a',
                              draft: defaultStorefrontSeoDocument(identity.targetType),
                              published: null,
                              version: 1,
                              publishedVersion: 0,
                              publishedAt: null,
                              updatedAt: null,
                              canWrite: mocks.writable,
                          },
                      }
                    : undefined,
            loading: false,
            refetch: mocks.refetch,
        };
    },
}));
let root: Root, container: HTMLDivElement;
beforeEach(() => {
    mocks.calls = [];
    mocks.mutate.mockReset();
    mocks.refetch.mockReset().mockResolvedValue({ data: {} });
    mocks.writable = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
});
afterEach(() => {
    act(() => root.unmount());
    container.remove();
});
function render(type: 'products' | 'collections', permissions: string[]) {
    act(() =>
        root.render(
            <FeatureHelpProvider>
                <MemoryRouter initialEntries={[`/catalog/${type}/42/seo`]}>
                    <AdminPermissionsContext.Provider
                        value={{
                            permissions,
                            hasAnyPermission: required =>
                                required.some(permission => permissions.includes(permission)),
                        }}
                    >
                        <Routes>
                            <Route path="/catalog/:entity/:id/seo" element={<StorefrontSeoEntityModule />} />
                        </Routes>
                    </AdminPermissionsContext.Provider>
                </MemoryRouter>
            </FeatureHelpProvider>,
        ),
    );
}
describe('SEO native catalog permission attachments', () => {
    it.each([
        ['products', ['ReadProduct', 'UpdateProduct']],
        ['collections', ['ReadCollection', 'UpdateCollection']],
    ] as const)(
        'lets native-only %s operators edit their record without reading store settings',
        (type, permissions) => {
            render(type, [...permissions]);
            expect(container.querySelector('input')).not.toBeNull();
            expect((container.querySelector('input') as HTMLInputElement).disabled).toBe(false);
            expect(mocks.calls.filter(call => !call.skip).map(call => call.name)).toEqual([
                'NextAdminStorefrontSeoEntityRecord',
            ]);
            expect(mocks.calls.some(call => call.name.includes('Workspace'))).toBe(false);
            expect(container.textContent).toContain('店铺全局策略未读取');
            expect(container.textContent).not.toContain('允许搜索收录');
        },
    );
    it('respects native read-only permission and the server canWrite flag', () => {
        render('products', ['ReadProduct']);
        expect((container.querySelector('input') as HTMLInputElement).disabled).toBe(true);
        expect(container.textContent).toContain('只读');
    });
    it('never reads a product with only collection permission', () => {
        render('products', ['ReadCollection', 'UpdateCollection']);
        expect(container.textContent).toContain('没有读取此商品或分类的权限');
        expect(mocks.calls.filter(call => !call.skip)).toEqual([]);
        expect(container.querySelector('[data-seo-document-editor]')).toBeNull();
    });
});
