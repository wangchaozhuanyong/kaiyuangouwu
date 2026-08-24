import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import { api, Button, DashboardBaseWidget, Link, Skeleton, useQuery } from '@vendure/dashboard';
import { KeyRound, MessageSquareText, PackageCheck, RefreshCw, RotateCcw } from 'lucide-react';

import { operationsTodoQuery } from './operations-todo-widget.graphql';

const messages = {
    title: msg({ id: 'operations.todo.title', message: 'Order tasks' }),
    description: msg({
        id: 'operations.todo.description',
        message: 'Orders, after-sales requests, and reviews that need attention right now',
    }),
    pendingShipment: msg({ id: 'operations.todo.pendingShipment', message: 'Awaiting shipment' }),
    pendingShipmentDescription: msg({
        id: 'operations.todo.pendingShipmentDescription',
        message: 'Paid orders ready for fulfillment',
    }),
    pendingAfterSales: msg({ id: 'operations.todo.pendingAfterSales', message: 'After-sales pending' }),
    pendingAfterSalesDescription: msg({
        id: 'operations.todo.pendingAfterSalesDescription',
        message: 'Refund and return requests awaiting a decision',
    }),
    pendingReviews: msg({ id: 'operations.todo.pendingReviews', message: 'Reviews pending' }),
    pendingReviewsDescription: msg({
        id: 'operations.todo.pendingReviewsDescription',
        message: 'Customer reviews awaiting publication',
    }),
    pendingAutoCard: msg({ id: 'operations.todo.pendingAutoCard', message: 'Automatic delivery alerts' }),
    pendingAutoCardDescription: msg({
        id: 'operations.todo.pendingAutoCardDescription',
        message: 'Low stock, waiting orders, or email failures',
    }),
    openOrders: msg({ id: 'operations.todo.openOrders', message: 'Open order center' }),
    loadError: msg({ id: 'operations.todo.loadError', message: 'Could not load order tasks' }),
    retry: msg({ id: 'operations.todo.retry', message: 'Retry' }),
};

interface OperationsTodoCounts {
    pendingShipment: number;
    pendingAfterSales: { totalItems: number };
    pendingReviews: { totalItems: number };
    autoCardTodoSummary: {
        lowStockSkuCount: number;
        waitingStockDeliveryCount: number;
        manualReviewCount: number;
    };
}

export function OperationsTodoWidget() {
    const { t } = useLingui();
    const { data, isError, isPending, refetch } = useQuery({
        queryKey: ['operations-todo-counts'],
        queryFn: () => api.query<OperationsTodoCounts>(operationsTodoQuery),
        refetchInterval: 60_000,
    });
    const pendingShipment = data?.pendingShipment;

    const items = [
        {
            id: 'pending-shipment',
            label: t(messages.pendingShipment),
            description: t(messages.pendingShipmentDescription),
            count: typeof pendingShipment === 'number' ? pendingShipment : 0,
            icon: PackageCheck,
            to: '/orders' as const,
            search: { status: 'AWAITING_SHIPMENT' },
        },
        {
            id: 'pending-after-sales',
            label: t(messages.pendingAfterSales),
            description: t(messages.pendingAfterSalesDescription),
            count: data?.pendingAfterSales.totalItems ?? 0,
            icon: RotateCcw,
            to: '/after-sales' as const,
            search: {},
        },
        {
            id: 'pending-auto-card',
            label: t(messages.pendingAutoCard),
            description: t(messages.pendingAutoCardDescription),
            count:
                (data?.autoCardTodoSummary.lowStockSkuCount ?? 0) +
                (data?.autoCardTodoSummary.waitingStockDeliveryCount ?? 0) +
                (data?.autoCardTodoSummary.manualReviewCount ?? 0),
            icon: KeyRound,
            to: '/auto-card' as const,
            search: {},
        },
        {
            id: 'pending-reviews',
            label: t(messages.pendingReviews),
            description: t(messages.pendingReviewsDescription),
            count: data?.pendingReviews.totalItems ?? 0,
            icon: MessageSquareText,
            to: '/review-moderation' as const,
            search: {},
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
                <div className="grid h-full grid-cols-1 gap-4 py-2 sm:grid-cols-4">
                    {[0, 1, 2, 3].map(item => (
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
                <div className="grid h-full grid-cols-1 divide-y sm:grid-cols-4 sm:divide-x sm:divide-y-0">
                    {items.map(item => {
                        const Icon = item.icon;
                        return (
                            <Link
                                key={item.id}
                                to={item.to}
                                search={item.search}
                                className={[
                                    'flex min-h-20 items-center gap-3 rounded-md py-3 transition-colors',
                                    'hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2',
                                    'focus-visible:ring-ring sm:px-5 first:sm:pl-2 last:sm:pr-2',
                                ].join(' ')}
                            >
                                <Icon className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                                <div className="min-w-0 flex-1">
                                    <p className="text-sm font-medium">{item.label}</p>
                                    <p className="mt-1 text-xs text-muted-foreground">{item.description}</p>
                                </div>
                                <span className="shrink-0 text-2xl font-semibold tabular-nums">
                                    {item.count}
                                </span>
                            </Link>
                        );
                    })}
                </div>
            )}
        </DashboardBaseWidget>
    );
}
