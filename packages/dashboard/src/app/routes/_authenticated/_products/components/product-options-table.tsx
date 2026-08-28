import { PaginatedListDataTable } from '@/vdb/components/shared/paginated-list-data-table.js';
import { Button } from '@/vdb/components/ui/button.js';
import { NEW_ENTITY_PATH } from '@/vdb/constants.js';
import { graphql } from '@/vdb/graphql/graphql.js';
import { usePage } from '@/vdb/hooks/use-page.js';
import { useUserSettings } from '@/vdb/hooks/use-user-settings.js';
import { Trans } from '@lingui/react/macro';
import { ColumnFiltersState, SortingState } from '@tanstack/react-table';
import { PlusIcon } from 'lucide-react';
import { useRef, useState } from 'react';
import { deleteProductOptionDocument } from '../product-option-groups.graphql.js';
import { ProductOptionEditorSheet } from './product-option-editor-sheet.js';

export const productOptionListDocument = graphql(`
    query ProductOptionList($options: ProductOptionListOptions, $groupId: ID) {
        productOptions(options: $options, groupId: $groupId) {
            items {
                id
                createdAt
                updatedAt
                name
                code
            }
            totalItems
        }
    }
`);

export interface ProductOptionsTableProps {
    productOptionGroupId: string;
    registerRefresher?: (refresher: () => void) => void;
    getOptionHref?: (optionId: string) => string;
    newOptionHref?: string;
    linkSearch?: Record<string, string>;
}

export function ProductOptionsTable({
    productOptionGroupId,
    registerRefresher,
    getOptionHref,
    newOptionHref,
    linkSearch,
}: Readonly<ProductOptionsTableProps>) {
    const { pageId } = usePage();
    const { setTableSettings } = useUserSettings();

    const [sorting, setSorting] = useState<SortingState>([]);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    const [filters, setFilters] = useState<ColumnFiltersState>([]);
    const refreshRef = useRef<() => void>(() => {});
    const [selectedOption, setSelectedOption] = useState<{ id: string; name?: string }>();

    return (
        <>
            <div className="mb-4 flex justify-end">
                <Button
                    type="button"
                    variant="outline"
                    onClick={() => setSelectedOption({ id: NEW_ENTITY_PATH })}
                >
                    <PlusIcon />
                    <Trans>Add option value</Trans>
                </Button>
            </div>
            <PaginatedListDataTable
                listQuery={productOptionListDocument}
                deleteMutation={deleteProductOptionDocument}
                page={page}
                itemsPerPage={pageSize}
                sorting={sorting}
                columnFilters={filters}
                onPageChange={(_, page, perPage) => {
                    setPage(page);
                    setPageSize(perPage);
                }}
                onSortChange={(_, sorting) => {
                    setSorting(sorting);
                }}
                onColumnVisibilityChange={(_, columnVisibility) => {
                    if (pageId) {
                        setTableSettings(pageId, 'columnVisibility', columnVisibility);
                    }
                }}
                onFilterChange={(_, filters) => {
                    setFilters(filters);
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
                                groupId: { eq: productOptionGroupId },
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
                defaultVisibility={{
                    name: true,
                    code: true,
                }}
                customizeColumns={{
                    name: {
                        cell: ({ row }) => <span>{row.original.name}</span>,
                    },
                }}
                primaryRowAction={{
                    label: <Trans>Edit</Trans>,
                    onClick: row => setSelectedOption({ id: row.original.id, name: row.original.name }),
                }}
            />
            <ProductOptionEditorSheet
                open={Boolean(selectedOption)}
                groupId={productOptionGroupId}
                optionId={selectedOption?.id}
                optionName={selectedOption?.name}
                fullPageHref={
                    selectedOption
                        ? selectedOption.id === NEW_ENTITY_PATH
                            ? (newOptionHref ?? './options/new')
                            : (getOptionHref?.(selectedOption.id) ?? `options/${selectedOption.id}`)
                        : undefined
                }
                linkSearch={linkSearch}
                onOpenChange={open => {
                    if (!open) {
                        setSelectedOption(undefined);
                        refreshRef.current();
                    }
                }}
            />
        </>
    );
}
