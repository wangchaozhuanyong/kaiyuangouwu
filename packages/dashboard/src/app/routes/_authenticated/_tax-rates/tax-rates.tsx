import { BooleanDisplayBadge } from '@/vdb/components/data-display/boolean.js';
import { EntityEditorSheet } from '@/vdb/components/shared/entity-editor-sheet.js';
import { Button } from '@/vdb/components/ui/button.js';
import { NEW_ENTITY_PATH } from '@/vdb/constants.js';
import { ActionBarItem } from '@/vdb/framework/layout-engine/action-bar-item-wrapper.js';
import { ListPage } from '@/vdb/framework/page/list-page.js';
import { api } from '@/vdb/graphql/api.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { createFileRoute } from '@tanstack/react-router';
import { PlusIcon } from 'lucide-react';
import { useState } from 'react';
import { mapFacetedFilterFields } from '../../../common/map-faceted-filter-fields.js';
import { taxCategoryListQuery } from '../_tax-categories/tax-categories.graphql.js';
import { zoneListQuery } from '../_zones/zones.graphql.js';
import { DeleteTaxRatesBulkAction } from './components/tax-rate-bulk-actions.js';
import { taxRateListQuery } from './tax-rates.graphql.js';
import { TaxRateEditor } from './tax-rates_.$id.js';

export const Route = createFileRoute('/_authenticated/_tax-rates/tax-rates')({
    component: TaxRateListPage,
    loader: () => ({ breadcrumb: () => <Trans>Tax Rates</Trans> }),
});

function TaxRateListPage() {
    const { t } = useLingui();
    const [selectedTaxRate, setSelectedTaxRate] = useState<{ id: string; name?: string }>();
    return (
        <>
            <ListPage
                pageId="tax-rate-list"
                listQuery={taxRateListQuery}
                route={Route}
                title={<Trans>Tax Rates</Trans>}
                defaultVisibility={{
                    name: true,
                    enabled: true,
                    category: true,
                    zone: true,
                    value: true,
                }}
                onSearchTermChange={searchTerm => {
                    if (searchTerm === '') {
                        return {};
                    }

                    return {
                        name: { contains: searchTerm },
                    };
                }}
                transformVariables={input => {
                    const facetedFilters = input.options?.filter?._and ?? [];
                    mapFacetedFilterFields(facetedFilters, {
                        category: 'categoryId',
                        zone: 'zoneId',
                    });
                    return input;
                }}
                facetedFilters={{
                    enabled: {
                        title: t`Enabled`,
                        options: [
                            { label: t`Enabled`, value: true },
                            { label: t`Disabled`, value: false },
                        ],
                    },
                    category: {
                        title: t`Category`,
                        optionsFn: async () => {
                            const { taxCategories } = await api.query(taxCategoryListQuery);
                            return taxCategories.items.map(category => ({
                                label: category.name,
                                value: category.id,
                            }));
                        },
                    },
                    zone: {
                        title: t`Zone`,
                        optionsFn: async () => {
                            const { zones } = await api.query(zoneListQuery);
                            return zones.items.map(zone => ({
                                label: zone.name,
                                value: zone.id,
                            }));
                        },
                    },
                }}
                customizeColumns={{
                    name: {
                        cell: ({ row }) => <span>{row.original.name}</span>,
                    },
                    enabled: {
                        cell: ({ row }) => <BooleanDisplayBadge value={row.original.enabled} />,
                    },
                    category: {
                        cell: ({ row }) => row.original.category?.name,
                    },
                    zone: {
                        cell: ({ row }) => row.original.zone?.name,
                    },
                    value: {
                        cell: ({ row }) => `${row.original.value}%`,
                    },
                }}
                primaryRowAction={{
                    label: <Trans>Edit</Trans>,
                    onClick: row => setSelectedTaxRate({ id: row.original.id, name: row.original.name }),
                }}
                bulkActions={[
                    {
                        component: DeleteTaxRatesBulkAction,
                    },
                ]}
            >
                <ActionBarItem itemId="create-button" requiresPermission={['CreateTaxRate']}>
                    <Button onClick={() => setSelectedTaxRate({ id: NEW_ENTITY_PATH })}>
                        <PlusIcon />
                        <Trans>New Tax Rate</Trans>
                    </Button>
                </ActionBarItem>
            </ListPage>
            <EntityEditorSheet
                open={Boolean(selectedTaxRate)}
                title={
                    selectedTaxRate?.id === NEW_ENTITY_PATH ? (
                        <Trans>New Tax Rate</Trans>
                    ) : (
                        <Trans>Edit tax rate</Trans>
                    )
                }
                description={<Trans>Edit the tax rate without leaving the list</Trans>}
                loadingLabel={<Trans>Loading tax rate...</Trans>}
                onOpenChange={open => {
                    if (!open) setSelectedTaxRate(undefined);
                }}
            >
                {({ setDirty, requestClose, closeAfterSave }) =>
                    selectedTaxRate ? (
                        <TaxRateEditor
                            taxRateId={selectedTaxRate.id}
                            presentation="sheet"
                            onDirtyChange={setDirty}
                            onRequestClose={requestClose}
                            onSaved={behavior => {
                                if (behavior === 'close') closeAfterSave();
                            }}
                        />
                    ) : null
                }
            </EntityEditorSheet>
        </>
    );
}
