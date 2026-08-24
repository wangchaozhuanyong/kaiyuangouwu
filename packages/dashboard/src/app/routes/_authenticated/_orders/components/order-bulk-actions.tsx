import { DataTableBulkActionItem } from '@/vdb/components/data-table/data-table-bulk-action-item.js';
import { BulkActionComponent } from '@/vdb/framework/extension-api/types/data-table.js';
import { ResultOf } from '@/vdb/graphql/graphql.js';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import { PackageCheck } from 'lucide-react';
import { useState } from 'react';

import { orderListDocument } from '../orders.graphql.js';
import { getOrdersReadyForFulfillment } from '../utils/order-fulfillment-utils.js';
import { FulfillmentQueueDialog } from './order-fulfillment-queue.js';

type OrderListItem = ResultOf<typeof orderListDocument>['orders']['items'][number];

const messages = {
    bulkFulfill: msg({ id: 'orderCenter.actions.bulkFulfill', message: 'Fulfill selected orders' }),
};

export const FulfillOrdersBulkAction: BulkActionComponent<OrderListItem> = ({ selection, table }) => {
    const { t } = useLingui();
    const [open, setOpen] = useState(false);
    const orders = getOrdersReadyForFulfillment(selection);

    if (orders.length === 0) {
        return null;
    }

    return (
        <>
            <DataTableBulkActionItem
                requiresPermission={['UpdateOrder']}
                closeOnClick={false}
                icon={PackageCheck}
                onClick={() => setOpen(true)}
                label={
                    <span>
                        {t(messages.bulkFulfill)} ({orders.length})
                    </span>
                }
            />
            <FulfillmentQueueDialog
                open={open}
                orders={orders}
                onOpenChange={setOpen}
                onComplete={() => table.resetRowSelection()}
            />
        </>
    );
};
