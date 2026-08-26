import { EntityEditorSheet } from '@/vdb/components/shared/entity-editor-sheet.js';
import { Button } from '@/vdb/components/ui/button.js';
import { NEW_ENTITY_PATH } from '@/vdb/constants.js';
import { ActionBarItem } from '@/vdb/framework/layout-engine/action-bar-item-wrapper.js';
import { ListPage } from '@/vdb/framework/page/list-page.js';
import { Trans } from '@lingui/react/macro';
import { createFileRoute } from '@tanstack/react-router';
import { PlusIcon } from 'lucide-react';
import { useState } from 'react';
import {
    AssignStockLocationsToChannelBulkAction,
    DeleteStockLocationsBulkAction,
    RemoveStockLocationsFromChannelBulkAction,
} from './components/stock-location-bulk-actions.js';
import { stockLocationListQuery } from './stock-locations.graphql.js';
import { StockLocationEditor } from './stock-locations_.$id.js';

export const Route = createFileRoute('/_authenticated/_stock-locations/stock-locations')({
    component: StockLocationListPage,
    loader: () => ({ breadcrumb: () => <Trans>Stock Locations</Trans> }),
});

function StockLocationListPage() {
    const [selectedStockLocation, setSelectedStockLocation] = useState<{ id: string; name?: string }>();
    return (
        <>
            <ListPage
                pageId="stock-location-list"
                title={<Trans>Stock Locations</Trans>}
                listQuery={stockLocationListQuery}
                route={Route}
                customizeColumns={{
                    name: {
                        cell: ({ row }) => <span>{row.original.name}</span>,
                    },
                }}
                primaryRowAction={{
                    label: <Trans>Edit</Trans>,
                    onClick: row =>
                        setSelectedStockLocation({ id: row.original.id, name: row.original.name }),
                }}
                onSearchTermChange={searchTerm => {
                    return {
                        name: { contains: searchTerm },
                    };
                }}
                bulkActions={[
                    [
                        {
                            component: AssignStockLocationsToChannelBulkAction,
                            order: 100,
                        },
                        {
                            component: RemoveStockLocationsFromChannelBulkAction,
                            order: 200,
                        },
                    ],
                    [
                        {
                            component: DeleteStockLocationsBulkAction,
                        },
                    ],
                ]}
            >
                <ActionBarItem itemId="create-button" requiresPermission={['CreateStockLocation']}>
                    <Button onClick={() => setSelectedStockLocation({ id: NEW_ENTITY_PATH })}>
                        <PlusIcon className="mr-2 h-4 w-4" />
                        <Trans>New Stock Location</Trans>
                    </Button>
                </ActionBarItem>
            </ListPage>
            <EntityEditorSheet
                open={Boolean(selectedStockLocation)}
                title={
                    selectedStockLocation?.id === NEW_ENTITY_PATH ? (
                        <Trans>New Stock Location</Trans>
                    ) : (
                        <Trans>Edit stock location</Trans>
                    )
                }
                description={<Trans>Edit the stock location without leaving the list</Trans>}
                loadingLabel={<Trans>Loading stock location...</Trans>}
                onOpenChange={open => {
                    if (!open) setSelectedStockLocation(undefined);
                }}
            >
                {({ setDirty, requestClose, closeAfterSave }) =>
                    selectedStockLocation ? (
                        <StockLocationEditor
                            stockLocationId={selectedStockLocation.id}
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
