import { ApolloLink, Observable } from '@apollo/client';
import { ApolloProvider } from '@apollo/client/react';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { client, getActiveChannelToken, setInitialActiveChannel } from '../../src/apollo';
import { ConfirmDialogContext } from '../../src/components/confirm-dialog-context';
import { FeatureHelpProvider } from '../../src/components/FeatureHelp';
import type { StoreManagementResult } from '../../src/graphql/management.graphql';
import '../../src/index.css';
import { AppShell } from '../../src/layouts/AppShell';
import { CatalogModule } from '../../src/pages/Catalog/CatalogModule';
import { StoreAllocationMatrixModule } from '../../src/pages/Catalog/StoreAllocationMatrixModule';
import { PaymentShippingManager } from '../../src/pages/Settings/PaymentShippingManager';
import { ThemeProvider } from '../../src/theme/ThemeProvider';

// Synthetic local UI fixture: no database, credentials, network API or real mutations.
const channels = [
    {
        id: '1',
        code: '__default_channel__',
        token: 'synthetic-platform',
        customFields: { storefrontNameZh: '', storefrontNameEn: '' },
    },
    {
        id: '2',
        code: 'source',
        token: 'synthetic-source',
        customFields: { storefrontNameZh: '来源店', storefrontNameEn: 'Source Store' },
    },
    {
        id: '3',
        code: 'seller',
        token: 'synthetic-seller',
        customFields: { storefrontNameZh: '销售店', storefrontNameEn: 'Seller Store' },
    },
].map(c => ({ ...c, defaultCurrencyCode: 'USD', defaultLanguageCode: 'zh_Hans' }));
const initial = new URLSearchParams(location.search).get('store') ?? 'synthetic-platform';
setInitialActiveChannel(initial);
const empty = { items: [], totalItems: 0 };
const product = {
    id: '10',
    name: '示例订阅',
    enabled: true,
    ownerChannelId: '2',
    channelIds: ['2'],
    variants: [{ id: '11', name: '一个月' }],
    createdAt: '2026-10-02T00:00:00Z',
    updatedAt: '2026-10-02T00:00:00Z',
    slug: 'synthetic-subscription',
    description: '本地合成数据',
    featuredAsset: null,
    facetValues: [],
    collections: [],
    customFields: {
        fulfillmentType: 'digital',
        pricingMode: 'FIXED',
        refundPolicy: null,
        manualDeliverySlaMinutes: null,
    },
};
const localPaymentEnabled: Record<string, boolean> = {};
let receipt: any;
const operations: string[] = [];
Object.assign(window, { governanceFixtureOperations: operations });
client.setLink(
    new ApolloLink(
        operation =>
            new Observable(observer => {
                operations.push(operation.operationName ?? '');
                const channel =
                    channels.find(
                        c =>
                            c.token ===
                            (operation.getContext().headers?.['vendure-token'] ?? getActiveChannelToken()),
                    ) ?? channels[0];
                const permissions = ['SuperAdmin'];
                let data: any;
                switch (operation.operationName) {
                    case 'NextAdminActiveChannelSwitchProbe':
                        data = { activeChannel: { id: channel.id, token: channel.token } };
                        break;
                    case 'NextAdminAppShellBootstrap':
                        data = {
                            activeChannel: channel,
                            manageableChannels: channels,
                            me: {
                                id: '1',
                                identifier: 'Synthetic QA',
                                channels: channels.map(c => ({ ...c, permissions })),
                            },
                            activeAdministrator: null,
                        };
                        break;
                    case 'NextAdminAppShellCommerceContext':
                    case 'NextAdminStoreCommerceMode':
                        data = { myStoreCommerceMode: { mode: 'DIGITAL_ONLY', conflicts: [] } };
                        break;
                    case 'NextAdminAppShellProfileContext':
                        data = { myStoreProfile: { id: channel.id, channelId: channel.id, logoAsset: null } };
                        break;
                    case 'StorePaymentSwitches':
                        data = {
                            myStorePaymentOptions: [
                                {
                                    id: 'synthetic-payment',
                                    name: '统一测试支付',
                                    description: '平台提供的受控测试支付',
                                    code: 'controlled-test-payment-platform',
                                    handlerCode: 'controlled-test-payment-handler',
                                    enabled: localPaymentEnabled[channel.token] ?? false,
                                    platformEnabled: true,
                                    effectiveEnabled: localPaymentEnabled[channel.token] ?? false,
                                },
                            ],
                        };
                        break;
                    case 'NextAdminSetMyStorePaymentOptionEnabled':
                        localPaymentEnabled[channel.token] = operation.variables.enabled;
                        data = {
                            setMyStorePaymentOptionEnabled: [
                                {
                                    id: 'synthetic-payment',
                                    name: '统一测试支付',
                                    code: 'controlled-test-payment-platform',
                                    enabled: operation.variables.enabled,
                                },
                            ],
                        };
                        break;
                    case 'NextAdminStoreUsdtSetup':
                        data = { myStoreCurrencyConfiguration: null, myStoreUsdtWallet: null };
                        break;
                    case 'NextAdminPlatformUsdtWallets':
                        data = { storeUsdtWallets: [] };
                        break;
                    case 'NextAdminCustomFieldServerConfig':
                        data = {
                            globalSettings: {
                                availableLanguages: ['zh_Hans', 'en'],
                                serverConfig: { entityCustomFields: [] },
                            },
                        };
                        break;
                    case 'PlatformCatalog':
                        data = {
                            platformCatalogProducts: {
                                totalItems: 1,
                                items: [product],
                                ownershipReviewCount: 0,
                                unassignedCount: 0,
                                categories: [
                                    { id: '20', name: '订阅分类', parentId: null, channelIds: ['2'] },
                                ],
                                channels: channels.slice(1).map(c => ({
                                    id: c.id,
                                    displayName: c.customFields.storefrontNameZh,
                                    currencyCode: 'USD',
                                    assignedCount: c.id === '2' ? 1 : 0,
                                    coverageDenominator: 1,
                                })),
                            },
                        };
                        break;
                    case 'PlatformResources':
                        data = { platformCatalogResources: [] };
                        break;
                    case 'DistributionPreview':
                        receipt = {
                            id: 'synthetic-batch',
                            state: 'PREVIEW',
                            items: [
                                {
                                    name: product.name,
                                    productId: product.id,
                                    channelId: '3',
                                    alreadyAssigned: false,
                                    missingPriceCount: 0,
                                    plannedPrices: [{ variantId: '11', price: 1200 }],
                                    targetCurrencyCode: 'USD',
                                },
                            ],
                            results: [],
                        };
                        data = { previewPlatformCatalogDistribution: receipt };
                        break;
                    case 'DistributionExecute':
                        data = {
                            executePlatformCatalogDistribution: {
                                ...receipt,
                                state: 'COMPLETE',
                                results: [{ index: 0, success: true, readback: { state: 'ACTIVE' } }],
                            },
                        };
                        break;
                    case 'StoreCatalogStatus':
                        data = {
                            myStoreCatalogStatus: {
                                authorized: 1,
                                listed: 1,
                                paused: 0,
                                pending: 0,
                                outOfStock: 0,
                                items: [
                                    {
                                        productId: product.id,
                                        listed: true,
                                        paused: false,
                                        pending: false,
                                        outOfStock: false,
                                    },
                                ],
                            },
                        };
                        break;
                    case 'GetCatalogChannels':
                        data = { activeChannel: channel, channels: { items: [channel], totalItems: 1 } };
                        break;
                    case 'GetCollections':
                        data = { collections: empty };
                        break;
                    case 'GetProducts':
                        data = {
                            products: {
                                totalItems: 1,
                                items: [
                                    {
                                        ...product,
                                        variants: [
                                            {
                                                id: '11',
                                                name: '一个月',
                                                sku: 'SYNTHETIC',
                                                price: 1200,
                                                currencyCode: 'USD',
                                                enabled: true,
                                                stockLevel: 'IN_STOCK',
                                                stockOnHand: 0,
                                                stockAllocated: 0,
                                                autoCardAvailableStock: 10,
                                                customFields: {
                                                    fulfillmentType: 'digital',
                                                    digitalDeliveryMode: 'auto_card',
                                                    digitalStockPolicy: 'FINITE',
                                                },
                                            },
                                        ],
                                    },
                                ],
                            },
                        };
                        break;
                    case 'GetCatalogChannelAssignments':
                        data = {
                            catalogProductChannelAssignments: {
                                totalItems: 1,
                                scopeChannel: channel,
                                channels: [channel],
                                summary: {
                                    totalItems: 1,
                                    unassignedItems: 0,
                                    multiChannelItems: 0,
                                    channelCounts: [{ channelId: channel.id, count: 1 }],
                                },
                                items: [
                                    {
                                        id: product.id,
                                        name: product.name,
                                        enabled: true,
                                        channels: [
                                            {
                                                ...channel,
                                                displayName: channel.customFields.storefrontNameZh,
                                                isDefault: false,
                                            },
                                        ],
                                    },
                                ],
                            },
                        };
                        data.catalogProductChannelAssignments.channels =
                            data.catalogProductChannelAssignments.items[0].channels;
                        data.catalogProductChannelAssignments.scopeChannel =
                            data.catalogProductChannelAssignments.channels[0];
                        break;
                    case 'NextAdminCatalogProductOperations':
                        data = { catalogProductOperations: [] };
                        break;
                    default:
                        observer.error(
                            new Error(`Unsupported synthetic UI operation: ${operation.operationName}`),
                        );
                        return;
                }
                observer.next({ data });
                observer.complete();
            }),
    ),
);
const paymentPage = new URLSearchParams(location.search).get('page') === 'payment';
const route = paymentPage
    ? '/settings/payment'
    : initial === 'synthetic-platform'
      ? '/platform/catalog'
      : '/catalog/list';
