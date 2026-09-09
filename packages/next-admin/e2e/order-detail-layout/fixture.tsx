import { ApolloClient, ApolloLink, InMemoryCache, Observable } from '@apollo/client';
import { ApolloProvider } from '@apollo/client/react';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AdminPermissionsProvider } from '../../src/components/admin-permissions-context';
import { FeatureHelpProvider } from '../../src/components/FeatureHelp';
import type { CustomFieldDefinition } from '../../src/custom-fields/custom-field-types';
import { CustomFieldsContext } from '../../src/custom-fields/custom-fields-context';
import { defineNextAdminExtension } from '../../src/extensions/extension-api';
import '../../src/index.css';
import { OrderEditor } from '../../src/pages/Sales/OrderEditor';
import { OrderOperationsBlock } from '../../src/pages/Sales/OrderOperationsBlock';

// Local visual fixture: synthetic data, no HTTP link, and every mutation is rejected.
const params = new URLSearchParams(location.search);
if (!params.has('light')) document.documentElement.classList.add('dark');
const readonly = params.has('readonly');
const now = '2026-09-09T11:48:00.000Z';
const address = {
    fullName: '布局验收用户',
    company: null,
    streetLine1: '示例街道 12 号',
    streetLine2: '示例单元 A-12',
    city: '示例城市',
    province: '示例地区',
    postalCode: '00000',
    country: '马来西亚',
    countryCode: 'MY',
    phoneNumber: null,
};
const payment = {
    __typename: 'Payment',
    id: 'fixture-payment',
    createdAt: now,
    state: 'Settled',
    nextStates: ['Cancelled'],
    method: 'controlled-test-payment-2',
    transactionId: 'test-layout-transaction-00000000-0000-0000-0000',
    amount: 50000,
    errorMessage: null,
    refunds: [],
};
const order = {
    __typename: 'Order',
    id: 'fixture-order',
    code: 'LAYOUT-DEMO-25',
    createdAt: now,
    updatedAt: now,
    orderPlacedAt: now,
    state: 'PaymentSettled',
    nextStates: ['Modifying', 'Cancelled'],
    active: false,
    type: 'Regular',
    totalQuantity: 1,
    subTotalWithTax: 50000,
    shippingWithTax: 0,
    totalWithTax: 50000,
    currencyCode: 'MYR',
    couponCodes: [],
    discounts: [],
    payments: params.has('empty') ? [] : [payment],
    customer: {
        id: 'fixture-customer',
        firstName: '用户',
        lastName: '验收',
        emailAddress: 'layout@example.invalid',
        phoneNumber: null,
    },
    shippingAddress: address,
    billingAddress: address,
    channels: [{ id: 'fixture-channel', code: '布局验收店铺', token: 'fixture-channel' }],
    shippingLines: [
        {
            id: 'fixture-shipping',
            discountedPriceWithTax: 0,
            shippingMethod: {
                id: 'fixture-method',
                code: 'manual',
                name: '标准配送',
                fulfillmentHandlerCode: 'manual-fulfillment',
            },
        },
    ],
    lines: [
        {
            __typename: 'OrderLine',
            id: 'fixture-line',
            quantity: 1,
            unitPriceWithTax: 50000,
            proratedUnitPriceWithTax: 50000,
            linePriceWithTax: 50000,
            discountedLinePriceWithTax: 50000,
            featuredAsset: null,
            fulfillmentLines: [],
            productVariant: {
                id: 'fixture-variant',
                name: '示例商品（仅用于布局验收）',
                sku: 'DEMO-SKU-001',
                options: [],
                customFields: { fulfillmentType: 'physical', digitalDeliveryMode: null },
            },
            customFields: { fulfillmentTypeSnapshot: 'physical', digitalDeliveryModeSnapshot: null },
        },
    ],
    fulfillments: [],
    sellerOrders: [],
    storeCouponAllocations: [],
    customFields: { customerOrderNote: '', digitalDeliveryEmail: '' },
    history: {
        totalItems: 2,
        items: [
            {
                id: 'history-1',
                type: 'ORDER_STATE_TRANSITION',
                createdAt: now,
                isPublic: false,
                administrator: null,
                data: { from: 'ArrangingPayment', to: 'PaymentSettled' },
            },
            {
                id: 'history-2',
                type: 'ORDER_STATE_TRANSITION',
                createdAt: now,
                isPublic: false,
                administrator: null,
                data: { from: 'AddingItems', to: 'ArrangingPayment' },
            },
        ],
    },
};
const fields: CustomFieldDefinition[] = [
    {
        name: 'customerOrderNote',
        type: 'text',
        list: false,
        nullable: true,
        label: [{ languageCode: 'zh_Hans', value: '客户订单备注' }],
        description: [{ languageCode: 'zh_Hans', value: '客户下单时填写的备注' }],
    },
    {
        name: 'digitalDeliveryEmail',
        type: 'string',
        list: false,
        nullable: true,
        label: [{ languageCode: 'zh_Hans', value: '数字商品交付邮箱' }],
        description: [{ languageCode: 'zh_Hans', value: '用于接收数字商品交付信息' }],
    },
];
const client = new ApolloClient({
    cache: new InMemoryCache(),
    link: new ApolloLink(
        operation =>
            new Observable(observer => {
                if (operation.operationName === 'GetSalesOrder') {
                    observer.next({
                        data: { order, fulfillmentHandlers: [{ code: 'manual-fulfillment', args: [] }] },
                    });
                } else if (operation.operationName === 'NextAdminOrderOperations') {
                    if (params.has('payment-error')) {
                        observer.error(new Error('模拟支付明细读取失败'));
                        return;
                    }
                    observer.next({ data: { order } });
                } else if (operation.operationName === 'NextAdminPaymentMethodsForManualPayment') {
                    observer.next({
                        data: {
                            paymentMethods: {
                                items: [
                                    {
                                        id: 'fixture-method',
                                        name: '测试支付',
                                        code: payment.method,
                                        description: '',
                                        enabled: true,
                                    },
                                ],
                                totalItems: 1,
                            },
                        },
                    });
                } else if (operation.operationName === 'NextAdminCatalogOrderProfitExpense') {
                    observer.next({ data: { catalogOrderProfitExpense: null } });
                } else {
                    observer.error(new Error('布局验收页面不执行写入：' + operation.operationName));
                    return;
                }
                observer.complete();
            }),
    ),
});
if (!params.has('fallback'))
    defineNextAdminExtension({
        id: 'order-layout-fixture',
        pageBlocks: [
            {
                id: 'fixture-payment-operations',
                pageId: 'order-detail',
                component: OrderOperationsBlock,
                permissions: ['ReadOrder'],
            },
        ],
    });
