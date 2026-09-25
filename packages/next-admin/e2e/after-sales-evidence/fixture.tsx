import { ApolloClient, ApolloLink, InMemoryCache, Observable } from '@apollo/client';
import { ApolloProvider } from '@apollo/client/react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { FeatureHelpProvider } from '../../src/components/FeatureHelp';
import '../../src/index.css';
import { AfterSalesModule } from '../../src/pages/Sales/AfterSalesModule';

// Synthetic browser fixture. No network API and no financial mutations.
let revision = 0;
const now = '2026-09-24T12:00:00Z';
const nullable = Object.fromEntries(
    [
        'approvedAmount',
        'resolution',
        'returnInstructions',
        'returnCarrier',
        'returnTrackingCode',
        'returnShippedAt',
        'returnReceivedAt',
        'inspectedAt',
        'inspectionNote',
        'replacementCarrier',
        'replacementTrackingCode',
        'replacementProofReference',
        'replacementException',
        'replacementShippedAt',
        'replacementDeliveredAt',
        'nextActionDueAt',
        'respondedAt',
        'completedAt',
        'cancelledAt',
        'refundedAt',
        'refund',
    ].map(key => [key, null]),
);
const client = new ApolloClient({
    cache: new InMemoryCache(),
    link: new ApolloLink(
        operation =>
            new Observable(observer => {
                if (operation.operationName === 'GetAdminAfterSalesRequests') {
                    revision++;
                    observer.next({
                        data: {
                            afterSalesRequests: {
                                totalItems: 1,
                                items: [
                                    {
                                        ...nullable,
                                        __typename: 'AfterSalesRequest',
                                        id: 'local-request',
                                        code: 'LOCAL-EVIDENCE-TEST',
                                        createdAt: now,
                                        updatedAt: now,
                                        state: 'PENDING',
                                        type: 'REFUND_ONLY',
                                        reason: 'NOT_AS_DESCRIBED',
                                        description: '仅用于本地界面验收的合成工单。',
                                        currencyCode: 'MYR',
                                        requestedAmount: 2990,
                                        returnStatus: 'NOT_REQUIRED',
                                        replacementStatus: 'NOT_REQUIRED',
                                        overdue: false,
                                        customerName: '本地验收用户',
                                        customerEmail: 'fixture@example.invalid',
                                        order: {
                                            __typename: 'Order',
                                            id: 'local-order',
                                            code: 'LOCAL-ORDER',
                                            state: 'PaymentSettled',
                                            totalWithTax: 2990,
                                            currencyCode: 'MYR',
                                            payments: [],
                                        },
                                        items: [
                                            {
                                                __typename: 'AfterSalesRequestItem',
                                                id: 'local-item',
                                                orderLineId: 'local-line',
                                                quantity: 1,
                                                unitPriceWithTax: 2990,
                                                lineAmountWithTax: 2990,
                                                productName: '本地测试商品',
                                                sku: 'LOCAL-SKU',
                                                fulfillmentType: 'physical',
                                                acceptedReturnQuantity: 0,
                                                rejectedReturnQuantity: 0,
                                                returnLotCode: null,
                                                inventoryOperationId: null,
                                                returnStockLocation: null,
                                            },
                                        ],
                                        events: [],
                                        evidence: [0, 1, 2].map(index => ({
                                            __typename: 'AfterSalesEvidence',
                                            id: `image-${index}`,
                                            createdAt: now,
                                            mimeType: 'image/png',
                                            byteSize: 12,
                                            available: index !== 2,
                                            previewUrl:
                                                index === 2
                                                    ? null
                                                    : `/after-sales/evidence/local-fixture-${index}-${revision}`,
                                            expiresAt: null,
                                        })),
                                    },
                                ],
                            },
                        },
                    });
                } else if (operation.operationName === 'GetStockLocations') {
                    observer.next({ data: { stockLocations: { items: [], totalItems: 0 } } });
                } else observer.error(new Error('This local fixture rejects every mutation'));
                observer.complete();
            }),
    ),
});
createRoot(document.getElementById('root')!).render(
    <ApolloProvider client={client}>
        <FeatureHelpProvider>
            <MemoryRouter initialEntries={['/sales/after-sales']}>
                <div className="bg-amber-50 px-4 py-2 text-xs">
                    本地合成工单 · 不连接真实店铺 · 所有交易操作关闭
                </div>
                <AfterSalesModule />
            </MemoryRouter>
        </FeatureHelpProvider>
    </ApolloProvider>,
);
