import { DetailPageButton } from '@/vdb/components/shared/detail-page-button.js';
import {
    CustomerCell,
    OrderMoneyCell,
    OrderStateCell,
} from '@/vdb/components/shared/table-cell/order-table-cell-components.js';
import { Button } from '@/vdb/components/ui/button.js';
import { Tabs, TabsList, TabsTrigger } from '@/vdb/components/ui/tabs.js';
import { ActionBarItem } from '@/vdb/framework/layout-engine/action-bar-item-wrapper.js';
import { PageActionBarLeft } from '@/vdb/framework/layout-engine/page-layout.js';
import { ListPage } from '@/vdb/framework/page/list-page.js';
import { api } from '@/vdb/graphql/api.js';
import { ResultOf } from '@/vdb/graphql/graphql.js';
import { useDynamicTranslations } from '@/vdb/hooks/use-dynamic-translations.js';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import { useMutation } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { PlusIcon } from 'lucide-react';
import { FulfillOrdersBulkAction } from './components/order-bulk-actions.js';
import { FulfillmentQueueButton } from './components/order-fulfillment-queue.js';
import { createDraftOrderDocument, orderListDocument } from './orders.graphql.js';
import { isOrderReadyForFulfillment } from './utils/order-fulfillment-utils.js';

const orderCenterMessages = {
    all: msg({ id: 'orderCenter.status.all', message: 'All orders' }),
    awaitingPayment: msg({ id: 'orderCenter.status.awaitingPayment', message: 'Awaiting payment' }),
    awaitingShipment: msg({ id: 'orderCenter.status.awaitingShipment', message: 'Awaiting shipment' }),
    fulfillNow: msg({ id: 'orderCenter.actions.fulfillNow', message: 'Fulfill now' }),
    viewLogistics: msg({ id: 'orderCenter.actions.viewLogistics', message: 'View logistics' }),
    viewOrder: msg({ id: 'orderCenter.actions.viewOrder', message: 'View order' }),
};

const orderListStatuses = [
    'ALL',
    'AWAITING_PAYMENT',
    'AWAITING_SHIPMENT',
    'SHIPPED',
    'COMPLETED',
    'CLOSED',
] as const;

type OrderListStatus = (typeof orderListStatuses)[number];

const orderStatesByStatus: Record<OrderListStatus, string[]> = {
    ALL: [],
    AWAITING_PAYMENT: ['ArrangingPayment', 'ArrangingAdditionalPayment'],
    AWAITING_SHIPMENT: ['PaymentAuthorized', 'PaymentSettled'],
    SHIPPED: ['PartiallyShipped', 'Shipped', 'PartiallyDelivered'],
    COMPLETED: ['Delivered'],
    CLOSED: ['Cancelled'],
};

function isOrderListStatus(value: unknown): value is OrderListStatus {
    return typeof value === 'string' && orderListStatuses.includes(value as OrderListStatus);
}

export const Route = createFileRoute('/_authenticated/_orders/orders')({
    validateSearch: (search: Record<string, unknown>) => ({
        ...search,
        status: isOrderListStatus(search.status) ? search.status : 'ALL',
    }),
    component: OrderListPage,
    loader: () => ({ breadcrumb: () => <Trans>Orders</Trans> }),
});