createRoot(document.getElementById('root')!).render(
    <React.Fragment>
        <ApolloProvider client={client}>
            <AdminPermissionsProvider
                permissions={
                    readonly
                        ? ['ReadOrder', 'ReadCatalogOperations']
                        : [
                              'ReadOrder',
                              'UpdateOrder',
                              'ReadPaymentMethod',
                              'ReadCatalogOperations',
                              'UpdateCatalogOperations',
                          ]
                }
            >
                <CustomFieldsContext.Provider
                    value={{
                        availableLanguages: ['zh_Hans'],
                        entities: [{ entityName: 'Order', customFields: fields }],
                    }}
                >
                    <FeatureHelpProvider>
                        <div className="flex h-screen min-w-0 flex-col">
                            <div className="shrink-0 bg-amber-100 px-4 py-1 text-xs text-amber-900">
                                本地模拟订单 · 仅验收布局，所有写入均被阻止
                            </div>
                            <MemoryRouter initialEntries={['/sales/orders/fixture-order']}>
                                <Routes>
                                    <Route path="/sales/orders/:id" element={<OrderEditor />} />
                                </Routes>
                            </MemoryRouter>
                        </div>
                    </FeatureHelpProvider>
                </CustomFieldsContext.Provider>
            </AdminPermissionsProvider>
        </ApolloProvider>
    </React.Fragment>,
);
