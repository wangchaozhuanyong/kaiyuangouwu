// @vitest-environment jsdom

import { ApolloClient, ApolloLink, InMemoryCache, Observable } from '@apollo/client';
import { ApolloProvider } from '@apollo/client/react';
import { Kind } from 'graphql';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import { ConfirmDialogContext } from '../../../components/confirm-dialog-context';
import { FeatureHelpProvider } from '../../../components/FeatureHelp';
import { AdminPermissionsContext } from '../../../hooks/use-admin-permissions';
import { CatalogImportDialog } from './CatalogImportDialog';

const cleanups: Array<() => void> = [];

afterEach(async () => {
    await act(async () => cleanups.splice(0).forEach(cleanup => cleanup()));
});

describe('CatalogImportDialog target selection', () => {
    it.each(['DIGITAL_ONLY', 'PHYSICAL_ONLY', 'HYBRID'])(
        'loads the catalog context for %s and requires an explicit warehouse choice',
        async commerceMode => {
            (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
            const client = new ApolloClient({
                cache: new InMemoryCache(),
                link: new ApolloLink(
                    operation =>
                        new Observable(observer => {
                            if (operation.operationName === 'NextAdminCatalogImportContext') {
                                const query = operation.query.definitions.find(
                                    definition => definition.kind === Kind.OPERATION_DEFINITION,
                                );
                                const fields = query?.selectionSet.selections
                                    .filter(selection => selection.kind === Kind.FIELD)
                                    .map(selection => selection.name.value);
                                if (fields?.includes('stockLocations')) {
                                    observer.error(new Error('Physical warehouse management is unavailable'));
                                    return;
                                }
                                expect(fields).toContain('catalogProductCreationContext');
                                observer.next({
                                    data: {
                                        activeChannel: {
                                            id: 'channel-dama',
                                            code: '美宜佳',
                                            defaultCurrencyCode: 'MYR',
                                            availableCurrencyCodes: ['MYR'],
                                            customFields: {
                                                commerceMode,
                                                storefrontNameZh: '大马通',
                                                storefrontNameEn: 'Damatong',
                                            },
                                        },
                                        catalogProductCreationContext: {
                                            stockLocations: [
                                                { id: 'warehouse-moyao', name: '模钥Ai' },
                                                { id: 'warehouse-dama', name: '大马仓库' },
                                            ],
                                        },
                                    },
                                });
                            } else if (operation.operationName === 'NextAdminCatalogImportJobs') {
                                observer.next({ data: { catalogImportJobs: { items: [], totalItems: 0 } } });
                            } else {
                                observer.error(new Error(`Unexpected operation: ${operation.operationName}`));
                                return;
                            }
                            observer.complete();
                        }),
                ),
            });
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
                        <AdminPermissionsContext.Provider
                            value={{ permissions: ['SuperAdmin'], hasAnyPermission: () => true }}
                        >
                            <ConfirmDialogContext.Provider value={async () => false}>
                                <FeatureHelpProvider>
                                    <CatalogImportDialog open onClose={() => undefined} />
                                </FeatureHelpProvider>
                            </ConfirmDialogContext.Provider>
                        </AdminPermissionsContext.Provider>
                    </ApolloProvider>,
                );
            });

            const dialog = document.querySelector('[role=dialog][aria-label="商品安全导入中心"]')!;
            const targetShop = Array.from(dialog.querySelectorAll('label')).find(label =>
                label.textContent?.includes('目标店铺'),
            );
            const targetWarehouse = Array.from(dialog.querySelectorAll('label')).find(label =>
                label.textContent?.includes('目标仓库'),
            );
            expect(targetShop?.querySelector('input')?.value).toBe('大马通');
            expect(targetShop?.textContent).toContain('店铺编码：美宜佳');
            expect(targetWarehouse?.querySelector('select')?.value).toBe('');
            expect(
                Array.from(targetWarehouse!.querySelectorAll('option')).map(option => option.value),
            ).toEqual(['', 'warehouse-moyao', 'warehouse-dama']);
            expect(targetWarehouse?.textContent).toContain('请明确选择本次库存要写入的仓库');
        },
    );
});
