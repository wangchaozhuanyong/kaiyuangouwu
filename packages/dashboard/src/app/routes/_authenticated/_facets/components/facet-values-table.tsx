import { PaginatedListDataTable } from '@/vdb/components/shared/paginated-list-data-table.js';
import { Button } from '@/vdb/components/ui/button.js';
import { NEW_ENTITY_PATH } from '@/vdb/constants.js';
import { addCustomFields } from '@/vdb/framework/document-introspection/add-custom-fields.js';
import { graphql } from '@/vdb/graphql/graphql.js';
import { useUserSettings } from '@/vdb/hooks/use-user-settings.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { SortingState } from '@tanstack/react-table';
import { PlusIcon } from 'lucide-react';
import { useRef, useState } from 'react';
import { DeleteFacetValuesBulkAction } from './facet-value-bulk-actions.js';
import { FacetValueEditorSheet } from './facet-value-editor-sheet.js';

const pageId = 'facet-values-table';

export const facetValueListDocument = graphql(`
    query FacetValueList($options: FacetValueListOptions) {
        facetValues(options: $options) {
            items {
                id
                createdAt
                updatedAt
                name
                code
                customFields
            }
            totalItems
        }
    }
`);

export interface FacetValuesTableProps {
    facetId: string;
    registerRefresher?: (refresher: () => void) => void;
    onEditFacetValue?: (facetValue: { id: string; name: string }) => void;
    onAddFacetValue?: () => void;
}

export function FacetValuesTable({
    facetId,
    registerRefresher,
    onEditFacetValue,
    onAddFacetValue,
}: Readonly<FacetValuesTableProps>) {
    const { t } = useLingui();
    const [sorting, setSorting] = useState<SortingState>([]);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    const { setTableSettings, settings } = useUserSettings();
    const refreshRef = useRef<() => void>(() => {});
    const [selectedFacetValue, setSelectedFacetValue] = useState<{ id: string; name?: string }>();

    const tableSettings = pageId ? settings.tableSettings?.[pageId] : undefined;
    const defaultVisibility = {
        name: true,
        code: true,
    };

    const columnVisibility = pageId
        ? (tableSettings?.columnVisibility ?? defaultVisibility)
        : defaultVisibility;
    const columnOrder = pageId ? (tableSettings?.columnOrder ?? []) : ['name', 'code'];
    const columnFilters = pageId ? tableSettings?.columnFilters : [];

    return (
        <>
            <div className="mb-4 flex justify-end">
                <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                        if (onAddFacetValue) {
                            onAddFacetValue();
                        } else {
                            setSelectedFacetValue({ id: NEW_ENTITY_PATH });
                        }
                    }}
                >
                    <PlusIcon />
                    <Trans>Add facet value</Trans>
                </Button>
            </div>
            <PaginatedListDataTable
                listQuery={addCustomFields(facetValueListDocument)}
                page={page}
                itemsPerPage={pageSize}
                sorting={sorting}
                columnFilters={columnFilters}
                defaultColumnOrder={columnOrder}
                defaultVisibility={columnVisibility}
                onPageChange={(table, page, perPage) => {
                    if (pageId) {
                        setPageSize(perPage);
                        setPage(page);
                    }
                }}
                onSortChange={(table, sorting) => {
                    setSorting(sorting);
                }}
                onFilterChange={(table, filters) => {
                    if (pageId) {
                        setTableSettings(pageId, 'columnFilters', filters);
                    }
                }}
                onColumnVisibilityChange={(table, columnVisibility) => {
                    if (pageId) {
                        setTableSettings(pageId, 'columnVisibility', columnVisibility);
                    }
                }}
                registerRefresher={refresher => {
                    refreshRef.current = refresher;
                    registerRefresher?.(refresher);
                }}
                transformVariables={variables => {
                    const filter = variables.options?.filter ?? {};
                    return {
                        options: {
                            filter: {
                                ...filter,
                                facetId: { eq: facetId },
                            },
                            sort: variables.options?.sort,
                            take: pageSize,
                            skip: (page - 1) * pageSize,
                        },
                    };
                }}
                onSearchTermChange={searchTerm => {
                    return {
                        name: {
                            contains: searchTerm,
                        },
                    };
                }}
                customizeColumns={{
                    name: {
                        header: t`Name`,
                        cell: ({ row }) => <span>{row.original.name}</span>,
                    },
                }}
                primaryRowAction={{
                    label: <Trans>Edit</Trans>,
                    onClick: row => {
                        const facetValue = { id: row.original.id, name: row.original.name };
                        if (onEditFacetValue) {
                            onEditFacetValue(facetValue);
                        } else {
                            setSelectedFacetValue(facetValue);
                        }
                    },
                }}
                bulkActions={[
                    {
                        component: DeleteFacetValuesBulkAction,
                    },
                ]}
            />
            {!onEditFacetValue && !onAddFacetValue && (
                <FacetValueEditorSheet
                    open={Boolean(selectedFacetValue)}
                    facetId={facetId}
                    facetValueId={selectedFacetValue?.id}
                    facetValueName={selectedFacetValue?.name}
                    onOpenChange={open => {
                        if (!open) {
                            setSelectedFacetValue(undefined);
                            refreshRef.current();
                        }
                    }}
                />
            )}
        </>
    );
}
