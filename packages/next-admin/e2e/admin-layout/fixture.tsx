import { ApolloClient, ApolloLink, Observable } from '@apollo/client';
import { ApolloProvider } from '@apollo/client/react';
import { Kind, type FragmentDefinitionNode, type SelectionSetNode } from 'graphql';
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { storefrontClientPluginCatalog } from '../../../storefront-content-plugin/src/client-plugin-manifest';
import { AdminPermissionsProvider } from '../../src/components/admin-permissions-context';
import { AdminButton, PAGE_REFRESH_EVENT } from '../../src/components/AdminControls';
import { AdminPageWorkspace } from '../../src/components/AdminPageWorkspace';
import { ConfirmDialogContext } from '../../src/components/confirm-dialog-context';
import { FeatureHelpProvider } from '../../src/components/FeatureHelp';
import { CustomFieldsContext } from '../../src/custom-fields/custom-fields-context';
import type { StoreManagementResult, StoreProfileRecord } from '../../src/graphql/management.graphql';
import '../../src/index.css';
import { AppShell } from '../../src/layouts/AppShell';
import { AssetsModule } from '../../src/pages/Catalog/AssetsModule';
import { CatalogModule } from '../../src/pages/Catalog/CatalogModule';
import { CategoriesModule } from '../../src/pages/Catalog/CategoriesModule';
import { ProductEditor } from '../../src/pages/Catalog/ProductEditor';
import { PurchaseOrdersModule } from '../../src/pages/Catalog/PurchaseOrdersModule';
import { StoreAllocationMatrixModule } from '../../src/pages/Catalog/StoreAllocationMatrixModule';
import { SuppliersModule } from '../../src/pages/Catalog/SuppliersModule';
import { DashboardModule } from '../../src/pages/Dashboard/DashboardModule';
import { MarketingAttributionPanel } from '../../src/pages/Marketing/MarketingAttributionPanel';
import { defaultReportFilter } from '../../src/pages/Marketing/promotion-model';
import { CouponReport } from '../../src/pages/Marketing/promotion-reports';
import { ClientPluginsModule } from '../../src/pages/Plugins/ClientPluginsModule';
import { AfterSalesModule } from '../../src/pages/Sales/AfterSalesModule';
import { CardPoolModule } from '../../src/pages/Sales/CardPoolModule';
import { DraftOrderEditor } from '../../src/pages/Sales/OrderWorkflowEditor';
import { ProfitReportModule } from '../../src/pages/Sales/ProfitReportModule';
import { SalesModule } from '../../src/pages/Sales/SalesModule';
import { PaymentShippingManager } from '../../src/pages/Settings/PaymentShippingManager';
import { RolesModule } from '../../src/pages/Settings/RolesModule';
import { StoreEditor } from '../../src/pages/Settings/StoreDialogs';
import { StoresPanel } from '../../src/pages/Settings/StorePanels';
import { SystemOpsModule } from '../../src/pages/Settings/SystemOpsModule';
import { TranslationsModule } from '../../src/pages/Settings/TranslationsModule';
import { UsdtPaymentManagementModule } from '../../src/pages/Settings/UsdtPaymentManagementModule';
import { BusinessServicesCopyModule } from '../../src/pages/Storefront/BusinessServicesCopyModule';
import { ReviewsModule } from '../../src/pages/Storefront/ReviewsModule';
import { createAdminCache } from '../../src/runtime/admin-cache';
import { ThemeProvider } from '../../src/theme/ThemeProvider';
import { FieldLayoutFixture } from './field-layout-fixture';

