import { ApolloClient, ApolloLink, InMemoryCache, Observable } from '@apollo/client';
import { ApolloProvider } from '@apollo/client/react';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ConfirmDialogContext } from '../../src/components/confirm-dialog-context';
import { FeatureHelpProvider } from '../../src/components/FeatureHelp';
import { AdminPermissionsContext } from '../../src/hooks/use-admin-permissions';
import { usePageSize } from '../../src/hooks/use-page-size';
import '../../src/index.css';
import { CatalogModule } from '../../src/pages/Catalog/CatalogModule';
import { LookupPager } from '../../src/pages/Catalog/LookupPager';
import { SuppliersModule } from '../../src/pages/Catalog/SuppliersModule';
import { CustomersModule } from '../../src/pages/Customers/CustomersModule';
import { ReportPagination } from '../../src/pages/Marketing/referral-ui';
import { SalesModule } from '../../src/pages/Sales/SalesModule';

// Isolated browser fixture. All records and GraphQL responses stay in memory.
const params = new URLSearchParams(location.search);
const fixture = {
    operations: [] as Array<{ name: string; variables: Record<string, unknown> }>,
    fail: false,
    delay: 40,
};
Object.assign(window, { paginationFixture: fixture });
const stamp = '2026-09-06T00:00:00.000Z';
const channel = { id: 'fixture-channel', code: '__default_channel__', token: '', defaultCurrencyCode: 'CNY' };
const total = params.has('empty') ? 0 : 237;
function record(index: number) {
    return {
        id: `fixture-${index}`,
        createdAt: stamp,
        updatedAt: stamp,
        enabled: true,
        name: `测试记录 ${index + 1}`,
        slug: `record-${index}`,
        description: '',
        customFields: {
            fulfillmentType: 'digital',
            refundPolicy: 'MERCHANT_REVIEW',
            manualDeliverySlaMinutes: 1440,
        },
        featuredAsset: null,
        variants: [],
        facetValues: [],
        collections: [],
        code: `TEST-${index}`,
        contactName: '测试联系人',
        phone: '',
        email: '',
        address: '',
        notes: '',
        linkedVariantCount: 0,
        channelId: channel.id,
        firstName: '测试',
        lastName: `客户 ${index + 1}`,
        emailAddress: `fixture-${index}@example.invalid`,
        phoneNumber: '',
        groups: [],
        user: null,
        orders: { items: [], totalItems: 0 },
        orderPlacedAt: stamp,
        state: 'PaymentSettled',
        active: false,
        totalQuantity: 0,
        totalWithTax: 10000,
        currencyCode: 'CNY',
        customer: null,
        shippingAddress: null,
        lines: [],
        fulfillments: [],
        payments: [],
    };
}
const client = new ApolloClient({
    cache: new InMemoryCache(),
    link: new ApolloLink(
        operation =>
            new Observable(observer => {
                fixture.operations.push({ name: operation.operationName, variables: operation.variables });
                const timer = setTimeout(() => {
                    if (fixture.fail) {
                        observer.error(new Error('分页测试：读取失败'));
                        return;
                    }
                    const options = (operation.variables.options ?? {}) as { skip?: number; take?: number };
                    const skip = options.skip ?? 0;
                    const take = options.take ?? 20;
                    const list = {
                        totalItems: total,
                        items: Array.from({ length: Math.min(take, Math.max(0, total - skip)) }, (_, i) =>
                            record(skip + i),
                        ),
                    };
                    const typed = (__typename: string) => ({
                        ...list,
                        items: list.items.map(item => ({ ...item, __typename })),
                    });
                    observer.next({
                        data: {
                            products: typed('Product'),
                            customers: typed('Customer'),
                            catalogSuppliers: typed('CatalogSupplier'),
                            orders: typed('Order'),
                            customerGroup: {
                                id: operation.variables.id ?? 'fixture-group',
                                name: '测试分组',
                                customers: typed('Customer'),
                            },
                            collections: { items: [], totalItems: 0 },
                            customerGroups: { items: [], totalItems: 0 },
                            countries: { items: [] },
                            activeChannel: channel,
                            channels: { items: [channel], totalItems: 1 },
                            myStoreCommerceMode: { mode: 'HYBRID', conflicts: [] },
                            physicalFulfillmentTodoCount: 0,
                        },
                    });
                    observer.complete();
                }, fixture.delay);
                return () => clearTimeout(timer);
            }),
    ),
});

export function IndependentLookup({ name }: { name: string }) {
    const [page, setPage] = React.useState(2);
    const [pageSize, setPageSize] = usePageSize(setPage);
    return (
        <section aria-label={name} className="rounded-lg border p-4">
            <h2>{name}</h2>
            <output>{JSON.stringify({ skip: page * pageSize, take: pageSize })}</output>
            <LookupPager
                page={page}
                pageSize={pageSize}
                totalItems={237}
                onPageChange={setPage}
                onPageSizeChange={setPageSize}
            />
        </section>
    );
}
export function SharedReports() {
    const [skips, setSkips] = React.useState([40, 80]);
    const [pageSize, setPageSize] = usePageSize(() => setSkips([0, 0]));
    return (
        <section aria-label="关联报表">
            <output>{JSON.stringify({ skips, take: pageSize })}</output>
            {skips.map((skip, index) => (
                <ReportPagination
                    key={index}
                    skip={skip}
                    total={237}
                    pageSize={pageSize}
                    loading={false}
                    onPageSizeChange={setPageSize}
                    onChange={value => setSkips(current => current.map((s, i) => (i === index ? value : s)))}
                />
            ))}
        </section>
    );
}
export function Fixture() {
    const view = params.get('view');
    if (view === 'suppliers') return <SuppliersModule />;
    if (view === 'sales') return <SalesModule />;
    if (view === 'customers') return <CustomersModule />;
    if (view === 'lookups')
        return (
            <div className="space-y-6 p-4">
                <IndependentLookup name="素材选择" />
                <IndependentLookup name="分类选择" />
                <SharedReports />
            </div>
        );
    return <CatalogModule />;
}

createRoot(document.getElementById('root')!).render(
    <ApolloProvider client={client}>
        <BrowserRouter>
            <AdminPermissionsContext.Provider
                value={{ permissions: ['SuperAdmin'], hasAnyPermission: () => true }}
            >
                <ConfirmDialogContext.Provider value={async () => false}>
                    <FeatureHelpProvider>
                        <Fixture />
                    </FeatureHelpProvider>
                </ConfirmDialogContext.Provider>
            </AdminPermissionsContext.Provider>
        </BrowserRouter>
    </ApolloProvider>,
);
