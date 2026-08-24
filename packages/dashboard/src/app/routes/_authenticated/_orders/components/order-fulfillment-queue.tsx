import { Button } from '@/vdb/components/ui/button.js';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/vdb/components/ui/dialog.js';
import { Skeleton } from '@/vdb/components/ui/skeleton.js';
import { api } from '@/vdb/graphql/api.js';
import { usePaginatedList } from '@/vdb/hooks/use-paginated-list.js';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { ReactNode, useEffect, useMemo, useState } from 'react';

import { orderDetailDocument } from '../orders.graphql.js';
import { FulfillmentQueueOrder } from '../utils/order-fulfillment-utils.js';
import { FulfillOrderDialog } from './fulfill-order-dialog.js';

const messages = {
    loading: msg({
        id: 'orderCenter.fulfillment.loading',
        message: 'Loading order details',
    }),
    loadError: msg({
        id: 'orderCenter.fulfillment.loadError',
        message: 'Could not load this order',
    }),
    retry: msg({ id: 'orderCenter.fulfillment.retry', message: 'Retry' }),
    skip: msg({ id: 'orderCenter.fulfillment.skip', message: 'Skip this order' }),
    progress: msg({
        id: 'orderCenter.fulfillment.progress',
        message: 'Fulfillment progress',
    }),
};

interface FulfillmentQueueDialogProps {
    open: boolean;
    orders: FulfillmentQueueOrder[];
    onOpenChange: (open: boolean) => void;
    onComplete?: () => void;
}

export function FulfillmentQueueDialog({
    open,
    orders,
    onOpenChange,
    onComplete,
}: Readonly<FulfillmentQueueDialogProps>) {
    const { i18n } = useLingui();
    const { refetchPaginatedList } = usePaginatedList();
    const [currentIndex, setCurrentIndex] = useState(0);
    const [completedCount, setCompletedCount] = useState(0);
    const orderIds = useMemo(() => orders.map(order => order.id).join(','), [orders]);
    const current = orders[currentIndex];

    useEffect(() => {
        if (open) {
            setCurrentIndex(0);
            setCompletedCount(0);
        }
    }, [open, orderIds]);

    const query = useQuery({
        queryKey: ['order-fulfillment-queue', current?.id],
        queryFn: () => {
            if (!current) {
                throw new Error('No order selected for fulfillment');
            }
            return api.query(orderDetailDocument, { id: current.id });
        },
        enabled: open && Boolean(current),
        staleTime: 0,
    });

    const finishCurrentOrder = () => {
        if (currentIndex < orders.length - 1) {
            setCompletedCount(count => count + 1);
            setCurrentIndex(index => index + 1);
            return;
        }
        onOpenChange(false);
        refetchPaginatedList();
        onComplete?.();
    };

    const handleOpenChange = (nextOpen: boolean) => {
        if (!nextOpen && completedCount > 0) {
            refetchPaginatedList();
            onComplete?.();
        }
        onOpenChange(nextOpen);
    };

    const skipCurrentOrder = () => {
        if (currentIndex < orders.length - 1) {
            setCurrentIndex(index => index + 1);
            return;
        }
        handleOpenChange(false);
    };

    const order = query.data?.order;
    if (order && current && order.id === current.id) {
        return (
            <FulfillOrderDialog
                key={current.id}
                order={order}
                open={open}
                hideTrigger
                closeOnSuccess={false}
                descriptionPrefix={
                    <>
                        {i18n._(messages.progress)} · {currentIndex + 1}/{orders.length} · {current.code}
                    </>
                }
                onOpenChange={handleOpenChange}
                onSuccess={finishCurrentOrder}
            />
        );
    }

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>{i18n._(messages.loading)}</DialogTitle>
                    <DialogDescription>
                        {current ? (
                            <>
                                {i18n._(messages.progress)} · {currentIndex + 1}/{orders.length} ·{' '}
                                {current.code}
                            </>
                        ) : (
                            i18n._(messages.loadError)
                        )}
                    </DialogDescription>
                </DialogHeader>
                {query.isError || (query.isSuccess && !order) ? (
                    <div className="flex min-h-28 items-center justify-between gap-4 rounded-md bg-muted/50 p-4">
                        <p className="text-sm text-muted-foreground">{i18n._(messages.loadError)}</p>
                        <div className="flex shrink-0 gap-2">
                            {orders.length > 1 && (
                                <Button variant="ghost" size="sm" onClick={skipCurrentOrder}>
                                    {i18n._(messages.skip)}
                                </Button>
                            )}
                            <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
                                <RefreshCw className="size-4" aria-hidden="true" />
                                {i18n._(messages.retry)}
                            </Button>
                        </div>
                    </div>
                ) : (
                    <LoadingOrderDetails />
                )}
            </DialogContent>
        </Dialog>
    );
}

export function FulfillmentQueueButton({
    order,
    children,
}: Readonly<{ order: FulfillmentQueueOrder; children: ReactNode }>) {
    const [open, setOpen] = useState(false);
    return (
        <>
            <Button
                size="sm"
                onClick={event => {
                    event.stopPropagation();
                    setOpen(true);
                }}
            >
                {children}
            </Button>
            <FulfillmentQueueDialog open={open} orders={[order]} onOpenChange={setOpen} />
        </>
    );
}

function LoadingOrderDetails() {
    return (
        <div className="space-y-3 py-2" aria-busy="true">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-10 w-2/3" />
        </div>
    );
}