export function PaymentFixture() {
    const channel = channels.find(c => c.token === getActiveChannelToken()) ?? channels[0];
    const data = {
        activeChannel: channel,
        paymentMethods: {
            totalItems: 1,
            items: [
                {
                    id: 'synthetic-payment',
                    name: '统一测试支付',
                    description: '平台提供的受控测试支付',
                    code: 'controlled-test-payment-platform',
                    enabled: true,
                    handler: { code: 'controlled-test-payment-handler', args: [] },
                    checker: null,
                    translations: [
                        {
                            languageCode: 'zh_Hans',
                            name: '统一测试支付',
                            description: '平台提供的受控测试支付',
                        },
                        {
                            languageCode: 'en',
                            name: 'Platform test payment',
                            description: 'Controlled synthetic payment',
                        },
                    ],
                    customFields: {},
                },
            ],
        },
        shippingMethods: empty,
        paymentMethodHandlers: [
            { code: 'controlled-test-payment-handler', description: '受控测试支付', args: [] },
        ],
        paymentMethodEligibilityCheckers: [],
        shippingCalculators: [],
        shippingEligibilityCheckers: [],
        fulfillmentHandlers: [],
    } as unknown as StoreManagementResult;
    return (
        <ConfirmDialogContext.Provider value={async () => false}>
            <PaymentShippingManager
                key={channel.id}
                section="payment"
                data={data}
                paymentMethodCustomFields={[]}
                shippingMethodCustomFields={[]}
                onChanged={async () => {}}
                onError={message => {
                    throw new Error(message);
                }}
            />
        </ConfirmDialogContext.Provider>
    );
}
createRoot(document.getElementById('root')!).render(
    React.createElement(
        ApolloProvider,
        { client },
        <ThemeProvider>
            <FeatureHelpProvider>
                <MemoryRouter initialEntries={[route]}>
                    <Routes>
                        <Route element={<AppShell />}>
                            <Route path="settings/payment" element={<PaymentFixture />} />
                            <Route path="platform/catalog" element={<StoreAllocationMatrixModule />} />
                            <Route path="catalog/list" element={<CatalogModule />} />
                            <Route path="dashboard" element={<CatalogModule />} />
                        </Route>
                    </Routes>
                </MemoryRouter>
            </FeatureHelpProvider>
        </ThemeProvider>,
    ),
);