// Synthetic local data only. No HTTP link; every mutation is rejected.
const params = new URLSearchParams(location.search);
const view = params.get('view') ?? 'product';
const viewLabels: Record<string, string> = {
    fields: '字段横排验收',
    draft: '草稿订单',
    team: '员工与权限',
    allocation: '商品分配',
    assets: '素材',
    cardpool: '卡密库',
    aftersales: '售后',
    dashboard: '工作台',
    sales: '订单列表',
    reviews: '买家评价',
    catalog: '商品列表',
    suppliers: '供货商',
    paymentSettings: '支付设置',
    product: '商品编辑',
    profit: '利润统计',
    couponReport: '优惠券经营报表',
    attribution: '渠道归因与投放回报',
    translations: '多语言翻译',
    jobs: '系统任务',
    health: '服务健康',
    usdt: 'USDT 收款',
    plugins: '客户端插件',
    copy: '商业服务文案',
    categories: '商品分类',
    purchases: '采购与收货',
    stores: '店铺设置',
};
if (!params.has('light')) document.documentElement.classList.add('dark');
const now = '2026-09-09T10:00:00Z';
const channel = {
    id: 'layout-channel',
    code: '布局验收店铺',
    customFields: { storefrontNameZh: '布局验收店铺', storefrontNameEn: 'Layout demo' },
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
    catalogTemplateLibrary: [],
    order: {
        ...fixtureOrder,
        id: 'layout-order',
        state: 'Draft',
        customer: null,
        salesChannel: channel,
        nextStates: ['Cancelled', 'ArrangingPayment'],
        couponCodes: [],
        shippingLines: [],
        totalWithTax: 0,
    },
    myAdministratorAccess: {
        id: 'local-access',
        scope: 'STORE',
        authority: 'ADMIN',
        status: 'ACTIVE',
        channel,
    },
    manageableAdministrators: Array.from({ length: params.has('empty') ? 0 : 3 }, (_, i) => ({
        id: `access-${i}`,
        scope: 'STORE',
        authority: 'STAFF',
        status: 'ACTIVE',
        channel,
        administrator: {
            id: `member-${i}`,
            firstName: '示例',
            lastName: `员工 ${i + 1}`,
            emailAddress: `staff${i}@example.invalid`,
            createdAt: now,
            updatedAt: now,
            user: { id: `user-${i}`, identifier: `staff${i}`, lastLogin: now, roles: [] },
        },
    })),
    manageableRoles: [
        {
            id: 'role-1',
            code: 'store-staff',
            description: '示例员工',
            createdAt: now,
            updatedAt: now,
            permissions: ['ReadProduct'],
            channels: [channel],
        },
    ],
    manageableChannels: [channel],
    permissionPolicyCatalog: { permissions: [], templates: [] },
    platformCatalogProducts: {
        totalItems: 0,
        items: [],
        categories: [],
        ownershipReviewCount: 0,
        unassignedCount: 0,
        channels: [
            {
                id: channel.id,
                displayName: channel.code,
                currencyCode: 'MYR',
                assignedCount: 0,
                coverageDenominator: 0,
            },
        ],
    },
    platformCatalogResources: [],
    myStoreCatalogStatus: {
        authorized: params.has('empty') ? 0 : params.has('many') ? 60 : 1,
        listed: params.has('empty') ? 0 : params.has('many') ? 60 : 1,
        paused: 0,
        pending: 0,
        outOfStock: 0,
        items: params.has('empty')
            ? []
            : Array.from({ length: params.has('many') ? 60 : 1 }, (_, i) => ({
                  productId: params.has('many') ? `layout-many-${i}` : product.id,
                  listed: true,
                  pending: false,
                  paused: false,
                  outOfStock: false,
              })),
    },
    products: params.has('empty')
        ? empty
        : {
              items: [
                  {
                      ...product,
                      collections: params.has('categoryRegression')
                          ? [
                                {
                                    id: 'category-1',
                                    name: 'Codex订阅',
                                    slug: 'codex',
                                    parent: {
                                        id: 'root',
                                        name: '未填写中文名称',
                                        slug: '__root_collection__',
                                    },
                                },
                                {
                                    id: 'category-2',
                                    name: '成品账号',
                                    slug: 'ready-account',
                                    parent: { id: 'category-1', name: 'Codex订阅', slug: 'codex' },
                                },
                            ]
                          : product.collections,
                  },
              ],
              totalItems: 1,
          },
    catalogProductOperations: [],
    catalogProductChannelAssignments: {
        items: [
            {
                id: product.id,
                name: product.name,
                enabled: true,
                channels: [
                    { id: channel.id, code: channel.code, displayName: '布局验收店铺', isDefault: false },
                ],
            },
        ],
        totalItems: 1,
        channels: [{ id: channel.id, code: channel.code, displayName: '布局验收店铺', isDefault: false }],
        scopeChannel: { id: channel.id, code: channel.code, isDefault: false },
        summary: { totalItems: 1, unassignedItems: 0, multiChannelItems: 0, channelCounts: [] },
    },
    physicalFulfillmentTodoCount: 3,
    fulfillmentDeliveryExceptions: empty,
    storefrontReviewSettings: { enabled: true },
    customers: empty,
    eligibleShippingMethodsForDraftOrder: [],
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
    catalogTemplateLibrary: [],
    collectionFilters: [],
    productVariants: empty,
    collections: { items: collections, totalItems: collections.length },
    selectedCollections: empty,
    catalogSuppliers: {
        items: Array.from({ length: params.has('empty') ? 0 : params.has('multi') ? 3 : 1 }, (_, i) => ({
            id: `supplier-${i}`,
            name: `[QA] 模拟采购供货商 ${i + 1}`,
            code: `QA-SUPPLIER-${i + 1}`,
            enabled: view === 'suppliers' || view === 'purchases',
            contactName: null,
            phone: null,
            email: null,
            address: null,
            notes: null,
            linkedVariantCount: 0,
            createdAt: now,
            updatedAt: now,
        })),
        totalItems: params.has('empty') ? 0 : params.has('multi') ? 3 : 1,
    },
    catalogPurchaseOrders: empty,
    suppliers: empty,
    catalogProductWorkspace: {
        productId: product.id,
        channelId: channel.id,
        currencyCode: 'MYR',
        stockLocations: [{ id: 'stock-1', name: '示例仓库' }],
        variants: variants.map(v => ({
            ...v,
            barcode: '',
            specification: '',
            saleUnit: '件',
            purchaseUnit: '件',
            packageQuantity: 1,
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
    productPackagingUnpackEvents: [],
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
    storefrontTraffic: {
        businessDate: '2026-09-09',
        timezone: 'Asia/Shanghai',
        firstRecordedAt: now,
        lastRecordedAt: now,
        days: Array.from({ length: 7 }, (_, index) => ({
            businessDate: `2026-09-${String(index + 3).padStart(2, '0')}`,
            visitorCount: 10 + index,
            pageViewCount: 20 + index * 2,
            ipCount: 7 + index,
        })),
    },
    referralTodayMetrics: {
        businessDate: '2026-09-09',
        visitorCount: 16,
        newCustomerCount: 3,
        consumerCount: 2,
        firstTimeConsumerCount: 1,
        returningConsumerCount: 1,
        orderCount: 2,
        todayInvitedCount: 2,
        todayInvitedPurchaserCount: 1,
        salesByCurrency: [{ currencyCode: 'MYR', sales: 10000 }],
    },
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
    storefrontContentBlocks:
        view === 'plugins' && !params.has('empty')
            ? [
                  {
                      id: 'local-plugins',
                      code: 'storefront-client-plugins',
                      type: 'CLIENT_PLUGINS',
                      updatedAt: now,
                      internalName: '本地插件',
                      layoutVariant: 'CUSTOM',
                      enabled: true,
                      position: 10001,
                      settings: { version: 1 },
                      translations: [],
                      items: storefrontClientPluginCatalog.map((plugin, i) => ({
                          id: `plugin-${i}`,
                          enabled: true,
                          position: i,
                          targetType: 'NONE',
                          translations: [],
                          settings: {
                              pluginCode: plugin.code,
                              placement: plugin.defaultPlacement,
                              categoryScope: 'ALL',
                              categoryIds: [],
                              includeChildren: true,
                          },
                      })),
                  },
              ]
            : [],
    storeUsdtWallets: [wallet],
    storePaymentStats: [{ ...payment, settledCount: 1, refundCount: 0, grossAmount: 5000 }],
    storePaymentDetails: { items: [payment], totalItems: 1 },
    storeUsdtManualRefunds: empty,
    storeUsdtReconciliationActions: [],
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
// GraphQL combines repeated selections (e.g. order lines in a fragment plus their prices).
function mergeProjection(previous: unknown, next: unknown): unknown {
    if (Array.isArray(previous) && Array.isArray(next)) {
        return next.map((value, index) => mergeProjection(previous[index], value));
    }
    if (previous && next && typeof previous === 'object' && typeof next === 'object') {
        const result = { ...previous } as Record<string, unknown>;
        for (const [key, value] of Object.entries(next)) result[key] = mergeProjection(result[key], value);
        return result;
    }
    return next;
}
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
            Object.assign(
                result,
                mergeProjection(result, project(source, fragments[field.name.value].selectionSet, fragments)),
            );
            continue;
        }
        if (field.kind === Kind.INLINE_FRAGMENT) {
            Object.assign(result, mergeProjection(result, project(source, field.selectionSet, fragments)));
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
        const key = field.alias?.value ?? field.name.value;
        const projected = field.selectionSet ? project(value, field.selectionSet, fragments) : value;
        result[key] = mergeProjection(result[key], projected);
    }
    return result;
}
const layoutQueries: { name: string; variables: unknown }[] = [];
Object.assign(window, { layoutQueries });
const client = new ApolloClient({
    cache: createAdminCache(),
    link: new ApolloLink(
        operation =>
            new Observable(observer => {
                let operationTrace: (typeof tabOperations)[number] | undefined;
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
                layoutQueries.push({ name: operation.operationName, variables: operation.variables });
                const fragments = Object.fromEntries(
                    operation.query.definitions
                        .filter(d => d.kind === Kind.FRAGMENT_DEFINITION)
                        .map(d => [d.name.value, d]),
                );
                let responseData = params.has('empty')
                    ? {
                          ...data,
                          storefrontReviews: { items: [], totalItems: 0, averageRating: 0 },
                          afterSalesRequests: empty,
                      }
                    : data;
                if (params.has('many')) {
                    responseData = {
                        ...responseData,
                        products: {
                            items: Array.from({ length: 20 }, (_, i) => ({
                                ...product,
                                id: `layout-many-${i + Number(operation.variables.options?.skip ?? 0)}`,
                                name: `布局验收商品 ${i + 1 + Number(operation.variables.options?.skip ?? 0)}`,
                            })),
                            totalItems: 60,
                        },
                        order: {
                            ...(data.order as object),
                            totalQuantity: 20,
                            totalWithTax: 100000,
                            lines: Array.from({ length: 20 }, (_, i) => ({
                                id: `line-${i}`,
                                quantity: 1,
                                productVariant: {
                                    ...variants[0],
                                    id: `order-variant-${i}`,
                                    name: `示例商品 ${i + 1}`,
                                    sku: `LAYOUT-SKU-${i + 1}`,
                                },
                                unitPriceWithTax: 5000,
                                linePriceWithTax: 5000,
                            })),
                        },
                    };
                }
                if (view === 'tabs') {
                    const productId = String(
                        operation.variables.id ?? operation.variables.productId ?? product.id,
                    );
                    const selectedProduct = {
                        ...product,
                        id: productId,
                        variants: product.variants.map(variant => ({
                            ...variant,
                            id: `${productId}-${variant.id}`,
                        })),
                    };
                    responseData = {
                        ...data,
                        product: selectedProduct,
                        products: {
                            ...data.products,
                            items: [
                                {
                                    ...product,
                                    variants: product.variants.map(variant => ({
                                        ...variant,
                                        id: `${product.id}-${variant.id}`,
                                    })),
                                },
                            ],
                        },
                        catalogProductChannelAssignments: {
                            items: [{ id: productId, channels: [channel] }],
                            totalItems: 1,
                        },
                        catalogProductWorkspace: {
                            ...(data.catalogProductWorkspace as object),
                            productId,
                            variants: [],
                        },
                        globalSettings: {
                            availableLanguages: ['zh_Hans', 'en'],
                            serverConfig: { entityCustomFields: [] },
                        },
                        me: {
                            id: 'tabs-admin',
                            identifier: 'local@example.invalid',
                            channels: [{ ...channel, permissions: ['SuperAdmin'] }],
                        },
                        activeAdministrator: {
                            id: 'tabs-admin',
                            firstName: '模拟',
                            lastName: '验收',
                            emailAddress: 'local@example.invalid',
                            createdAt: now,
                            updatedAt: now,
                            user: {
                                id: 'tabs-admin',
                                identifier: 'local@example.invalid',
                                verified: true,
                                lastLogin: null,
                                authenticationMethods: [],
                                roles: [
                                    {
                                        id: 'local-role',
                                        code: '__super_admin_role__',
                                        description: '',
                                        channels: [channel],
                                    },
                                ],
                            },
                        },
                    };
                    operationTrace = { name: operation.operationName, variables: operation.variables };
                    tabOperations.push(operationTrace);
                    if (
                        params.has('failRefresh') &&
                        operation.operationName === 'GetProducts' &&
                        tabOperations.filter(item => item.name === 'GetProducts').length > 1
                    ) {
                        const timer = window.setTimeout(
                            () => observer.error(new Error('本地模拟更新失败')),
                            200,
                        );
                        return () => window.clearTimeout(timer);
                    }
                }
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
                const finish = () => {
                    if (operationTrace) operationTrace.completed = true;
                    observer.next({
                        data: project(responseData, definition.selectionSet, fragments) as Record<
                            string,
                            unknown
                        >,
                    });
                    observer.complete();
                };
                if (params.has('slowReads')) {
                    const timer = window.setTimeout(finish, Number(params.get('slowReads')) || 200);
                    return () => window.clearTimeout(timer);
                }
                finish();
            }),
    ),
});
const tabOperations: Array<{
    name: string;
    variables: Record<string, unknown>;
    completed?: boolean;
}> = [];
if (view === 'tabs') Object.assign(window, { tabOperations });
class FixtureBoundary extends React.Component<React.PropsWithChildren, { error: string }> {
    state = { error: '' };
    static getDerivedStateFromError(error: Error) {
        return { error: error.stack ?? error.message };
    }
    render() {
        return this.state.error ? (
            <pre data-layout-fixture-error role="alert">
                {this.state.error}
            </pre>
        ) : (
            this.props.children
        );
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

const storeProfileSamples: StoreProfileRecord[] = [
    '示例店铺一',
    '示例店铺二',
    '示例店铺三',
    '正式营业示例',
].map((name, index) => {
    const ready = index === 3 || (index === 0 && params.has('ready'));
    return {
        id: `layout-store-${index + 1}`,
        updatedAt: now,
        status: index === 3 ? 'ACTIVE' : 'DRAFT',
        isPublished: index === 1,
        isOperational: index === 1 || index === 3,
        sortOrder: index,
        descriptionZh: index === 0 ? '' : '本地验收示例店铺',
        descriptionEn: '',
        taglineZh: null,
        taglineEn: null,
        brandBackgroundColor: null,
        brandPrimaryColor: null,
        brandAccentColor: null,
        brandHighlightColor: null,
        legalEntityName: null,
        legalRegistrationCountry: null,
        legalRegistrationNumber: null,
        legalContactAddress: null,
        supportEmail: null,
        privacyEmail: null,
        internalNote: null,
        primaryDomain: index === 2 ? null : `store-${index + 1}.example.invalid`,
        storefrontUrl: null,
        activationReadiness: {
            ready,
            checks: ready
                ? []
                : index === 2
                  ? [
                        {
                            code: 'DOMAIN',
                            ready: false,
                            message: '请配置并验证主域名',
                            messageEn: 'Domain missing',
                        },
                    ]
                  : [
                        ...(index === 0
                            ? [
                                  {
                                      code: 'PROFILE',
                                      ready: false,
                                      message: '请填写店铺简介',
                                      messageEn: 'Profile missing',
                                  },
                              ]
                            : []),
                        {
                            code: 'PAYMENT',
                            ready: false,
                            message: '请启用正式支付方式',
                            messageEn: 'Payment missing',
                        },
                    ],
        },
        logoAsset: null,
        logoOnLightAsset: null,
        logoOnDarkAsset: null,
        channel: {
            ...channel,
            id: `layout-channel-${index + 1}`,
            code: `layout-shop-${index + 1}`,
            token: `fixture-channel-${index + 1}`,
            seller: null,
            customFields: { storefrontNameZh: name, storefrontNameEn: `Fixture ${index + 1}` },
        },
    };
});
const storeFixtureWindow = window as Window & { storePreviewRequests: string[] };
storeFixtureWindow.storePreviewRequests = [];

function StoreManagementFixture() {
    const [activeChannelId, setActiveChannelId] = useState('layout-channel-1');
    const [editing, setEditing] = useState<StoreProfileRecord | null>(null);
    return (
        <div className="space-y-4 p-5">
            <label className="block text-sm font-bold">
                当前店铺（本地验收）
                <select
                    value={activeChannelId}
                    onChange={event => setActiveChannelId(event.target.value)}
                    className="ml-3 rounded-lg border border-slate-300 bg-white px-3 py-2"
                >
                    {storeProfileSamples.map(profile => (
                        <option key={profile.id} value={profile.channel.id}>
                            {profile.channel.customFields.storefrontNameZh}
                        </option>
                    ))}
                </select>
            </label>
            <StoresPanel
                profiles={storeProfileSamples}
                activeChannelId={activeChannelId}
                publicPreviewBusy={false}
                onTogglePublicPreview={profile => {
                    // Record the target only; no profile or storefront is changed.
                    storeFixtureWindow.storePreviewRequests.push(profile.id);
                }}
                onEdit={setEditing}
                onDeprovision={() => {}}
                allowPermanentDeprovision={true}
            />
            {editing && (
                <StoreEditor
                    profile={editing}
                    onClose={() => setEditing(null)}
                    onCompleted={async () => {}}
                    onError={() => {}}
                />
            )}
        </div>
    );
}

function CouponReportFixture() {
    const [filter, setFilter] = React.useState(defaultReportFilter);
    return (
        <div className="p-4">
            <CouponReport
                coupons={[]}
                currencyCode="MYR"
                filter={filter}
                setFilter={setFilter}
                metrics={[]}
                loading={false}
            />
        </div>
    );
}

const modules: Record<string, React.ReactNode> = {
    fields: <FieldLayoutFixture />,
    draft: <DraftOrderEditor />,
    team: <RolesModule />,
    allocation: <StoreAllocationMatrixModule />,
    assets: <AssetsModule />,
    cardpool: <CardPoolModule />,
    aftersales: <AfterSalesModule />,
    dashboard: <DashboardModule />,
    sales: <SalesModule />,
    reviews: <ReviewsModule />,
    catalog: <CatalogModule />,
    suppliers: <SuppliersModule />,
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
    couponReport: <CouponReportFixture />,
    attribution: (
        <div className="p-4">
            <MarketingAttributionPanel currencyCode="MYR" />
        </div>
    ),
    translations: <TranslationsModule />,
    jobs: <SystemOpsModule />,
    health: <SystemOpsModule />,
    usdt: <UsdtPaymentManagementModule />,
    plugins: <ClientPluginsModule />,
    copy: <BusinessServicesCopyModule />,
    categories: <CategoriesModule />,
    purchases: <PurchaseOrdersModule />,
    stores: <StoreManagementFixture />,
};
if (view === 'tabs') {
    createRoot(document.getElementById('root')!).render(
        <ThemeProvider>
            <ApolloProvider client={client}>
                <ConfirmDialogContext.Provider value={async () => false}>
                    <FeatureHelpProvider>
                        <MemoryRouter initialEntries={['/catalog/list']}>
                            <nav
                                aria-label="本地测试导航"
                                className="fixed bottom-0 right-0 z-50 flex gap-3 bg-amber-100 p-2 text-xs"
                            >
                                本地模拟数据 · 写入已阻止
                                <Link to="/catalog/list">测试商品列表</Link>
                                <Link to="/catalog/products/layout-product">测试商品一</Link>
                                <Link to="/catalog/products/layout-product-2">测试商品二</Link>
                                <AdminButton
                                    type="button"
                                    onClick={() => {
                                        const page = Array.from(
                                            document.querySelectorAll<HTMLElement>(
                                                '#main-content [data-admin-page]',
                                            ),
                                        ).find(element => !element.closest('[hidden]'))?.dataset.adminPage;
                                        if (page)
                                            window.dispatchEvent(
                                                new CustomEvent(PAGE_REFRESH_EVENT, { detail: { page } }),
                                            );
                                    }}
                                >
                                    刷新当前测试标签
                                </AdminButton>
                            </nav>
                            <Routes>
                                <Route element={<AppShell />}>
                                    <Route path="dashboard" element={<DashboardModule />} />
                                    <Route path="catalog/list" element={<CatalogModule />} />
                                    <Route path="catalog/products/:id" element={<ProductEditor />} />
                                </Route>
                            </Routes>
                        </MemoryRouter>
                    </FeatureHelpProvider>
                </ConfirmDialogContext.Provider>
            </ApolloProvider>
        </ThemeProvider>,
    );
} else {
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
                                <aside className="hidden w-64 shrink-0 overflow-y-auto border-r border-slate-200 bg-white p-5 md:block">
                                    <strong>后台布局验收</strong>
                                    <nav className="mt-5 space-y-2">
                                        {Object.keys(modules).map(name => (
                                            <a
                                                key={viewLabels[name]}
                                                className="block text-sm text-blue-600"
                                                href={`?view=${name}&light${params.has('empty') ? '&empty' : ''}`}
                                            >
                                                {viewLabels[name]}
                                            </a>
                                        ))}
                                    </nav>
                                </aside>
                                <div className="flex min-w-0 flex-1 flex-col">
                                    <header className="h-24 shrink-0 border-b border-slate-200 bg-white text-xs">
                                        <div className="flex h-14 items-center justify-between gap-2 px-4">
                                            <strong className="text-slate-700">Vendure 管理后台</strong>
                                            <span className="rounded bg-amber-50 px-2 py-1 text-amber-900">
                                                模拟数据 · 写入已阻止
                                            </span>
                                        </div>
                                        <div className="flex h-10 items-center border-t border-slate-100 bg-slate-50 px-4 font-semibold text-slate-700">
                                            {viewLabels[view]} · 布局验收
                                        </div>
                                    </header>
                                    <div id="fixture-content" className="min-h-0 flex-1 overflow-hidden">
                                        <MemoryRouter
                                            initialEntries={[
                                                view === 'draft'
                                                    ? '/sales/orders/draft/layout-order'
                                                    : view === 'team'
                                                      ? `/settings/team?tab=${params.get('tab') ?? 'members'}`
                                                      : view === 'product'
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
                                                    path={
                                                        view === 'draft'
                                                            ? '/sales/orders/draft/:id'
                                                            : view === 'product'
                                                              ? '/catalog/products/:id'
                                                              : '*'
                                                    }
                                                    element={
                                                        <FixtureBoundary>
                                                            <AdminPageWorkspace
                                                                page={`fixture:${view}`}
                                                                active
                                                            >
                                                                {modules[view] ?? modules.product}
                                                            </AdminPageWorkspace>
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
}
