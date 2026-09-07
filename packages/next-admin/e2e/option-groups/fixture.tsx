import { ApolloClient, ApolloLink, InMemoryCache, Observable } from '@apollo/client';
import { ApolloProvider } from '@apollo/client/react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import { ConfirmDialogContext } from '../../src/components/confirm-dialog-context';
import { FeatureHelpProvider } from '../../src/components/FeatureHelp';
import { AdminPermissionsContext } from '../../src/hooks/use-admin-permissions';
import '../../src/index.css';
import { CategoriesModule } from '../../src/pages/Catalog/CategoriesModule';

// Isolated browser fixture. All catalog records and GraphQL responses stay in memory.
const fixture = {
    operations: [] as Array<{ name: string; variables: Record<string, unknown> }>,
};
Object.assign(window, { optionGroupFixture: fixture });

const optionGroups = Array.from({ length: 25 }, (_, index) => ({
    __typename: 'ProductOptionGroup',
    id: `group-${index + 1}`,
    name: `规格模板 ${index + 1}`,
    code: `option-group-${index + 1}`,
    productCount: 12,
    translations: [
        {
            id: `group-translation-${index + 1}`,
            languageCode: 'zh_Hans',
            name: `规格模板 ${index + 1}`,
        },
    ],
    options: [
        {
            __typename: 'ProductOption',
            id: `option-${index + 1}`,
            name: `选项值 ${index + 1}`,
            code: `option-${index + 1}`,
            translations: [
                {
                    id: `option-translation-${index + 1}`,
                    languageCode: 'zh_Hans',
                    name: `选项值 ${index + 1}`,
                },
            ],
        },
    ],
}));

const linkedProducts = Array.from({ length: 12 }, (_, index) => ({
    __typename: 'Product',
    id: `linked-product-${index + 1}`,
    name: `关联商品 ${index + 1}`,
    slug: `linked-product-${index + 1}`,
    enabled: index !== 11,
    updatedAt: '2026-09-07T00:00:00.000Z',
}));

const client = new ApolloClient({
    cache: new InMemoryCache(),
    link: new ApolloLink(
        operation =>
            new Observable(observer => {
                fixture.operations.push({ name: operation.operationName, variables: operation.variables });
                const timer = window.setTimeout(() => {
                    if (operation.operationName === 'GetCatalogTaxonomy') {
                        observer.next({
                            data: {
                                collections: { items: [], totalItems: 0 },
                                productOptionGroups: { items: optionGroups, totalItems: optionGroups.length },
                                facets: { items: [], totalItems: 0 },
                                activeChannel: { id: 'fixture-channel', defaultLanguageCode: 'zh_Hans' },
                                collectionFilters: [],
                            },
                        });
                    } else if (operation.operationName === 'GetProductsByOptionGroup') {
                        const options = operation.variables.options as {
                            filter?: { name?: { contains?: string } };
                            skip?: number;
                            take?: number;
                        };
                        const search = options.filter?.name?.contains ?? '';
                        const matches = linkedProducts.filter(product => product.name.includes(search));
                        const skip = options.skip ?? 0;
                        const take = options.take ?? 10;
                        observer.next({
                            data: {
                                products: {
                                    items: matches.slice(skip, skip + take),
                                    totalItems: matches.length,
                                },
                            },
                        });
                    } else {
                        observer.error(new Error(`Unexpected fixture operation: ${operation.operationName}`));
                        return;
                    }
                    observer.complete();
                }, 40);
                return () => window.clearTimeout(timer);
            }),
    ),
});

createRoot(document.getElementById('root')!).render(
    <ApolloProvider client={client}>
        <BrowserRouter>
            <AdminPermissionsContext.Provider
                value={{ permissions: ['SuperAdmin'], hasAnyPermission: () => true }}
            >
                <ConfirmDialogContext.Provider value={async () => false}>
                    <FeatureHelpProvider>
                        <CategoriesModule />
                    </FeatureHelpProvider>
                </ConfirmDialogContext.Provider>
            </AdminPermissionsContext.Provider>
        </BrowserRouter>
    </ApolloProvider>,
);
