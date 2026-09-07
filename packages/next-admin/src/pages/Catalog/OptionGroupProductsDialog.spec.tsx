// @vitest-environment jsdom

import { ApolloClient, ApolloLink, InMemoryCache, Observable } from '@apollo/client';
import { ApolloProvider } from '@apollo/client/react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FeatureHelpProvider } from '../../components/FeatureHelp';
import { OptionGroupProductsDialog } from './OptionGroupProductsDialog';

const cleanups: Array<() => void> = [];

afterEach(async () => {
    await act(async () => cleanups.splice(0).forEach(cleanup => cleanup()));
});

function LocationProbe() {
    const location = useLocation();
    return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

async function renderDialog({ error = false } = {}) {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const requests = vi.fn();
    const products = Array.from({ length: 12 }, (_, index) => ({
        __typename: 'Product',
        id: `product-${index + 1}`,
        name: index === 0 ? '无糖可乐' : `商品 ${index + 1}`,
        slug: `product-${index + 1}`,
        enabled: index % 2 === 0,
        updatedAt: '2026-09-07T00:00:00.000Z',
    }));
    const client = new ApolloClient({
        cache: new InMemoryCache(),
        link: new ApolloLink(
            operation =>
                new Observable(observer => {
                    requests(operation.operationName, operation.variables);
                    if (error) {
                        observer.error(new Error('关联商品读取失败'));
                        return;
                    }
                    const search = operation.variables.options.filter.name?.contains ?? '';
                    const matchingProducts = products.filter(product => product.name.includes(search));
                    const skip = operation.variables.options.skip ?? 0;
                    const take = operation.variables.options.take ?? 10;
                    observer.next({
                        data: {
                            products: {
                                totalItems: matchingProducts.length,
                                items: matchingProducts.slice(skip, skip + take),
                            },
                        },
                    });
                    observer.complete();
                }),
        ),
    });
    const onClose = vi.fn();
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    cleanups.push(() => {
        root.unmount();
        client.stop();
        container.remove();
    });
    await act(async () => {
        root.render(
            <ApolloProvider client={client}>
                <MemoryRouter initialEntries={['/catalog/categories?tab=options']}>
                    <FeatureHelpProvider>
                        <OptionGroupProductsDialog
                            group={{ id: 'group-1', name: '容量', code: 'volume', productCount: 12 }}
                            onClose={onClose}
                        />
                    </FeatureHelpProvider>
                    <LocationProbe />
                </MemoryRouter>
            </ApolloProvider>,
        );
    });
    const click = async (label: string) => {
        const button = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
            element => element.getAttribute('aria-label') === label || element.textContent?.trim() === label,
        );
        expect(button, `button: ${label}`).toBeTruthy();
        await act(async () => button!.click());
    };
    const search = async (value: string) => {
        const input = container.querySelector<HTMLInputElement>('[aria-label="搜索关联商品"]');
        expect(input).toBeTruthy();
        await act(async () => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
            input!.dispatchEvent(new Event('input', { bubbles: true }));
        });
    };
    return { container, requests, onClose, click, search };
}

describe('option group linked products dialog', () => {
    it('shows the exact linked products, paginates them, and opens the selected product', async () => {
        const { container, requests, onClose, click } = await renderDialog();

        expect(container.textContent).toContain('无糖可乐');
        expect(container.textContent).toContain('共 12 个');
        expect(requests).toHaveBeenCalledWith(
            'GetProductsByOptionGroup',
            expect.objectContaining({
                options: expect.objectContaining({
                    filter: { optionGroupId: { eq: 'group-1' } },
                    skip: 0,
                    take: 10,
                }),
            }),
        );

        await click('下一页关联商品');
        expect(requests).toHaveBeenLastCalledWith(
            'GetProductsByOptionGroup',
            expect.objectContaining({ options: expect.objectContaining({ skip: 10 }) }),
        );
        expect(container.textContent).toContain('商品 12');

        await click('打开商品：商品 12');
        expect(onClose).toHaveBeenCalledOnce();
        expect(container.querySelector('[data-testid="location"]')?.textContent).toBe(
            '/catalog/products/product-12?tab=variants',
        );
    });

    it('searches only within products linked to the selected template', async () => {
        const { container, requests, search } = await renderDialog();
        await search('无糖');

        expect(requests).toHaveBeenLastCalledWith(
            'GetProductsByOptionGroup',
            expect.objectContaining({
                options: expect.objectContaining({
                    filter: {
                        optionGroupId: { eq: 'group-1' },
                        name: { contains: '无糖' },
                    },
                }),
            }),
        );
        expect(container.textContent).toContain('无糖可乐');
        expect(container.textContent).toContain('共 1 个');
    });

    it('shows a retryable user-facing error state', async () => {
        const { container, requests, click } = await renderDialog({ error: true });
        expect(container.querySelector('[role="alert"]')?.textContent).toContain('关联商品读取失败');

        await click('重试');
        expect(requests).toHaveBeenCalledTimes(2);
    });
});
