import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import { api, Button, DashboardBaseWidget, Link, Skeleton, useQuery } from '@vendure/dashboard';
import { CircleDollarSign, PackageCheck, RefreshCw, RotateCcw } from 'lucide-react';

import { operationsTodoQuery } from './operations-todo-widget.graphql';

const messages = {
    title: msg({ id: 'operations.todo.title', message: 'Order tasks' }),
    description: msg({
        id: 'operations.todo.description',
        message: 'Orders that need attention right now',
    }),
    pendingPayment: msg({ id: 'operations.todo.pendingPayment', message: 'Awaiting payment' }),
    pendingPaymentDescription: msg({
        id: 'operations.todo.pendingPaymentDescription',
        message: 'Customers have not completed payment',
    }),
    pendingShipment: msg({ id: 'operations.todo.pendingShipment', message: 'Awaiting shipment' }),
    pendingShipmentDescription: msg({
        id: 'operations.todo.pendingShipmentDescription',
        message: 'Paid orders ready for fulfillment',
    }),
    modifying: msg({ id: 'operations.todo.modifying', message: 'Order changes in progress' }),
    modifyingDescription: msg({
        id: 'operations.todo.modifyingDescription',
        message: 'Orders currently being adjusted',
    }),
    openOrders: msg({ id: 'operations.todo.openOrders', message: 'Open order center' }),
    loadError: msg({ id: 'operations.todo.loadError', message: 'Could not load order tasks' }),
    retry: msg({ id: 'operations.todo.retry', message: 'Retry' }),
};

export function OperationsTodoWidget() {
    const { t } = useLingui();
    const { data, isError, isPending, refetch } = useQuery({
        queryKey: ['operations-todo-counts'],
        queryFn: () => api.query(operationsTodoQuery),
        refetchInterval: 60_000,
    });

    const items = [
        {
            id: 'pending-payment',
            label: t(messages.pendingPayment),
            description: t(messages.pendingPaymentDescription),
            count: data?.pendingPayment.totalItems ?? 0,
            icon: CircleDollarSign,
        },
        {
            id: 'pending-shipment',
            label: t(messages.pendingShipment),
            description: t(messages.pendingShipmentDescription),
            count: data?.pendingShipment.totalItems ?? 0,
            icon: PackageCheck,
        },
        {
            id: 'modifying',
            label: t(messages.modifying),
            description: t(messages.modifyingDescription),
            count: data?.modifying.totalItems ?? 0,
            icon: RotateCcw,
        },
    ];

    return (
        <DashboardBaseWidget
            id="operations-todo-widget"
            title={t(messages.title)}
            description={t(messages.description)}
            actions={
                <Button variant="outline" size="sm" render={<Link to="/orders" />}>
                    {t(messages.openOrders)}
                </Button>
            }
        >
            {isPending ? (
                <div className="grid h-full grid-cols-1 gap-4 py-2 sm:grid-cols-3">
                    {[0, 1, 2].map(item => (
                        <div key={item} className="flex min-h-20 items-center gap-3">
                            <Skeleton className="size-9 rounded-md" />
                            <div className="flex-1 space-y-2">
                                <Skeleton className="h-4 w-20" />
                                <Skeleton className="h-3 w-full" />
                            </div>
                            <Skeleton className="h-8 w-10" />
                        </div>
                    ))}
                </div>
            ) : isError ? (
                <div className="flex h-full min-h-20 items-center justify-between gap-4">
                    <p className="text-sm text-muted-foreground">{t(messages.loadError)}</p>
                    <Button variant="outline" size="sm" onClick={() => void refetch()}>
                        <RefreshCw className="size-4" />
                        {t(messages.retry)}
                    </Button>
                </div>
            ) : (
                <div className="grid h-full grid-cols-1 divide-y sm:grid-cols-3 sm:divide-x sm:divide-y-0">
                    {items.map(item => {
                        const Icon = item.icon;
                        return (
                            <div
                                key={item.id}
                                className="flex min-h-20 items-center gap-3 py-3 sm:px-5 first:sm:pl-0 last:sm:pr-0"
                            >
                                <Icon className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                                <div className="min-w-0 flex-1">
                                    <p className="text-sm font-medium">{item.label}</p>
                                    <p className="mt-1 text-xs text-muted-foreground">{item.description}</p>
                                </div>
                                <span className="shrink-0 text-2xl font-semibold tabular-nums">
                                    {item.count}
                                </span>
                            </div>
                        );
                    })}
                </div>
            )}
        </DashboardBaseWidget>
    );
}
