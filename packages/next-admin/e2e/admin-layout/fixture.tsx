import { ApolloClient, ApolloLink, InMemoryCache, Observable } from '@apollo/client';
import { ApolloProvider } from '@apollo/client/react';
import { Kind, type FragmentDefinitionNode, type SelectionSetNode } from 'graphql';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AdminPermissionsProvider } from '../../src/components/admin-permissions-context';
import { ConfirmDialogContext } from '../../src/components/confirm-dialog-context';
import { FeatureHelpProvider } from '../../src/components/FeatureHelp';
import { CustomFieldsContext } from '../../src/custom-fields/custom-fields-context';
import { defineNextAdminExtension } from '../../src/extensions/extension-api';
import type { StoreManagementResult } from '../../src/graphql/management.graphql';
import '../../src/index.css';
import { CatalogExportAction } from '../../src/pages/Catalog/CatalogExportAction';
import { CatalogModule } from '../../src/pages/Catalog/CatalogModule';
import {
    CatalogOperationsBlock,
    ProductPackagingBlock,
    ProductVariantCustomFieldsBlock,
    ProductVariantPricesBlock,
} from '../../src/pages/Catalog/CatalogOperationsBlocks';
import { CategoriesModule } from '../../src/pages/Catalog/CategoriesModule';
import { CatalogImportAction } from '../../src/pages/Catalog/import/CatalogImportAction';
import { ProductEditor } from '../../src/pages/Catalog/ProductEditor';
import { DashboardModule } from '../../src/pages/Dashboard/DashboardModule';
import { ClientPluginsModule } from '../../src/pages/Plugins/ClientPluginsModule';
import { ProfitReportModule } from '../../src/pages/Sales/ProfitReportModule';
import { SalesModule } from '../../src/pages/Sales/SalesModule';
import { PaymentShippingManager } from '../../src/pages/Settings/PaymentShippingManager';
import { SystemOpsModule } from '../../src/pages/Settings/SystemOpsModule';
import { TranslationsModule } from '../../src/pages/Settings/TranslationsModule';
import { UsdtPaymentManagementModule } from '../../src/pages/Settings/UsdtPaymentManagementModule';
import { BusinessServicesCopyModule } from '../../src/pages/Storefront/BusinessServicesCopyModule';
import { ReviewsModule } from '../../src/pages/Storefront/ReviewsModule';

