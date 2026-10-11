// @vitest-environment jsdom
import { ApolloClient, ApolloLink, InMemoryCache, Observable } from '@apollo/client';
import { ApolloProvider } from '@apollo/client/react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { StorefrontBlockEditor } from './StorefrontBlockEditor';
import { newContentBlock } from './storefront-content-utils';

vi.mock('../../apollo', () => ({ getAdminQueryScope: () => 'store-a' }));
vi.mock('../../hooks/use-admin-permissions', () => ({
    useAdminPermissions: () => ({ hasAnyPermission: () => true }),
}));
vi.mock('../../components/FeatureHelp', () => ({ FeatureHelpButton: () => null }));
vi.mock('./storefront-block-preview', () => ({ BlockPreview: () => null }));
vi.mock('./storefront-asset-picker', () => ({ AssetPicker: () => null }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it('shows six effective associations after deletion and restores eight original positions without rewriting an unsaved editor', async () => {
    const ids = Array.from({ length: 8 }, (_, index) => String(index));
    let available = ids.filter(id => !['1', '5'].includes(id));
    let failed = false;
    const referenceReads: string[][] = [];
    const client = new ApolloClient({
        cache: new InMemoryCache(),
        link: new ApolloLink(
            operation =>
                new Observable(observer => {
                    if (operation.operationName === 'NextAdminCatalogReferences') {
                        const batch = operation.variables.ids0;
                        referenceReads.push(batch);
                        if (failed) observer.error(new Error('Read unavailable'));
                        else {
                            const items = batch
                                .filter((id: string) => available.includes(id))
                                .map((id: string) => ({
                                    __typename: 'Product',
                                    id,
                                    name: `latest ${id}`,
                                    slug: id,
                                    enabled: true,
                                }));
                            observer.next({
                                data: {
                                    batch0: { __typename: 'ProductList', items, totalItems: items.length },
                                },
                            });
                            observer.complete();
                        }
                    } else {
                        observer.next({
                            data: { products: { __typename: 'ProductList', items: [], totalItems: 200 } },
                        });
                        observer.complete();
                    }
                }),
        ),
    });
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const onSave = vi.fn(async () => {});
    const value = {
        ...newContentBlock('FEATURED_COLLECTION', 0),
        id: 'saved-block',
        settings: { selectedProductIds: ids },
    };
    const text = () => document.querySelector('[aria-label="编辑店铺楼层区块"]')?.textContent ?? '';
    try {
        await act(async () =>
            root.render(
                <ApolloProvider client={client}>
                    <StorefrontBlockEditor value={value} saving={false} onClose={vi.fn()} onSave={onSave} />
                </ApolloProvider>,
            ),
        );
        await act(() => vi.waitFor(() => expect(text()).toContain('有效 6 个，暂不可用 2 个')));
        const title = document.querySelector<HTMLInputElement>('[data-translation-field="title"]')!;
        await act(async () => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
                title,
                '尚未保存的标题',
            );
            title.dispatchEvent(new Event('input', { bubbles: true }));
            [...document.querySelectorAll<HTMLButtonElement>('button')]
                .find(button => button.textContent?.includes('选择商品（'))!
                .click();
        });
        expect(document.querySelector('[aria-label="已选商品及原顺序"]')?.textContent).toContain(
            '2. 1 · 暂不可用',
        );
        available = ids;
        await act(async () => {
            await client.refetchQueries({ include: ['NextAdminCatalogReferences'] });
        });
        expect(text()).toContain('有效 8 个');
        expect(title.value).toBe('尚未保存的标题');
        const ordered = document.querySelector('[aria-label="已选商品及原顺序"]')?.textContent ?? '';
        for (let index = 0; index < ids.length; index++)
            expect(ordered).toContain(`${index + 1}. latest ${ids[index]}`);
        failed = true;
        await act(async () => {
            await client.refetchQueries({ include: ['NextAdminCatalogReferences'] });
        });
        expect(text()).toContain('待核对 8 个');
        expect(text()).not.toContain('暂不可用 8 个');
        expect(title.value).toBe('尚未保存的标题');
        expect(value.settings.selectedProductIds).toEqual(ids);
        expect(referenceReads.filter(read => read.length).every(read => read.join() === ids.join())).toBe(
            true,
        );
        expect(onSave).not.toHaveBeenCalled();
    } finally {
        await act(async () => root.unmount());
        client.stop();
        host.remove();
    }
});
