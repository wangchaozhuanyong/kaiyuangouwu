import { ApolloClient, ApolloLink, Observable } from '@apollo/client';
import { ApolloProvider } from '@apollo/client/react';
import { Kind, print, type FragmentDefinitionNode, type SelectionSetNode } from 'graphql';
import React, { Suspense, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Link, MemoryRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { storefrontClientPluginCatalog } from '../../../storefront-content-plugin/src/client-plugin-manifest';
import { AdminPermissionsProvider } from '../../src/components/admin-permissions-context';
import { AdminButton, PAGE_REFRESH_EVENT } from '../../src/components/AdminControls';
import { AdminOverlayHost } from '../../src/components/AdminOverlayHost';
import { AdminPageWorkspace } from '../../src/components/AdminPageWorkspace';
import { ConfirmDialogContext } from '../../src/components/confirm-dialog-context';
import { ConfirmDialogProvider } from '../../src/components/ConfirmDialog';
import { FeatureHelpProvider } from '../../src/components/FeatureHelp';
import type { EntityCustomFieldsDefinition } from '../../src/custom-fields/custom-field-types';
import { CustomFieldsContext } from '../../src/custom-fields/custom-fields-context';
import {
    getNextAdminExtensionLegacyRoutes,
    getNextAdminExtensionRoutes,
} from '../../src/extensions/extension-api';
import '../../src/extensions/installed-extensions';
import type { StoreManagementResult, StoreProfileRecord } from '../../src/graphql/management.graphql';
import '../../src/index.css';
import { AppShell } from '../../src/layouts/AppShell';
import { STANDALONE_ADMIN_PAGES, getStandaloneAdminRedirect } from '../../src/navigation/admin-navigation';
import { InitialPasswordChangeModule } from '../../src/pages/Auth/InitialPasswordChangeModule';
import { LoginModule } from '../../src/pages/Auth/LoginModule';
import { ProfileModule } from '../../src/pages/Auth/ProfileModule';
import { AssetsModule } from '../../src/pages/Catalog/AssetsModule';
import { CatalogModule } from '../../src/pages/Catalog/CatalogModule';
import { CategoriesModule } from '../../src/pages/Catalog/CategoriesModule';
import { ProductEditor } from '../../src/pages/Catalog/ProductEditor';
import { PurchaseOrdersModule } from '../../src/pages/Catalog/PurchaseOrdersModule';
import { StoreAllocationMatrixModule } from '../../src/pages/Catalog/StoreAllocationMatrixModule';
import { SuppliersModule } from '../../src/pages/Catalog/SuppliersModule';
import { CustomersModule } from '../../src/pages/Customers/CustomersModule';
import { DashboardModule } from '../../src/pages/Dashboard/DashboardModule';
import { MarketingAttributionPanel } from '../../src/pages/Marketing/MarketingAttributionPanel';
import { defaultReportFilter } from '../../src/pages/Marketing/promotion-model';
import { CouponReport } from '../../src/pages/Marketing/promotion-reports';
import { ClientPluginsModule } from '../../src/pages/Plugins/ClientPluginsModule';
import { AfterSalesModule } from '../../src/pages/Sales/AfterSalesModule';
import { CardPoolModule } from '../../src/pages/Sales/CardPoolModule';
import { OrderEditor } from '../../src/pages/Sales/OrderEditor';
import { DraftOrderEditor, ModifyOrderEditor } from '../../src/pages/Sales/OrderWorkflowEditor';
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
import type { CollectionFilterValue } from '../../src/utils/product-collection-assignment';
import { adminRolloutFixtureData } from './admin-rollout-fixture-data';
import { FieldLayoutFixture } from './field-layout-fixture';
import { FixtureAuditTheme } from './fixture-audit-theme';
import { FixtureSettingsConfirmation } from './fixture-confirmation';
import { PerformanceFixture } from './performance-fixture';
import {
    productEditorDesignCategories,
    productEditorDesignContent,
    productEditorDesignCustomFields,
    productEditorDesignFacets,
} from './product-editor-design-data';

// Synthetic local data only. No HTTP link. Mutations are blocked unless an explicit mockWrites flag enables the small local-only whitelist below.
const params = new URLSearchParams(location.search);
const view = params.get('view') ?? 'product';
const layoutAudit = params.has('layoutAudit');
const adminRollout = params.has('adminRollout');
const productEditorDesign = params.has('productEditorDesign');
const digitalFixture = params.has('digital') || (productEditorDesign && !params.has('physical'));
const productFixtureName = productEditorDesign ? productEditorDesignContent.name : '布局验收示例商品';
const productFixtureSlug = productEditorDesign ? productEditorDesignContent.slug : 'layout-demo';
const productFixtureDescription = productEditorDesign
    ? productEditorDesignContent.description
    : '<p>商品简介和主图应当优先展示。</p>';
const authFixture = view === 'login' || view === 'initial-password';
const mockWritesEnabled =
    params.has('mockWrites') && !layoutAudit && !authFixture && !productEditorDesign && !adminRollout;
const legacyOwnershipFixture = params.has('legacyOwnership') && digitalFixture && mockWritesEnabled;
const legacyStockLevel = {
    id: 'legacy-stock-demo',
    stockLocationId: 'legacy-location-demo',
    stockOnHand: 100,
    stockAllocated: 0,
};
// Platform-only routes use the real shell scope guard; opt in with &platform.
const platformFixture = params.has('platform');
const alternateScopeParams = new URLSearchParams(params);
if (platformFixture) alternateScopeParams.delete('platform');
else alternateScopeParams.set('platform', '');
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
    customers: '客户列表',
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
const mutationReceipts: Array<{ field: string }> = [];
const blockedMutations: Array<{ field: string }> = [];
const fixturePermissions = params.has('restricted')
    ? ['ReadOrder']
    : params.get('role') === 'store-admin'
      ? [
            'ReadStoreProfile',
            'UpdateStoreProfile',
            'ReadChannel',
            'ReadSettings',
            'ReadCatalog',
            'ReadProduct',
            'ReadCollection',
            'ReadFacet',
            'ReadOrder',
            'ReadCustomer',
            'ReadPromotion',
            'ReadReferral',
            'ReadStorefrontContent',
            'UpdateStorefrontContent',
            'ReadAdministrator',
            'ReadSeller',
            'ReadShippingMethod',
            'ReadTaxCategory',
            'ReadTaxRate',
            'ReadCountry',
            'ReadZone',
            'ReadStockLocation',
        ]
      : params.has('restricted')
        ? ['ReadOrder']
        : ['SuperAdmin'];
const channel = {
    id: 'layout-channel',
    code: platformFixture ? '__default_channel__' : productEditorDesign ? 'MOYAO AI｜模钥' : '布局验收店铺',
    customFields: {
        storefrontNameZh: platformFixture
            ? '布局验收平台'
            : productEditorDesign
              ? 'MOYAO AI｜模钥'
              : '布局验收店铺',
        storefrontNameEn: platformFixture ? 'Layout platform' : 'Layout demo',
    },
    token: 'synthetic-layout-channel',
    defaultLanguageCode: 'zh_Hans',
    availableLanguageCodes: ['zh_Hans', 'en'],
    currencyCode: productEditorDesign ? 'CNY' : 'MYR',
    defaultCurrencyCode: productEditorDesign ? 'CNY' : 'MYR',
    availableCurrencyCodes: productEditorDesign ? ['CNY', 'MYR'] : ['MYR', 'CNY'],
};
const empty = { items: [], totalItems: 0 };
// Existing repository artwork is served locally; audit data never changes a real asset binding.
const auditImageUrl = productEditorDesign
    ? productEditorDesignContent.imageUrl
    : new URL('../../../storefront/public/storefront/categories/category-workstations.jpg', import.meta.url)
          .href;
const auditAsset = {
    __typename: 'Asset',
    id: productEditorDesign ? '1048' : 'layout-audit-asset',
    name: productEditorDesign ? 'moyao-product-codex-20261002-v1.png' : '本地布局验收图片',
    preview: auditImageUrl,
    source: auditImageUrl,
    type: 'IMAGE',
    mimeType: productEditorDesign ? 'image/png' : 'image/jpeg',
    createdAt: now,
    updatedAt: now,
};
const auditFacets = productEditorDesign
    ? productEditorDesignFacets
    : [
          ['品牌', 'brand', ['示例自有品牌', '精选系列', '专业系列', '日常系列']],
          ['材质', 'material', ['实木', '金属', '织物', '环保复合材料']],
          ['颜色', 'color', ['暖白', '原木', '石墨黑', '鼠尾草绿']],
          ['适用空间', 'room', ['客厅', '卧室', '书房与家庭工作区', '小户型多功能空间']],
          ['商品特点', 'features', ['可调节', '便于收纳', '易清洁', '适合长时间使用']],
      ].map(([name, code, values], index) => ({
          __typename: 'Facet',
          id: `layout-facet-${index}`,
          name: name as string,
          code: code as string,
          isPrivate: false,
          translations: [{ languageCode: 'zh_Hans', name: name as string }],
          values: (values as string[]).map((value, valueIndex) => ({
              __typename: 'FacetValue',
              id: `layout-facet-${index}-${valueIndex}`,
              name: value,
              code: `${code}-${valueIndex}`,
              facet: { id: `layout-facet-${index}`, name, code },
              translations: [{ languageCode: 'zh_Hans', name: value }],
          })),
      }));
const auditCustomFieldEntities: EntityCustomFieldsDefinition[] = productEditorDesign
    ? productEditorDesignCustomFields
    : [
          {
              entityName: 'Product',
              customFields: [
                  ['auditBrand', '品牌'],
                  ['auditOrigin', '产地'],
                  ['auditMaterial', '主要材质'],
                  ['auditWarranty', '保修期限'],
                  ['auditCare', '保养说明'],
              ].map(([name, label]) => ({
                  __typename: 'StringCustomFieldConfig',
                  name,
                  type: 'string',
                  list: false,
                  nullable: true,
                  label: [{ languageCode: 'zh_Hans', value: label }],
              })),
          },
          {
              entityName: 'ProductVariant',
              customFields: [
                  ...[
                      ['auditSpecification', '规格'],
                      ['auditServicePeriod', '服务周期'],
                      ['auditDeliveryMethod', '交付方式'],
                  ].map(([name, label]) => ({
                      __typename: 'StringCustomFieldConfig',
                      name,
                      type: 'string',
                      list: false,
                      nullable: true,
                      label: [{ languageCode: 'zh_Hans', value: label }],
                  })),
                  {
                      __typename: 'TextCustomFieldConfig',
                      name: 'deliveryNote',
                      type: 'text',
                      list: false,
                      nullable: true,
                      label: [{ languageCode: 'zh_Hans', value: '交付说明' }],
                  },
              ],
          },
      ];
const auditVariantCount = Math.min(12, Math.max(1, Number(params.get('auditVariants')) || 4));
const variants = Array.from(
    {
        length: productEditorDesign
            ? params.has('multi')
                ? 3
                : 1
            : layoutAudit
              ? auditVariantCount
              : params.has('multi')
                ? 3
                : 1,
    },
    (_, i) => ({
        __typename: 'ProductVariant',
        id: `layout-variant-${i}`,
        name: productEditorDesign
            ? `${productEditorDesignContent.variantName}${i ? ` · 本地样本 ${i + 1}` : ''}`
            : `示例商品 ${i + 1}`,
        sku: productEditorDesign
            ? `${productEditorDesignContent.sku}${i ? `-SAMPLE-${i + 1}` : ''}`
            : `LAYOUT-SKU-${i + 1}`,
        enabled: true,
        createdAt: now,
        updatedAt: now,
        price: productEditorDesign ? 68000 : 5000,
        currencyCode: productEditorDesign ? 'CNY' : 'MYR',
        stockOnHand: 30,
        stockAllocated: 2,
        stockLevel: 'IN_STOCK',
        trackInventory: 'TRUE',
        useGlobalOutOfStockThreshold: true,
        options: [],
        facetValues: [],
        stockLevels: [],
        prices: [
            { currencyCode: productEditorDesign ? 'CNY' : 'MYR', price: productEditorDesign ? 68000 : 5000 },
        ],
        translations: [
            {
                languageCode: 'zh_Hans',
                name: productEditorDesign
                    ? `${productEditorDesignContent.variantName}${i ? ` · 本地样本 ${i + 1}` : ''}`
                    : `示例商品 ${i + 1}`,
            },
        ],
        customFields: {
            fulfillmentType: digitalFixture ? 'digital' : 'physical',
            digitalDeliveryMode: 'MANUAL',
            digitalStockPolicy: 'FINITE',
            deliveryNote: '示例交付说明',
            ...(productEditorDesign ? { specification: '1个月' } : {}),
            ...(layoutAudit
                ? {
                      auditSpecification: `标准规格 ${i + 1}`,
                      auditServicePeriod: '12 个月（本地测试）',
                      auditDeliveryMethod: digitalFixture ? '人工数字交付' : '仓库发货',
                  }
                : {}),
        },
    }),
);
const product = {
    __typename: 'Product',
    id: 'layout-product',
    name: productFixtureName,
    slug: productFixtureSlug,
    description: productFixtureDescription,
    enabled: true,
    createdAt: productEditorDesign ? '2026-10-02T03:28:00Z' : now,
    updatedAt: now,
    customFields: {
        fulfillmentType: digitalFixture ? 'digital' : 'physical',
        refundPolicy: 'MERCHANT_REVIEW',
        manualDeliverySlaMinutes: productEditorDesign ? 30 : 1440,
        ...(productEditorDesign ? { sourceCreatedAt: null, pricingMode: 'FIXED' } : {}),
        ...(layoutAudit
            ? {
                  auditBrand: '本地示例品牌',
                  auditOrigin: '本地合成数据',
                  auditMaterial: '实木与金属',
                  auditWarranty: '12 个月（测试值）',
                  auditCare: '使用软布清洁，避免长时间阳光直射。',
              }
            : {}),
    },
    assets: layoutAudit || productEditorDesign ? [auditAsset] : [],
    featuredAsset: (layoutAudit || productEditorDesign) && !params.has('noImage') ? auditAsset : null,
    variants,
    translations: [
        {
            id: 'translation-1',
            languageCode: 'zh_Hans',
            name: productFixtureName,
            slug: productFixtureSlug,
            description: productFixtureDescription,
        },
    ],
    optionGroups: [],
    facetValues: productEditorDesign
        ? auditFacets.slice(3).map(facet => facet.values[1])
        : layoutAudit
          ? auditFacets.map(facet => facet.values[0])
          : [],
    collections: [] as Array<{ id: string; name: string; slug: string; filters: CollectionFilterValue[] }>,
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
    paymentMethodCode: 'usdt-trc20',
    paymentState: 'Settled',
    currencyCode: 'MYR',
    amount: 5000,
    refundedAmount: 0,
    netAmount: 5000,
    transactionId: 'synthetic-transaction',
    createdAt: now,
};
const collections = Array.from(
    { length: productEditorDesign ? productEditorDesignCategories.length : 8 },
    (_, i) => ({
        __typename: 'Collection',
        id: `collection-${i}`,
        name: productEditorDesign ? productEditorDesignCategories[i][0] : `示例分类 ${i + 1}`,
        slug: productEditorDesign ? productEditorDesignCategories[i][1] : `demo-${i}`,
        position: i,
        isPrivate: false,
        createdAt: now,
        updatedAt: now,
        parentId: 'root',
        parent: { id: 'root', name: '根分类' },
        breadcrumbs: [],
        children: [],
        // The editor restores explicit membership from the same rule used by real collections.
        filters:
            productEditorDesign && i === 0
                ? [
                      {
                          code: 'product-id-filter',
                          args: [
                              { name: 'productIds', value: JSON.stringify([product.id]) },
                              { name: 'combineWithAnd', value: 'true' },
                          ],
                      },
                  ]
                : [],
        translations: [
            {
                languageCode: 'zh_Hans',
                name: productEditorDesign ? productEditorDesignCategories[i][0] : `示例分类 ${i + 1}`,
                slug: productEditorDesign ? productEditorDesignCategories[i][1] : `demo-${i}`,
                description: '',
            },
        ],
        description: '',
        featuredAsset: null,
        productVariants: empty,
    }),
);
if (productEditorDesign) product.collections.push(collections[0]);
const unconfiguredSetup = {
    myStoreCurrencyConfiguration: {
        // Keep the typename stable between direct and fragment-based selections.
        __typename: 'StoreCurrencyConfiguration',
        channelId: channel.id,
        channelCode: channel.code,
        updatedAt: '2026-09-01T00:00:00.000Z',
        defaultCurrencyCode: 'CNY',
        availableCurrencyCodes: ['CNY', 'MYR'],
        selectorEnabled: true,
        rateMode: 'AUTO',
        cnyToMyrRate: 0.61,
        markupPercent: 1,
        roundingMode: 'CENT',
        rateSource: 'SYNTHETIC',
        rateUpdatedAt: now,
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
        __typename: 'StoreUsdtWallet',
        channelId: channel.id,
        channelCode: channel.code,
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
const fixtureCustomer = {
    __typename: 'Customer',
    id: 'layout-customer',
    createdAt: now,
    updatedAt: now,
    title: null,
    firstName: '用于移动端长姓名换行验收的模拟客户',
    lastName: '示例',
    emailAddress: 'synthetic.customer.mobile.layout.acceptance@example.invalid',
    phoneNumber: null,
    groups: [],
    user: {
        id: 'layout-customer-user',
        identifier: 'synthetic.customer.mobile.layout.acceptance@example.invalid',
        verified: true,
        lastLogin: now,
    },
    addresses: [],
    orders: { items: [fixtureOrder], totalItems: 1 },
    history: empty,
    customFields: {},
};
const data: Record<string, unknown> = {
    ...unconfiguredSetup,
    telegramNotificationConfig: {
        id: 'layout-telegram',
        enabled: false,
        tokenConfigured: false,
        chatId: '',
        chatIdSource: 'DATABASE',
        adminBaseUrl: '',
        timezone: 'Asia/Kuala_Lumpur',
        minSeverity: 'P3',
        sendResolved: true,
        p2Silent: true,
        p3Silent: true,
        notifyOrderEvents: true,
        notifyPaymentEvents: true,
        notifyFulfillmentEvents: true,
        notifyRefundEvents: true,
        notifyInventoryEvents: true,
        notifyOnlineReports: true,
        notifyServiceReviews: true,
        notifyPromotionExpiry: true,
        notifyAiCredentials: true,
        notifySecurityEvents: true,
        inventoryLowThreshold: 2,
        p1EscalationMinutes: 60,
        p0RepeatMinutes: 30,
        p1RepeatMinutes: 120,
        departmentMentions: {},
        routeOverrides: [],
        botUsername: null,
        lastConnectionAt: null,
        lastConnectionError: null,
    },
    telegramNotificationStatus: {
        running: false,
        processed: 0,
        failures: 0,
        pending: 0,
        retrying: 0,
        dead: 0,
        oldestLagSeconds: 0,
        lastSuccessAt: null,
        lastErrorAt: null,
        lastError: null,
    },
    telegramNotificationConfigAudits: [],
    telegramNotificationDeliveries: empty,
    adminIncidents: empty,
    telegramDepartmentRouting: { departments: [], routes: [] },
    dataRetentionRecords: [],
    dataSubjectRequests: [],
    dataConsentRecords: [],
    governanceApprovals: [],
    fraudRiskCases: empty,
    governanceAuditEntries: empty,
    governanceAuditIntegrity: { valid: true, checkedCount: 0, brokenEntryId: null },
    governanceReports: [],
    governedConfigVersions: [],
    marketingAttributionReport: {
        summary: {
            visitorCount: 2,
            productViewCount: 3,
            checkoutViewCount: 1,
            orderCount: 1,
            netRevenueMicrounits: 300000,
            campaignCostMicrounits: 100000,
            refundAdjustedRoas: 3,
            refundAdjustedRoi: 2,
        },
        items: [
            {
                source: 'direct',
                medium: '(none)',
                campaign: '(not set)',
                searchTerms: [],
                visitorCount: 2,
                productViewCount: 3,
                checkoutViewCount: 1,
                orderCount: 1,
                conversionRate: 0.5,
                netRevenueMicrounits: 300000,
                campaignCostMicrounits: 100000,
                refundAdjustedRoas: 3,
                refundAdjustedRoi: 2,
            },
        ],
    },
    myStorePaymentOptions: [],
    myStoreGovernanceChanges: [],
    myStorePaymentStats: [],
    myStorePaymentDetails: { items: [payment], totalItems: 1 },
    myStoreUsdtManualRefunds: empty,
    myStoreUsdtPaymentIntents: [],
    myStoreUsdtPaymentStats: { totalCount: 0, settledCount: 0, manualReviewCount: 0, receivedUsdtTotal: 0 },
    myStoreProfile: {
        __typename: 'StoreProfile',
        id: 'layout-profile',
        channelId: channel.id,
        updatedAt: now,
        status: 'ACTIVE',
        brandName: '模拟店铺',
        primaryDomain: null,
        domains: [],
        channel: { ...channel, seller: null },
        logoAsset: null,
    },
    myStoreCommerceConfiguration: {
        updatedAt: now,
        pricesIncludeTax: false,
        countryCode: 'MY',
        taxRate: 0,
        currencyCode: 'MYR',
        shippingMethodNameZh: '标准配送',
        shippingMethodNameEn: 'Standard',
        shippingDescriptionZh: '',
        shippingDescriptionEn: '',
        baseRate: 0,
        freeShippingThreshold: 0,
        shippingTaxRate: 0,
        shippingPriceIncludesTax: false,
        estimateMinDays: 1,
        estimateMaxDays: 3,
        blockedPostalPrefixes: '',
    },
    storeProfiles: [],
    storeProvisioningTemplates: [],
    storeDomains: params.has('empty')
        ? []
        : [
              {
                  id: 'layout-domain',
                  updatedAt: now,
                  domain: 'store-layout.example.invalid',
                  channel,
                  isPrimary: true,
                  status: 'PENDING',
                  verificationRecordName: '_vendure.store-layout.example.invalid',
                  verificationRecordValue: 'synthetic-layout-verification',
                  verifiedAt: null,
                  lastVerificationError: null,
              },
          ],
    storeDomainConfiguration: {
        cnameTarget: 'routing.example.invalid',
        routingMode: 'prefer-domain',
    },
    storeGovernanceChanges: mockWritesEnabled
        ? [
              {
                  id: 'synthetic-governance-request',
                  createdAt: now,
                  updatedAt: now,
                  status: 'PENDING',
                  requestType: 'LEGAL_IDENTITY',
                  version: 1,
                  channel,
                  maskedSummary: { legalEntityName: '本地模拟主体' },
                  reviewPayload: { legalEntityName: '本地模拟主体' },
                  reviewReason: null,
              },
          ]
        : [],
    administratorPermissionAudits: [],
    sellers: empty,
    paymentMethods: empty,
    shippingMethods: empty,
    paymentMethodEligibilityCheckers: [],
    paymentMethodHandlers: [],
    shippingEligibilityCheckers: [],
    shippingCalculators: [],
    fulfillmentHandlers: [],
    globalSettings: {
        availableLanguages: ['zh_Hans', 'en'],
        serverConfig: {
            entityCustomFields: layoutAudit || productEditorDesign ? auditCustomFieldEntities : [],
        },
        trackInventory: true,
        outOfStockThreshold: 0,
    },
    zones: empty,
    countries: empty,
    taxCategories: empty,
    taxRates: empty,
    catalogExportRows: empty,
    promotions: empty,
    promotionConditions: [],
    promotionActions: [],
    imageAiUsageRecords: empty,
    systemAnnouncements: [],
    mailboxIntegrationAccess: { valid: true, message: null },
    storefrontPromotionPage: {
        id: 'layout-landing',
        contentType: 'text/html',
        draftSource: '<h1>模拟落地页</h1>',
        publishedSource: '',
        isCustomized: false,
        defaultTemplateVersion: 1,
        publishedVersion: 0,
        publishedAt: null,
        publicUrl: '/promotions',
    },
    collectionFilters: [],
    referralProgram: {
        __typename: 'ReferralProgram',
        channelId: channel.id,
        enabled: false,
        rewardRate: 0,
        releaseDelayDays: 7,
        minimumOrderAmount: 0,
        maxRewardPerOrder: null,
        allowBalanceSpend: true,
        attributionWindowDays: 30,
        defaultPosterTemplate: 'default',
        posterTemplates: [],
        posterTemplateConfigs: [],
        systemPosterTemplateConfigs: [],
        siteIntroZh: '',
        siteIntroEn: '',
        siteTitleZh: '',
        siteTitleEn: '',
        updatedAt: now,
    },
    referralLedger: empty,
    referralRelationships: empty,
    referralInviterSummaries: empty,
    referralRewards: empty,
    referralWalletLedger: empty,
    referralBalanceAudit: { items: [], totalItems: 0, checkedCount: 0, mismatchCount: 0 },
    referralWithdrawals: empty,
    storefrontContentSettings: { updatedAt: now },
    imageGenerationAdminConfig: {
        id: 'layout-image-config',
        enabled: false,
        promptOptimizationEnabled: false,
        promptRateLimitPerMinute: 3,
        promptDailyFreeLimit: 20,
        promptDailyFreeUnlimited: false,
        paidPromptOptimizationEnabled: false,
        paidPromptOptimizationPrice: 0,
        paidPromptOptimizationCurrencyCode: 'MYR',
        defaultModelCode: '',
        termsVersion: '2026-10',
        termsZh: '模拟条款',
        termsEn: 'Demo terms',
        credentialEnabled: false,
        activeSkillHash: null,
        models: [],
    },
    imageGenerationJobs: empty,
    imagePromptSkillReleases: [],

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
        scope: platformFixture ? 'PLATFORM' : 'STORE',
        authority: platformFixture ? 'OWNER' : 'ADMIN',
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
        authorized: params.has('empty') ? 0 : params.has('large') ? 100 : params.has('many') ? 60 : 1,
        listed: params.has('empty') ? 0 : params.has('large') ? 100 : params.has('many') ? 60 : 1,
        paused: 0,
        pending: 0,
        outOfStock: 0,
        items: params.has('empty')
            ? []
            : Array.from({ length: params.has('large') ? 100 : params.has('many') ? 60 : 1 }, (_, i) => ({
                  productId: params.has('many') || params.has('large') ? `layout-many-${i}` : product.id,
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
    customers: params.has('empty') ? empty : { items: [fixtureCustomer], totalItems: 1 },
    customer: fixtureCustomer,
    customerGroups: empty,
    customerFollowUps: empty,
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
    processingOrders: { items: [fixtureOrder], totalItems: 1 },
    orderProcessingCounts: { pending: 1, digital: 0, physical: 3, exceptions: 0, afterSales: 0 },
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
    productTypeChangeAllowed: !params.has('locked') && (!productEditorDesign || params.has('unlocked')),
    digitalProductWorkspace: {
        productId: product.id,
        variants: variants.map(variant => ({
            id: variant.id,
            sku: variant.sku,
            deliveryMode: 'manual_service',
            stockPolicy: 'unlimited',
            availableQuantity: null,
            migrationRequired:
                params.has('migration') ||
                (productEditorDesign && digitalFixture && !params.has('currentInventory')),
            purchaseCostMicrounits: productEditorDesign ? 632000 : 25000,
            supplier: null,
            fileVersion: null,
        })),
    },
    digitalInventoryMigrationPreview: {
        productVariantId: variants[0].id,
        availableQuantity: 0,
        reservedQuantity: 0,
        conflicts: [],
        alreadyMigrated: false,
        confirmableStockLevels: [],
    },
    facets:
        layoutAudit || productEditorDesign ? { items: auditFacets, totalItems: auditFacets.length } : empty,
    assets: layoutAudit || productEditorDesign ? { items: [auditAsset], totalItems: 1 } : empty,
    productOptionGroups: empty,
    productVariants: empty,
    collections: { items: collections, totalItems: collections.length },
    selectedCollections: productEditorDesign ? { items: [collections[0]], totalItems: 1 } : empty,
    catalogSuppliers: {
        items: Array.from({ length: params.has('empty') ? 0 : params.has('multi') ? 3 : 1 }, (_, i) => ({
            id: `supplier-${i}`,
            name: `[QA] 模拟采购供货商 ${i + 1}`,
            code: `QA-SUPPLIER-${i + 1}`,
            enabled: view === 'suppliers' || view === 'purchases' || productEditorDesign,
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
        currencyCode: productEditorDesign ? 'CNY' : 'MYR',
        stockLocations: [{ id: 'stock-1', name: '示例仓库' }],
        variants: variants.map(v => ({
            ...v,
            barcode: '',
            specification: productEditorDesign ? '1个月' : '',
            saleUnit: '件',
            purchaseUnit: '件',
            packageQuantity: 1,
            shelfLifeDays: 365,
            sellingPrice: productEditorDesign ? 68000 : 5000,
            purchaseCostMicrounits: productEditorDesign ? 632000 : 25000,
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
    settingsStoreFieldDefinitions: params.has('settingsFixture')
        ? [
              { key: 'storefrontAuth.emailPasswordEnabled', scopeType: 'CHANNEL', currentValue: true },
              {
                  key: 'storefrontAuth.emailAutoRegistrationEnabled',
                  scopeType: 'CHANNEL',
                  currentValue: false,
              },
              {
                  key: 'storefrontAuth.emailQuickRegistrationEnabled',
                  scopeType: 'CHANNEL',
                  currentValue: null,
              },
              { key: 'storefrontAuth.googleOverrideEnabled', scopeType: 'CHANNEL', currentValue: null },
              { key: 'storefrontAuth.googleEnabled', scopeType: 'CHANNEL', currentValue: null },
              { key: 'storefrontAuth.googleClientId', scopeType: 'CHANNEL', currentValue: null },
              { key: 'storefrontAuth.platformGoogleEnabled', scopeType: 'GLOBAL', currentValue: true },
              {
                  key: 'storefrontAuth.platformGoogleClientId',
                  scopeType: 'GLOBAL',
                  currentValue: 'synthetic.apps.googleusercontent.com',
              },
              {
                  key: 'storefrontAccount.recommendations',
                  scopeType: 'CHANNEL',
                  currentValue: { enabled: true, titleZh: '为你推荐', titleEn: 'Recommended', limit: 8 },
              },
              {
                  key: 'storefrontAccount.personalDataExportEnabled',
                  scopeType: 'CHANNEL',
                  currentValue: false,
              },
              { key: 'storefrontReview.enabled', scopeType: 'CHANNEL', currentValue: null },
              {
                  key: 'vendure.dashboard.userSettings',
                  scopeType: 'USER',
                  currentValue: { displayLanguage: 'zh_Hans' },
              },
              { key: 'vendure.dashboard.globalSavedViews', scopeType: 'GLOBAL', currentValue: null },
              { key: 'vendure.dashboard.userSavedViews', scopeType: 'USER', currentValue: null },
              {
                  key: 'systemOperations.workerHeartbeat',
                  scopeType: 'GLOBAL',
                  currentValue: {
                      state: 'RUNNING',
                      heartbeatAt: new Date().toISOString(),
                      queues: [{ name: 'translate-content', running: true }],
                  },
              },
              { key: 'contentTranslationCache.result', scopeType: 'GLOBAL', currentValue: null },
          ].map(field => ({
              ...field,
              readonly: ['systemOperations.workerHeartbeat', 'contentTranslationCache.result'].includes(
                  field.key,
              ),
          }))
        : view === 'health' && params.get('worker') !== 'missing'
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
        (view === 'plugins' || view === 'split') && !params.has('empty')
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
Object.assign(window, { layoutQueries, mutationReceipts, blockedMutations });
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
                    !['query', 'mutation'].includes(definition.operation)
                ) {
                    observer.error(new Error('本地布局验收禁止写入'));
                    return;
                }
                if (definition.operation === 'mutation') {
                    const field = definition.selectionSet.selections.find(f => f.kind === Kind.FIELD);
                    if (!mockWritesEnabled || !field || field.kind !== Kind.FIELD) {
                        if (field?.kind === Kind.FIELD) blockedMutations.push({ field: field.name.value });
                        observer.error(
                            new Error(
                                '只读预览禁止保存，不会写入后台。处理方法：继续检查输入和键盘，无需重试保存；填写内容仍保留。',
                            ),
                        );
                        return;
                    }
                    const input = operation.variables.input ?? {};
                    let result: unknown;
                    if (field.name.value === 'updateStorefrontContentBlock') {
                        const blocks = data.storefrontContentBlocks as Array<Record<string, unknown>>;
                        const block = blocks.find(b => b.id === input.id);
                        if (!block || input.expectedUpdatedAt !== block.updatedAt) {
                            observer.error(new Error('模拟版本冲突'));
                            return;
                        }
                        Object.assign(block, input, { updatedAt: '2026-09-09T11:00:00Z' });
                        result = block;
                    } else if (field.name.value === 'reviewStoreGovernanceChange') {
                        const requests = data.storeGovernanceChanges as Array<Record<string, unknown>>;
                        const request = requests.find(r => r.id === input.id);
                        if (!request) {
                            observer.error(new Error('模拟申请不存在'));
                            return;
                        }
                        request.status = input.decision;
                        result = request;
                    } else if (field.name.value === 'reviewGovernanceApproval') {
                        data.governanceApprovals = [];
                        result = {
                            id: input.id,
                            status: input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED',
                        };
                    } else if (field.name.value === 'recordStoreUsdtManualRefund') {
                        result = {
                            ...input,
                            id: 'synthetic-refund',
                            orderCode: payment.orderCode,
                            channelId: channel.id,
                            channelCode: channel.code,
                            currencyCode: payment.currencyCode,
                            createdAt: now,
                            state: 'Settled',
                            network: 'TRC20',
                            refundId: 'synthetic-refund',
                            operatorUserId: 'synthetic-admin',
                        };
                        data.storeUsdtManualRefunds = { items: [result], totalItems: 1 };
                        payment.refundedAmount = input.amount;
                        payment.netAmount = payment.amount - input.amount;
                    } else if (field.name.value === 'migrateDigitalInventory' && legacyOwnershipFixture) {
                        const confirmed = operation.variables.ownershipConfirmation;
                        if (
                            JSON.stringify(confirmed?.stockLevels) !== JSON.stringify([legacyStockLevel]) ||
                            !confirmed?.reason?.trim() ||
                            operation.variables.expectedAvailable !== 100 ||
                            operation.variables.expectedReserved !== 0
                        ) {
                            observer.error(new Error('本地模拟要求精确历史记录和最新核对结果'));
                            return;
                        }
                        const workspace = data.digitalProductWorkspace as {
                            variants: Array<{
                                id: string;
                                migrationRequired: boolean;
                                availableQuantity: number | null;
                                stockPolicy: string;
                            }>;
                        };
                        workspace.variants.forEach(variant => {
                            if (variant.id === operation.variables.productVariantId) {
                                variant.migrationRequired = false;
                                variant.availableQuantity = 100;
                                variant.stockPolicy = 'limited';
                            }
                        });
                        result = { id: 'synthetic-digital-config', availableQuantity: 100 };
                    } else {
                        observer.error(new Error('未列入本地模拟写入白名单'));
                        return;
                    }
                    mutationReceipts.push({ field: field.name.value });
                    const fragments = Object.fromEntries(
                        operation.query.definitions
                            .filter(d => d.kind === Kind.FRAGMENT_DEFINITION)
                            .map(d => [d.name.value, d]),
                    );
                    observer.next({
                        data: project(
                            { [field.name.value]: result },
                            definition.selectionSet,
                            fragments,
                        ) as Record<string, unknown>,
                    });
                    observer.complete();
                    return;
                }
                const failingField =
                    (window as unknown as { failNextField?: string }).failNextField ??
                    params.get('failField');
                if (
                    failingField &&
                    definition.selectionSet.selections.some(
                        f => f.kind === Kind.FIELD && f.name.value === failingField,
                    )
                ) {
                    delete (window as unknown as { failNextField?: string }).failNextField;
                    observer.error(new Error('本地模拟读取失败'));
                    return;
                }
                layoutQueries.push({
                    name: operation.operationName,
                    variables: operation.variables,
                    selection: print(operation.query),
                    fields: definition.selectionSet.selections
                        .filter(f => f.kind === Kind.FIELD)
                        .map(f => f.name.value),
                } as never);
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
                if (
                    legacyOwnershipFixture &&
                    operation.operationName === 'DigitalInventoryMigrationPreview'
                ) {
                    const confirmation = operation.variables.ownershipConfirmation;
                    const matches =
                        JSON.stringify(confirmation?.stockLevels) === JSON.stringify([legacyStockLevel]) &&
                        Boolean(confirmation?.reason?.trim());
                    responseData = {
                        ...responseData,
                        digitalInventoryMigrationPreview: {
                            productVariantId: operation.variables.productVariantId,
                            availableQuantity: matches ? 100 : 0,
                            reservedQuantity: 0,
                            conflicts: matches ? [] : ['旧库存缺少店铺归属，请先核对'],
                            alreadyMigrated: false,
                            confirmableStockLevels: [legacyStockLevel],
                        },
                    };
                }
                if (params.has('large')) {
                    const skip = Number(operation.variables.options?.skip ?? 0);
                    const take = Math.max(
                        0,
                        Math.min(Number(operation.variables.options?.take ?? 20), 100 - skip),
                    );
                    responseData = {
                        ...responseData,
                        products: {
                            totalItems: 100,
                            items: Array.from({ length: take }, (_, index) => ({
                                ...product,
                                id: `layout-many-${skip + index}`,
                                name: `窗口化验收商品 ${skip + index + 1}`,
                            })),
                        },
                        assets: {
                            totalItems: 100,
                            items: Array.from({ length: take }, (_, index) => ({
                                __typename: 'Asset',
                                id: `layout-asset-${skip + index}`,
                                name: `窗口化验收素材 ${skip + index + 1}`,
                                type: 'IMAGE',
                                mimeType: 'image/svg+xml',
                                fileSize: 1024,
                                width: 320,
                                height: 320,
                                preview: '/assets/fixture-auth.svg',
                                source: '/assets/fixture-auth.svg',
                                tags: [],
                                translations: [
                                    {
                                        id: `asset-name-${skip + index}`,
                                        languageCode: 'zh_Hans',
                                        name: `窗口化验收素材 ${skip + index + 1}`,
                                    },
                                ],
                            })),
                        },
                    };
                }
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
                if (view === 'tabs' || view === 'split') {
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
                            ...(data.products as Record<string, unknown>),
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
                            variants:
                                layoutAudit || productEditorDesign
                                    ? (
                                          data.catalogProductWorkspace as { variants: Array<{ id: string }> }
                                      ).variants.map(variant => ({
                                          ...variant,
                                          id: `${productId}-${variant.id}`,
                                      }))
                                    : [],
                        },
                        ...(productEditorDesign
                            ? {
                                  digitalProductWorkspace: {
                                      ...(data.digitalProductWorkspace as object),
                                      productId,
                                      variants: (
                                          data.digitalProductWorkspace as { variants: Array<{ id: string }> }
                                      ).variants.map(variant => ({
                                          ...variant,
                                          id: `${productId}-${variant.id}`,
                                      })),
                                  },
                              }
                            : {}),
                        globalSettings: {
                            trackInventory: true,
                            outOfStockThreshold: 0,
                            availableLanguages: ['zh_Hans', 'en'],
                            serverConfig: {
                                entityCustomFields:
                                    layoutAudit || productEditorDesign ? auditCustomFieldEntities : [],
                            },
                        },
                        me: {
                            id: 'tabs-admin',
                            identifier: 'local@example.invalid',
                            channels: [{ ...channel, permissions: fixturePermissions }],
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
                                        code: fixturePermissions.includes('SuperAdmin')
                                            ? '__super_admin_role__'
                                            : 'synthetic-limited-role',
                                        description: '',
                                        channels: [channel],
                                    },
                                ],
                            },
                        },
                    };
                    operationTrace = { name: operation.operationName ?? '', variables: operation.variables };
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
                if (layoutAudit) {
                    const orderId = String(operation.variables.id ?? 'layout-order');
                    const route =
                        (window as Window & { fixtureLocation?: string }).fixtureLocation ??
                        params.get('path') ??
                        '';
                    const draftOrder = route.includes('/orders/draft/');
                    const modifyingOrder = route.includes('/modify');
                    const lines = variants.slice(0, 3).map((variant, index) => ({
                        __typename: 'OrderLine',
                        id: `layout-order-line-${index}`,
                        quantity: index + 1,
                        featuredAsset: auditAsset,
                        productVariant: { ...variant, product: { id: product.id, name: product.name } },
                        unitPriceWithTax: variant.price,
                        proratedUnitPriceWithTax: variant.price,
                        linePriceWithTax: variant.price * (index + 1),
                        discountedLinePriceWithTax: variant.price * (index + 1),
                        customFields: {
                            fulfillmentTypeSnapshot: 'physical',
                            digitalDeliveryModeSnapshot: null,
                        },
                    }));
                    const address = {
                        fullName: '本地模拟收件人',
                        company: '',
                        streetLine1: '本地布局验收示例地址 100 号',
                        streetLine2: '仅合成数据，不用于发货',
                        city: '示例城市',
                        province: '示例地区',
                        postalCode: '00000',
                        country: 'Malaysia',
                        countryCode: 'MY',
                        phoneNumber: '',
                    };
                    responseData = {
                        ...responseData,
                        catalogInventoryReconciliation: empty,
                        catalogInventoryOperations: empty,
                        manualDigitalDeliveries: empty,
                        digitalDeliveryExceptions: [],
                        adminTwoFactorStatus: {
                            available: true,
                            enabled: false,
                            enabledAt: null,
                            recoveryCodesRemaining: 0,
                        },
                        order: {
                            ...fixtureOrder,
                            __typename: 'Order',
                            id: orderId,
                            type: 'Regular',
                            state: draftOrder ? 'Draft' : modifyingOrder ? 'Modifying' : 'PaymentSettled',
                            active: draftOrder,
                            salesChannel: channel,
                            channels: [channel],
                            nextStates: draftOrder
                                ? ['Cancelled', 'ArrangingPayment']
                                : ['Cancelled', 'Modifying'],
                            lines,
                            totalQuantity: lines.reduce((total, line) => total + line.quantity, 0),
                            subTotalWithTax: lines.reduce((total, line) => total + line.linePriceWithTax, 0),
                            totalWithTax: lines.reduce((total, line) => total + line.linePriceWithTax, 0),
                            shippingWithTax: 0,
                            shippingAddress: address,
                            billingAddress: address,
                            couponCodes: [],
                            shippingLines: [],
                            discounts: [],
                            history: empty,
                            customFields: {},
                            autoCardDeliveries: [],
                        },
                    };
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
                if (adminRollout) {
                    responseData = adminRolloutFixtureData(
                        responseData,
                        operation.variables,
                        params.has('empty'),
                    );
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
if (view === 'tabs' || view === 'split') Object.assign(window, { tabOperations });
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
const storeFixtureWindow = window as unknown as Window & { storePreviewRequests: string[] };
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
    customers: <CustomersModule />,
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
if (view === 'performance') {
    createRoot(document.getElementById('root')!).render(
        <ThemeProvider>
            <ApolloProvider client={client}>
                <AdminOverlayHost owner="@global">
                    <ConfirmDialogProvider>
                        <FeatureHelpProvider>
                            <MemoryRouter initialEntries={['/performance/page/1']}>
                                <PerformanceFixture />
                            </MemoryRouter>
                        </FeatureHelpProvider>
                    </ConfirmDialogProvider>
                </AdminOverlayHost>
            </ApolloProvider>
        </ThemeProvider>,
    );
} else if (authFixture) {
    createRoot(document.getElementById('root')!).render(
        <ThemeProvider>
            <FixtureAuditTheme />
            <ApolloProvider client={client}>
                <MemoryRouter initialEntries={[view === 'login' ? '/login' : '/initial-password']}>
                    <div
                        data-layout-audit-auth
                        onSubmitCapture={event => {
                            event.preventDefault();
                            event.stopPropagation();
                        }}
                        onClickCapture={event => {
                            const button = (event.target as Element).closest('button');
                            if (button?.textContent?.includes('退出登录')) {
                                event.preventDefault();
                                event.stopPropagation();
                            }
                        }}
                    >
                        {view === 'login' ? (
                            <LoginModule />
                        ) : (
                            <InitialPasswordChangeModule onCompleted={async () => undefined} />
                        )}
                    </div>
                </MemoryRouter>
            </ApolloProvider>
        </ThemeProvider>,
    );
} else if (view === 'tabs' || view === 'split') {
    createRoot(document.getElementById('root')!).render(
        <ThemeProvider>
            {layoutAudit && <FixtureAuditTheme />}
            <ApolloProvider client={client}>
                <FixtureSettingsConfirmation
                    settingsFixture={params.has('settingsFixture')}
                    mockWritesEnabled={mockWritesEnabled}
                >
                    <FeatureHelpProvider>
                        <MemoryRouter initialEntries={[params.get('path') ?? '/catalog/list']}>
                            <FixtureLocation />
                            <nav
                                aria-label="本地测试导航"
                                hidden={params.has('presentation')}
                                className="fixed bottom-0 right-0 z-50 flex gap-3 bg-amber-100 p-2 text-xs"
                            >
                                {mockWritesEnabled
                                    ? '本地模拟操作 · 无网络写入'
                                    : '本地模拟数据 · 写入已阻止'}
                                <a href={`?${alternateScopeParams.toString()}`}>
                                    切换为{platformFixture ? '店铺' : '平台'}验收
                                </a>
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
                                    {getNextAdminExtensionLegacyRoutes().map(route => (
                                        <Route
                                            key={route.path}
                                            path={route.path.slice(1)}
                                            element={<LegacyFixture target={route.target} />}
                                        />
                                    ))}
                                    {getNextAdminExtensionRoutes().map(route => {
                                        const Component = route.component;
                                        return (
                                            <Route
                                                key={route.path}
                                                path={route.path.slice(1)}
                                                element={
                                                    <Suspense fallback={<p>加载中</p>}>
                                                        <FixtureBusinessRoute Component={Component} />
                                                    </Suspense>
                                                }
                                            />
                                        );
                                    })}
                                    {Array.from(new Set(STANDALONE_ADMIN_PAGES.map(p => p.sourcePath)))
                                        .filter(
                                            path => !getNextAdminExtensionRoutes().some(r => r.path === path),
                                        )
                                        .map(path => (
                                            <Route
                                                key={path}
                                                path={path.slice(1)}
                                                element={<LegacyFixture />}
                                            />
                                        ))}
                                    <Route path="*" element={<LegacyFixture />} />
                                    <Route path="dashboard" element={<DashboardModule />} />
                                    <Route path="profile" element={<ProfileModule />} />
                                    <Route path="catalog/assets" element={<AssetsModule />} />
                                    <Route path="sales/orders" element={<SalesModule />} />
                                    <Route path="sales/orders/draft/:id" element={<DraftOrderEditor />} />
                                    <Route path="sales/orders/:id/modify" element={<ModifyOrderEditor />} />
                                    <Route path="sales/orders/:id" element={<OrderEditor />} />
                                    <Route path="sales/profit" element={<ProfitReportModule />} />
                                    <Route path="customers/list" element={<CustomersModule />} />
                                    <Route
                                        path="platform/catalog"
                                        element={<StoreAllocationMatrixModule />}
                                    />
                                    <Route path="catalog/list" element={<CatalogModule />} />
                                    <Route path="catalog/products/:id" element={<ProductEditor />} />
                                </Route>
                            </Routes>
                        </MemoryRouter>
                    </FeatureHelpProvider>
                </FixtureSettingsConfirmation>
            </ApolloProvider>
        </ThemeProvider>,
    );
} else {
    createRoot(document.getElementById('root')!).render(
        <ApolloProvider client={client}>
            <AdminPermissionsProvider
                permissions={['SuperAdmin']}
                capabilities={
                    legacyOwnershipFixture
                        ? {
                              channelId: channel.id,
                              channelCode: channel.code,
                              scope: 'STORE',
                              commerceMode: 'DIGITAL_ONLY',
                              capabilities: [
                                  {
                                      id: '/catalog/products',
                                      state: 'READY',
                                      canRead: true,
                                      canWrite: true,
                                      canConfigure: false,
                                  },
                              ],
                          }
                        : null
                }
            >
                <ConfirmDialogContext.Provider value={async () => false}>
                    <CustomFieldsContext.Provider
                        value={{
                            availableLanguages: ['zh_Hans', 'en'],
                            entities:
                                layoutAudit || productEditorDesign
                                    ? auditCustomFieldEntities
                                    : [
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
                                                {legacyOwnershipFixture
                                                    ? '本地模拟操作 · 无网络写入'
                                                    : '模拟数据 · 写入已阻止'}
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

function FixtureLocation() {
    const loc = useLocation();
    const navigate = useNavigate();
    Object.assign(window, { fixtureLocation: loc.pathname + loc.search, fixtureNavigate: navigate });
    return null;
}
function LegacyFixture({ target: legacyTarget }: { target?: string } = {}) {
    const loc = useLocation();
    const target = getStandaloneAdminRedirect(loc.pathname, loc.search) ?? legacyTarget;
    return target ? <Navigate to={target} replace /> : null;
}

function FixtureBusinessRoute({ Component }: { Component: React.ComponentType }) {
    const loc = useLocation();
    const target = getStandaloneAdminRedirect(loc.pathname, loc.search);
    return target ? <Navigate to={target} replace /> : <Component />;
}
