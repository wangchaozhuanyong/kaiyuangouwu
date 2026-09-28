// @vitest-environment jsdom

import { ApolloClient, ApolloLink, InMemoryCache, Observable } from '@apollo/client';
import { ApolloProvider } from '@apollo/client/react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import { FeatureHelpProvider } from '../../components/FeatureHelp';
import { PurchaseOrdersModule } from './PurchaseOrdersModule';

const cleanups: Array<() => void> = [];

afterEach(async () => {
    await act(async () => cleanups.splice(0).forEach(cleanup => cleanup()));
});

describe('purchase order creation', () => {
    it('loads warehouses separately and finds a SKU beyond the first page by search', async () => {
        (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        const searches: string[] = [];
        const client = new ApolloClient({
            cache: new InMemoryCache(),
            link: new ApolloLink(
                operation =>
                    new Observable(observer => {
                        const name = operation.operationName;
                        let data: Record<string, unknown>;
                        if (name === 'NextAdminCatalogPurchaseOrders') {
                            data = { catalogPurchaseOrders: { items: [], totalItems: 0 } };
                        } else if (name === 'NextAdminCatalogSuppliers') {
                            data = {
                                catalogSuppliers: {
                                    items: [{ id: 'supplier-1', name: 'QA 供货商', code: 'QA-SUPPLIER' }],
                                    totalItems: 1,
                                },
                            };
                        } else if (name === 'NextAdminCatalogPurchaseContext') {
                            data = {
                                activeChannel: { id: 'channel-1', defaultCurrencyCode: 'MYR' },
                                stockLocations: { items: [{ id: 'warehouse-1', name: '大马仓库' }] },
                            };
                        } else if (name === 'NextAdminCatalogPurchaseVariants') {
                            const search = operation.variables.options.filter._or[0].sku.contains as string;
                            searches.push(search);
                            data = {
                                productVariants: {
                                    items:
                                        search === 'QA-20260928-PHYSICAL'
                                            ? [{ id: 'variant-1094', name: '一次模拟配送', sku: search }]
                                            : [],
                                    totalItems: search === 'QA-20260928-PHYSICAL' ? 1 : 0,
                                },
                            };
                        } else {
                            observer.error(new Error(`Unexpected query: ${name}`));
                            return;
                        }
                        observer.next({ data });
                        observer.complete();
                    }),
            ),
        });
        const host = document.createElement('div');
        document.body.append(host);
        const root = createRoot(host);
        cleanups.push(() => {
            root.unmount();
            host.remove();
        });

        await act(async () => {
            root.render(
                <ApolloProvider client={client}>
                    <FeatureHelpProvider>
                        <PurchaseOrdersModule />
                    </FeatureHelpProvider>
                </ApolloProvider>,
            );
        });
        await act(async () => {
            [...host.querySelectorAll('button')]
                .find(button => button.textContent?.includes('新建采购单'))
                ?.click();
        });

        const dialog = host.querySelector('[role="dialog"]');
        if (!dialog) throw new Error('Purchase order dialog did not open');
        const selects = dialog.querySelectorAll('select');
        expect(selects[1]?.textContent).toContain('大马仓库');
        expect(searches).toEqual([]);

        const searchInput = dialog.querySelector('input[aria-label="搜索采购 SKU"]') as HTMLInputElement;
        await act(async () => {
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
            setter?.call(searchInput, 'QA-20260928-PHYSICAL');
            searchInput.dispatchEvent(new Event('input', { bubbles: true }));
        });
        expect(searches).toContain('QA-20260928-PHYSICAL');
        expect(dialog.textContent).toContain('一次模拟配送 · QA-20260928-PHYSICAL');

        await act(async () => {
            const variantSelect = dialog.querySelectorAll('select')[2] as HTMLSelectElement;
            variantSelect.value = 'variant-1094';
            variantSelect.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await act(async () => {
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
            setter?.call(searchInput, 'nothing-matches');
            searchInput.dispatchEvent(new Event('input', { bubbles: true }));
        });
        expect((dialog.querySelectorAll('select')[2] as HTMLSelectElement).value).toBe('variant-1094');
        expect(dialog.textContent).toContain('一次模拟配送 · QA-20260928-PHYSICAL');
    });
});
