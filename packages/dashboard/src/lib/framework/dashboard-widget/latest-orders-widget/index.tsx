import { PaginatedListDataTable } from '@/vdb/components/shared/paginated-list-data-table.js';
import {
    CustomerCell,
    OrderMoneyCell,
    OrderStateCell,
} from '@/vdb/components/shared/table-cell/order-table-cell-components.js';
import { Button } from '@/vdb/components/ui/button.js';
import { useLocalFormat } from '@/vdb/hooks/use-local-format.js';
import { useUserSettings } from '@/vdb/hooks/use-user-settings.js';
import { useWidgetFilters } from '@/vdb/hooks/use-widget-filters.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { Link } from '@tanstack/react-router';
import { ColumnFiltersState, SortingState } from '@tanstack/react-table';
import { useEffect, useState } from 'react';
import { DashboardBaseWidget } from '../base-widget.js';
import { latestOrdersQuery } from './latest-orders-widget.graphql.js';

export const WIDGET_ID = 'latest-orders-widget';

export function LatestOrdersWidget() {
    const { t } = useLingui();
    const { formatRelativeDate } = useLocalFormat();
    const { dateRange } = useWidgetFilters();
    const { setTableSettings, settings } = useUserSettings();
    const tableSettings = settings.tableSettings?.[WIDGET_ID];

    const [sorting, setSorting] = useState<SortingState>([
        {
            id: 'orderPlacedAt',
            desc: true,
        },
    ]);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(tableSettings?.pageSize ?? 10);
    const [filters, setFilters] = useState<ColumnFiltersState>([]);

    // Update page size if user settings change
    useEffect(() => {
        if (tableSettings?.pageSize !== undefined) {
            setPageSize(tableSettings.pageSize);
        }
    }, [tableSettings?.pageSize]);

    const defaultVisibility = {
        code: true,
        customer: true,
        state: true,
        total: true,
        orderPlacedAt: true,
    };

    const columnVisibility = tableSettings?.columnVisibility ?? defaultVisibility;

    return (
        <DashboardBaseWidget
            id={WIDGET_ID}
            title={t`Recent orders`}
            description={t`Orders placed during the selected period`}
            actions={
                <Button variant="outline" size="sm" render={<Link to="/orders" />}>
                    <Trans>View all orders</Trans>
                </Button>
            }
        >
            <PaginatedListDataTable
                page={page}
                transformQueryKey={queryKey => [...queryKey, dateRange.from, dateRange.to]}
                transformVariables={variables => ({
                    ...variables,
                    options: {
                        ...variables.options,
                        filter: {
                            active: {
                                eq: false,
                            },
                            state: {
                                notIn: ['Cancelled', 'Draft'],
                            },
                            orderPlacedAt: {
                                between: {
                                    start: dateRange.from.toISOString(),
                                    end: dateRange.to.toISOString(),
                                },
                            },
                            ...(variables.options?.filter ?? {}),
                        },
                    },
                })}
                customizeColumns={{
                    code: {
                        header: t`Order number`,
                        cell: ({ row }) => {
                            return (
                                <Button variant="ghost" render={<Link to={`/orders/${row.original.id}`} />}>
                                    {row.original.code}
                                </Button>
                            );
                        },
                    },
                    orderPlacedAt: {
                        header: t`Order time`,
                        enableColumnFilter: false,
                        cell: ({ row }) => {
                            return (
                                <span className="capitalize">
                                    {formatRelativeDate(row.original.orderPlacedAt ?? new Date())}
                                </span>
                            );
                        },
                    },
                    total: {
                        meta: {
                            dependencies: ['currencyCode'],
                        },
                        header: t`Order amount`,
                        cell: OrderMoneyCell,
                    },
                    totalWithTax: {
                        meta: { dependencies: ['currencyCode'] },
                        cell: OrderMoneyCell,
                    },
                    state: { cell: OrderStateCell },
                    customer: { cell: CustomerCell },
                }}
                itemsPerPage={pageSize}
                sorting={sorting}
                columnFilters={filters}
                listQuery={latestOrdersQuery}
                defaultVisibility={columnVisibility}
                onPageChange={(_, page, newPageSize) => {
                    setPage(page);
                    setPageSize(newPageSize);
                    setTableSettings(WIDGET_ID, 'pageSize', newPageSize);
                }}
                onSortChange={(_, sorting) => {
                    setSorting(sorting);
                }}
                onFilterChange={(_, filters) => {
                    setFilters(filters);
                }}
                onColumnVisibilityChange={(_, columnVisibility) => {
                    setTableSettings(WIDGET_ID, 'columnVisibility', columnVisibility);
                }}
            />
        </DashboardBaseWidget>
    );
}