function OrderListPage() {
    const navigate = useNavigate();
    const { t } = useLingui();
    const { getTranslatedOrderState } = useDynamicTranslations();
    const routeSearch = Route.useSearch();
    const status: OrderListStatus = isOrderListStatus(routeSearch.status) ? routeSearch.status : 'ALL';
    const statusLabels: Record<OrderListStatus, string> = {
        ALL: t(orderCenterMessages.all),
        AWAITING_PAYMENT: t(orderCenterMessages.awaitingPayment),
        AWAITING_SHIPMENT: t(orderCenterMessages.awaitingShipment),
        SHIPPED: getTranslatedOrderState('Shipped'),
        COMPLETED: getTranslatedOrderState('Delivered'),
        CLOSED: getTranslatedOrderState('Cancelled'),
    };
    const { mutate: createDraftOrder } = useMutation({
        mutationFn: api.mutate(createDraftOrderDocument),
        onSuccess: (result: ResultOf<typeof createDraftOrderDocument>) => {
            navigate({ to: '/orders/draft/$id', params: { id: result.createDraftOrder.id } });
        },
    });
    return (
        <ListPage
            pageId="order-list"
            title={<Trans>Orders</Trans>}
            searchPlaceholder={t`Search order number, customer surname or transaction ID`}
            onSearchTermChange={searchTerm => {
                return {
                    _or: [
                        {
                            code: {
                                contains: searchTerm,
                            },
                        },
                        {
                            customerLastName: {
                                contains: searchTerm,
                            },
                        },
                        {
                            transactionId: {
                                contains: searchTerm,
                            },
                        },
                    ],
                };
            }}
            defaultSort={[{ id: 'updatedAt', desc: true }]}
            listQuery={orderListDocument}
            route={Route}
            transformVariables={variables => {
                const states = orderStatesByStatus[status];
                const filter = variables.options?.filter ?? {};
                return {
                    ...variables,
                    options: {
                        ...variables.options,
                        filter: states.length ? { ...filter, state: { in: states } } : filter,
                    },
                };
            }}
            transformQueryKey={queryKey => [...queryKey, status]}
            customizeColumns={{
                total: {
                    meta: { dependencies: ['currencyCode'] },
                    cell: OrderMoneyCell,
                },
                totalWithTax: {
                    meta: { dependencies: ['currencyCode'] },
                    cell: OrderMoneyCell,
                },
                state: {
                    header: () => <Trans>Order status</Trans>,
                    cell: OrderStateCell,
                },
                code: {
                    header: () => <Trans>Order number</Trans>,
                    cell: ({ cell, row }) => {
                        const value = cell.getValue() as string;
                        const id = row.original.id;
                        return <DetailPageButton id={id} label={value} />;
                    },
                },
                customer: {
                    cell: CustomerCell,
                },
                shippingLines: {
                    header: () => <Trans>Delivery method</Trans>,
                    cell: ({ row }) => {
                        const value = row.original.shippingLines;
                        return <div>{value?.map(line => line.shippingMethod.name).join(', ')}</div>;
                    },
                },
            }}
            defaultColumnOrder={[
                'code',
                'orderPlacedAt',
                'customer',
                'totalWithTax',
                'state',
                'shippingLines',
                'operation',
            ]}
            defaultVisibility={{
                code: true,
                orderPlacedAt: true,
                customer: true,
                totalWithTax: true,
                state: true,
                shippingLines: true,
                operation: true,
            }}
            additionalColumns={{
                operation: {
                    meta: { dependencies: ['id', 'code', 'state'] },
                    header: () => <Trans>Actions</Trans>,
                    cell: ({ row }) => {
                        const order = row.original;
                        const canFulfill = isOrderReadyForFulfillment(order);
                        const hasShipped = ['PartiallyShipped', 'Shipped', 'PartiallyDelivered'].includes(
                            order.state,
                        );
                        if (canFulfill) {
                            return (
                                <FulfillmentQueueButton order={order}>
                                    {t(orderCenterMessages.fulfillNow)}
                                </FulfillmentQueueButton>
                            );
                        }
                        return (
                            <Button
                                size="sm"
                                variant="outline"
                                render={<Link to="/orders/$id" params={{ id: order.id }} />}
                            >
                                {hasShipped
                                    ? t(orderCenterMessages.viewLogistics)
                                    : t(orderCenterMessages.viewOrder)}
                            </Button>
                        );
                    },
                    enableSorting: false,
                },
            }}
            bulkActions={[{ component: FulfillOrdersBulkAction }]}
        >
            <PageActionBarLeft>
                <Tabs
                    value={status}
                    onValueChange={value => {
                        if (!isOrderListStatus(value)) return;
                        void navigate({
                            to: '/orders',
                            search: (previous: Record<string, unknown>) => ({
                                ...previous,
                                status: value,
                                page: 1,
                            }),
                        });
                    }}
                >
                    <TabsList className="h-auto flex-wrap justify-start">
                        {orderListStatuses.map(item => (
                            <TabsTrigger key={item} value={item}>
                                {statusLabels[item]}
                            </TabsTrigger>
                        ))}
                    </TabsList>
                </Tabs>
            </PageActionBarLeft>
            <ActionBarItem itemId="create-draft-button">
                <Button onClick={() => createDraftOrder({})}>
                    <PlusIcon className="mr-2 h-4 w-4" />
                    <Trans>Create manual order</Trans>
                </Button>
            </ActionBarItem>
        </ListPage>
    );
}