// Synthetic local data only. No HTTP link; every mutation is rejected.
const params = new URLSearchParams(location.search);
const view = params.get('view') ?? 'product';
const viewLabels: Record<string, string> = {
    dashboard: '工作台',
    sales: '订单列表',
    reviews: '买家评价',
    catalog: '商品列表',
    paymentSettings: '支付设置',
    product: '商品编辑',
    profit: '利润统计',
    translations: '多语言翻译',
    jobs: '系统任务',
    health: '服务健康',
    usdt: 'USDT 收款',
    plugins: '客户端插件',
    copy: '商业服务文案',
    categories: '商品分类',
};
if (!params.has('light')) document.documentElement.classList.add('dark');
const now = '2026-09-09T10:00:00Z';
const channel = {
    id: 'layout-channel',
    code: '布局验收店铺',
    token: '',
    defaultLanguageCode: 'zh_Hans',
    availableLanguageCodes: ['zh_Hans', 'en'],
    currencyCode: 'MYR',
    defaultCurrencyCode: 'MYR',
    availableCurrencyCodes: ['MYR', 'CNY'],
};
const empty = { items: [], totalItems: 0 };
const variants = Array.from({ length: params.has('multi') ? 3 : 1 }, (_, i) => ({
    __typename: 'ProductVariant',
    id: `layout-variant-${i}`,
    name: `示例商品 ${i + 1}`,
    sku: `LAYOUT-SKU-${i + 1}`,
    enabled: true,
    createdAt: now,
    updatedAt: now,
    price: 5000,
    currencyCode: 'MYR',
    stockOnHand: 30,
    stockAllocated: 2,
    stockLevel: 'IN_STOCK',
    trackInventory: 'TRUE',
    useGlobalOutOfStockThreshold: true,
    options: [],
    facetValues: [],
    stockLevels: [],
    prices: [{ currencyCode: 'MYR', price: 5000 }],
    translations: [{ languageCode: 'zh_Hans', name: `示例商品 ${i + 1}` }],
    customFields: {
        fulfillmentType: params.has('digital') ? 'digital' : 'physical',
        digitalDeliveryMode: 'MANUAL',
        digitalStockPolicy: 'FINITE',
        deliveryNote: '示例交付说明',
    },
}));
const product = {
    __typename: 'Product',
    id: 'layout-product',
    name: '布局验收示例商品',
    slug: 'layout-demo',
    description: '<p>商品简介和主图应当优先展示。</p>',
    enabled: true,
    createdAt: now,
    updatedAt: now,
    customFields: {
        fulfillmentType: params.has('digital') ? 'digital' : 'physical',
        refundPolicy: 'MERCHANT_REVIEW',
        manualDeliverySlaMinutes: 1440,
    },
    assets: [],
    featuredAsset: null,
    variants,
    translations: [
        {
            id: 'translation-1',
            languageCode: 'zh_Hans',
            name: '布局验收示例商品',
            slug: 'layout-demo',
            description: '<p>商品简介和主图应当优先展示。</p>',
        },
    ],
    optionGroups: [],
    facetValues: [],
    collections: [],
    channels: [channel],
};
const summary = {
    currencyCode: 'MYR',
    orderCount: 8,
    quantity: 16,
    settledRevenueMicrounits: 2000000000,
    refundedRevenueMicrounits: 100000000,
    netRevenueMicrounits: 1900000000,
    shippingRevenueMicrounits: 100000000,
    productCostMicrounits: 1000000000,
    grossProfitMicrounits: 900000000,
    grossMargin: 0.47,
    missingCostOrderCount: 0,
    missingCostLineCount: 0,
    estimatedCostOrderCount: 0,
    estimatedCostLineCount: 0,
    carrierShippingCostMicrounits: 100000000,
    paymentFeeMicrounits: 20000000,
    netProfitMicrounits: params.has('negative') ? -123456789123456 : 780000000,
    netMargin: 0.41,
    missingCarrierShippingCostOrderCount: params.has('missing') ? 1 : 0,
    missingPaymentFeeOrderCount: 0,
    includesCarrierShippingCost: true,
    includesPaymentFees: true,
};
if (params.has('missing')) summary.netProfitMicrounits = null as never;
const states = Array.from({ length: 2096 }, (_, i) => ({
    id: `translation-${i + 1}`,
    channelId: channel.id,
    entityType: i % 2 ? 'Product' : 'Collection',
    entityId: `item-${i + 1}`,
    fieldPath: 'name',
    sourceLanguageCode: 'zh_Hans',
    targetLanguageCode: 'en',
    status: i % 5 ? 'COMPLETED' : 'FAILED',
    origin: 'AUTO',
    locked: false,
    attempts: 1,
    revision: 1,
    nextAttemptAt: null,
    lastErrorCode: null,
    error: i % 5 ? null : '模拟翻译服务暂时不可用',
    updatedAt: now,
}));
const jobs = Array.from({ length: 100 }, (_, i) => ({
    id: `job-${i + 1}`,
    queueName: i % 2 ? 'translate-content' : 'apply-collection-filters',
    createdAt: now,
    startedAt: now,
    settledAt: now,
    state: i % 5 ? 'COMPLETED' : 'FAILED',
    isSettled: true,
    progress: 100,
    duration: 200,
    error: i % 5 ? null : '模拟任务错误',
    retries: 0,
    attempts: 1,
}));
const wallet = {
    channelId: channel.id,
    channelCode: channel.code,
    reviewStatus: params.has('pending') ? 'PENDING' : 'UNCONFIGURED',
    configured: false,
    network: 'TRON',
    activeReceivingAddressMasked: null,
    activeReceivingAddressFingerprint: null,
    pendingReceivingAddress: params.has('pending') ? '本地模拟审核地址（不可使用）' : null,
    pendingReceivingAddressFingerprint: null,
    submittedAt: now,
    reviewedAt: null,
    rejectionReason: null,
};
const payment = {
    id: 'payment-demo',
    channelId: channel.id,
    channelCode: channel.code,
    orderId: 'order-demo',
    orderCode: 'LAYOUT-ORDER-001',
    paymentMethodCode: 'store-usdt',
    paymentState: 'Settled',
    currencyCode: 'MYR',
    amount: 5000,
    refundedAmount: 0,
    netAmount: 5000,
    transactionId: 'synthetic-transaction',
    createdAt: now,
};
const collections = Array.from({ length: 8 }, (_, i) => ({
    __typename: 'Collection',
    id: `collection-${i}`,
    name: `示例分类 ${i + 1}`,
    slug: `demo-${i}`,
    position: i,
    isPrivate: false,
    createdAt: now,
    updatedAt: now,
    parentId: 'root',
    parent: { id: 'root', name: '根分类' },
    breadcrumbs: [],
    children: [],
    filters: [],
    translations: [
        { languageCode: 'zh_Hans', name: `示例分类 ${i + 1}`, slug: `demo-${i}`, description: '' },
    ],
    description: '',
    featuredAsset: null,
    productVariants: empty,
}));
const unconfiguredSetup = {
    myStoreCurrencyConfiguration: {
        channelId: '1',
        channelCode: 'default-channel',
        updatedAt: '2026-09-01T00:00:00.000Z',
        defaultCurrencyCode: 'CNY',
        availableCurrencyCodes: ['CNY', 'MYR'],
        selectorEnabled: true,
        rateMode: 'AUTO',
        cnyToMyrRate: 0.61,
        markupPercent: 1,
        roundingMode: 'CENT',
        usdtDisplayEnabled: false,
        usdtMarkupPercent: 0.5,
        usdtRateScheduleMode: 'INTERVAL',
        usdtRateIntervalMinutes: 5,
        usdtRateDailyTime: '10:00',
        cnyPerUsdtRate: 7.2,
        myrPerUsdtRate: 4.392,
        usdtRateSource: 'Binance + OKX',
        usdtRateUpdatedAt: '2026-09-01T00:00:00.000Z',
        usdtRateNextRunAt: '2026-09-01T00:05:00.000Z',
        usdtRateExpiresAt: '2026-09-01T00:15:00.000Z',
        usdtRateAvailable: true,
        usdtPaymentConfigured: false,
        usdtPaymentNetwork: 'TRC20',
        usdtReceivingAddressMasked: null,
        usdtReceivingAddressFingerprint: null,
        usdtWalletReviewStatus: 'UNCONFIGURED',
    },
    myStoreUsdtWallet: {
        channelId: '1',
        channelCode: 'default-channel',
        reviewStatus: 'UNCONFIGURED',
        configured: false,
        network: 'TRC20',
        activeReceivingAddressMasked: null,
        activeReceivingAddressFingerprint: null,
        pendingReceivingAddress: null,
        pendingReceivingAddressFingerprint: null,
        canReview: false,
        submittedAt: null,
        reviewedAt: null,
        rejectionReason: null,
    },
};
const fixtureOrder = {
    id: 'fixture-order',
    createdAt: now,
    updatedAt: now,
    orderPlacedAt: now,
    code: 'DEMO-001',
    state: 'PaymentSettled',
    active: false,
    totalQuantity: 1,
    totalWithTax: 5000,
    currencyCode: 'MYR',
    customer: { id: 'customer-1', firstName: '示例', lastName: '客户', emailAddress: 'demo@example.invalid' },
    lines: [],
    fulfillments: [],
    payments: [],
};
const data: Record<string, unknown> = {
    products: { items: [product], totalItems: 1 },
    catalogProductOperations: [],
    physicalFulfillmentTodoCount: 3,
    afterSalesRequests: { totalItems: 2, items: [] },
    storefrontReviews: {
        totalItems: 1,
        averageRating: 4,
        items: [
            {
                id: 'review-1',
                createdAt: now,
                updatedAt: now,
                state: 'PENDING',
                rating: 4,
                title: '示例评价',
                body: '本地布局验收内容',
                customerName: '示例客户',
                productName: product.name,
                sku: variants[0].sku,
                merchantResponse: null,
                moderatedAt: null,
                verifiedPurchase: true,
            },
        ],
    },
    autoCardTodoSummary: { lowStockSkuCount: 1, waitingStockDeliveryCount: 0, manualReviewCount: 0 },
    orders: { items: [fixtureOrder], totalItems: 1 },
    dashboardMetricSummary: [
        { type: 'OrderCount', title: '订单', entries: [{ label: '当前', value: 1 }] },
        { type: 'OrderTotal', title: '销售额', entries: [{ label: '当前', value: 5000 }] },
    ],
    pendingSearchIndexUpdates: 0,
    catalogIntegritySummary: {
        totalProducts: 1,
        totalVariants: 1,
        productsWithoutVariants: 0,
        variantsWithoutCategory: 0,
        variantsWithoutCost: 0,
    },
    stockLocations: { items: [{ id: 'location-1', name: '示例仓库' }], totalItems: 1 },
    ...unconfiguredSetup,
    activeChannel: channel,
    channels: { items: [channel], totalItems: 1 },
    myStoreCommerceMode: { mode: 'HYBRID', conflicts: [] },
    product,
    facets: empty,
    assets: empty,
    productOptionGroups: empty,
    collections: { items: collections, totalItems: collections.length },
    selectedCollections: empty,
    catalogSuppliers: empty,
    suppliers: empty,
    catalogProductWorkspace: {
        productId: product.id,
        channelId: channel.id,
        currencyCode: 'MYR',
        stockLocations: [{ id: 'stock-1', name: '示例仓库' }],
        variants: variants.map(v => ({
            ...v,
            sellingPrice: 5000,
            purchaseCostMicrounits: 25000,
            grossProfitMicrounits: 25000,
            margin: 0.5,
            stockLevels: [
                {
                    stockLocationId: 'stock-1',
                    stockLocationName: '示例仓库',
                    stockOnHand: 30,
                    stockAllocated: 2,
                    stockAvailable: 28,
                    minimumStock: 0,
                    maximumStock: 100,
                },
            ],
            lots: [],
        })),
    },
    productPackaging: null,
    productPackagingStock: null,
    catalogProfitReport: {
        summary,
        totalItems: 8,
        items: Array.from({ length: 8 }, (_, i) => ({
            ...summary,
            id: `order-${i}`,
            code: `LAYOUT-${i + 1}`,
            orderPlacedAt: now,
        })),
    },
    contentTranslationStaleCount: states.filter(state => state.status === 'FAILED').length,
    contentTranslationAudit: {
        configured: true,
        provider: 'GEMINI',
        total: states.length,
        counts: [
            { status: 'COMPLETED', count: states.filter(state => state.status === 'COMPLETED').length },
            { status: 'FAILED', count: states.filter(state => state.status === 'FAILED').length },
        ],
        states,
    },
    jobs: { items: jobs, totalItems: 1000 },
    jobQueues: [
        { name: 'translate-content', running: view !== 'health' },
        { name: 'apply-collection-filters', running: view !== 'health' },
    ],
    scheduledTasks: [],
    settingsStoreFieldDefinitions:
        view === 'health' && params.get('worker') !== 'missing'
            ? [
                  {
                      key: 'systemOperations.workerHeartbeat',
                      readonly: true,
                      scopeType: 'GLOBAL',
                      currentValue: {
                          state: params.get('worker') === 'stopped' ? 'STOPPED' : 'RUNNING',
                          heartbeatAt: new Date(
                              Date.now() - (params.get('worker') === 'stale' ? 90_000 : 0),
                          ).toISOString(),
                          queues: [
                              { name: 'translate-content', running: true },
                              { name: 'apply-collection-filters', running: true },
                          ],
                      },
                  },
              ]
            : [],
    apiKeys: empty,
    activeAdministrator: null,
    storefrontContentBlocks: [],
    storeUsdtWallets: [wallet],
    storePaymentStats: [{ ...payment, settledCount: 1, refundCount: 0, grossAmount: 5000 }],
    storePaymentDetails: { items: [payment], totalItems: 1 },
    storeUsdtManualRefunds: empty,
    storeUsdtPaymentStats: [
        {
            channelId: channel.id,
            channelCode: channel.code,
            totalCount: 1,
            pendingCount: 0,
            settledCount: 0,
            manualReviewCount: 1,
            expiredCount: 0,
            expectedUsdtTotal: 10,
            receivedUsdtTotal: 9,
            fiatTotals: [{ currencyCode: 'MYR', amount: 5000 }],
        },
    ],
    storeUsdtPaymentIntents: [],
};
// Project only the requested fields; absent nullable values remain null.
function project(
    source: unknown,
    selection: SelectionSetNode,
    fragments: Record<string, FragmentDefinitionNode>,
): unknown {
    if (Array.isArray(source)) return source.map(item => project(item, selection, fragments));
    if (source == null) return null;
    const result: Record<string, unknown> = {};
    for (const field of selection.selections) {
        if (field.kind === Kind.FRAGMENT_SPREAD) {
            Object.assign(result, project(source, fragments[field.name.value].selectionSet, fragments));
            continue;
        }
        if (field.kind === Kind.INLINE_FRAGMENT) {
            Object.assign(result, project(source, field.selectionSet, fragments));
            continue;
        }
        const typeFragment = selection.selections.find(item => item.kind === Kind.FRAGMENT_SPREAD);
        const value =
            (source as Record<string, unknown>)[field.name.value] ??
            (field.name.value === '__typename'
                ? typeFragment?.kind === Kind.FRAGMENT_SPREAD
                    ? fragments[typeFragment.name.value].typeCondition.name.value
                    : 'LayoutFixture'
                : null);
        result[field.alias?.value ?? field.name.value] = field.selectionSet
            ? project(value, field.selectionSet, fragments)
            : value;
    }
    return result;
}
const client = new ApolloClient({
    cache: new InMemoryCache(),
    link: new ApolloLink(
        operation =>
            new Observable(observer => {
                const definition = operation.query.definitions.find(
                    d => d.kind === Kind.OPERATION_DEFINITION,
                );
                if (
                    !definition ||
                    definition.kind !== Kind.OPERATION_DEFINITION ||
                    definition.operation !== 'query'
                ) {
                    observer.error(new Error('本地布局验收禁止写入'));
                    return;
                }
                const fragments = Object.fromEntries(
                    operation.query.definitions
                        .filter(d => d.kind === Kind.FRAGMENT_DEFINITION)
                        .map(d => [d.name.value, d]),
                );
                let responseData = data;
                if (operation.operationName === 'NextAdminContentTranslationAudit') {
                    const options = operation.variables.options ?? {};
                    const filtered = states.filter(
                        item =>
                            (!options.status || item.status === options.status) &&
                            (!options.entityType || item.entityType === options.entityType) &&
                            (!options.search ||
                                `${item.entityType} ${item.entityId} ${item.fieldPath} ${item.status} ${item.error ?? ''}`
                                    .toLowerCase()
                                    .includes(String(options.search).toLowerCase())),
                    );
                    responseData = {
                        ...data,
                        contentTranslationAudit: {
                            ...(data.contentTranslationAudit as object),
                            total: states.length,
                            filteredTotal: filtered.length,
                            states: filtered.slice(
                                options.skip ?? 0,
                                (options.skip ?? 0) + (options.take ?? 20),
                            ),
                        },
                    };
                }
                observer.next({
                    data: project(responseData, definition.selectionSet, fragments) as Record<
                        string,
                        unknown
                    >,
                });
                observer.complete();
            }),
    ),
});
defineNextAdminExtension({
    id: 'admin-layout-fixture',
    actions: [CatalogImportAction, CatalogExportAction].map((component, i) => ({
        id: `layout-action-${i}`,
        pageId: 'product-list',
        component,
    })),
    pageBlocks: [
        CatalogOperationsBlock,
        ProductVariantPricesBlock,
        ProductVariantCustomFieldsBlock,
        ProductPackagingBlock,
    ].map((component, i) => ({ id: `layout-extension-${i}`, pageId: 'product-detail', component })),
});
class FixtureBoundary extends React.Component<React.PropsWithChildren, { error: string }> {
    state = { error: '' };
    static getDerivedStateFromError(error: Error) {
        return { error: error.stack ?? error.message };
    }
    render() {
        return this.state.error ? <pre role="alert">{this.state.error}</pre> : this.props.children;
    }
}
const paymentSettingsData = {
    activeChannel: channel,
    paymentMethods: empty,
    shippingMethods: empty,
    paymentMethodHandlers: [],
    paymentMethodEligibilityCheckers: [],
    shippingEligibilityCheckers: [],
    shippingCalculators: [],
    fulfillmentHandlers: [],
} as unknown as StoreManagementResult;
const modules: Record<string, React.ReactNode> = {
    dashboard: <DashboardModule />,
    sales: <SalesModule />,
    reviews: <ReviewsModule />,
    catalog: <CatalogModule />,
    paymentSettings: (
        <div className="p-5">
            <PaymentShippingManager
                section="payment"
                data={paymentSettingsData}
                paymentMethodCustomFields={[]}
                shippingMethodCustomFields={[]}
                onChanged={async () => {}}
                onError={() => {}}
            />
        </div>
    ),
    product: <ProductEditor />,
    profit: <ProfitReportModule />,
    translations: <TranslationsModule />,
    jobs: <SystemOpsModule />,
    health: <SystemOpsModule />,
    usdt: <UsdtPaymentManagementModule />,
    plugins: <ClientPluginsModule />,
    copy: <BusinessServicesCopyModule />,
    categories: <CategoriesModule />,
};
createRoot(document.getElementById('root')!).render(
    <ApolloProvider client={client}>
        <AdminPermissionsProvider permissions={['SuperAdmin']}>
            <ConfirmDialogContext.Provider value={async () => false}>
                <CustomFieldsContext.Provider
                    value={{
                        availableLanguages: ['zh_Hans', 'en'],
                        entities: [
                            {
                                entityName: 'ProductVariant',
                                customFields: [
                                    {
                                        name: 'deliveryNote',
                                        type: 'text',
                                        list: false,
                                        nullable: true,
                                        label: [{ languageCode: 'zh_Hans', value: '交付说明' }],
                                    },
                                ],
                            },
                        ],
                    }}
                >
                    <FeatureHelpProvider>
                        <div className="flex h-screen min-w-0">
                            <aside className="hidden w-64 shrink-0 border-r border-slate-200 bg-white p-5 md:block">
                                <strong>后台布局验收</strong>
                                <nav className="mt-5 space-y-4">
                                    {Object.keys(modules).map(name => (
                                        <a
                                            key={viewLabels[name]}
                                            className="block text-sm text-blue-600"
                                            href={`?view=${name}`}
                                        >
                                            {viewLabels[name]}
                                        </a>
                                    ))}
                                </nav>
                            </aside>
                            <div className="flex min-w-0 flex-1 flex-col">
                                <div className="shrink-0 bg-amber-100 px-4 py-2 text-xs text-amber-900">
                                    本地模拟数据 · 所有写入均已阻止
                                </div>
                                <div className="min-h-0 flex-1 overflow-auto">
                                    <MemoryRouter
                                        initialEntries={[
                                            view === 'product'
                                                ? '/catalog/products/layout-product'
                                                : view === 'jobs'
                                                  ? '/settings/system-ops?tab=jobs'
                                                  : view === 'health'
                                                    ? '/settings/system-ops?tab=health'
                                                    : '/',
                                        ]}
                                    >
                                        <Routes>
                                            <Route
                                                path={view === 'product' ? '/catalog/products/:id' : '*'}
                                                element={
                                                    <FixtureBoundary>
                                                        {modules[view] ?? modules.product}
                                                    </FixtureBoundary>
                                                }
                                            />
                                        </Routes>
                                    </MemoryRouter>
                                </div>
                            </div>
                        </div>
                    </FeatureHelpProvider>
                </CustomFieldsContext.Provider>
            </ConfirmDialogContext.Provider>
        </AdminPermissionsProvider>
    </ApolloProvider>,
);
