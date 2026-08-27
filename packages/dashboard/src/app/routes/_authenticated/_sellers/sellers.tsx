import { EntityEditorSheet } from '@/vdb/components/shared/entity-editor-sheet.js';
import { Button } from '@/vdb/components/ui/button.js';
import { NEW_ENTITY_PATH } from '@/vdb/constants.js';
import { ActionBarItem } from '@/vdb/framework/layout-engine/action-bar-item-wrapper.js';
import { ListPage } from '@/vdb/framework/page/list-page.js';
import { Trans } from '@lingui/react/macro';
import { createFileRoute } from '@tanstack/react-router';
import { PlusIcon } from 'lucide-react';
import { useState } from 'react';
import { DeleteSellersBulkAction } from './components/seller-bulk-actions.js';
import { sellerListQuery } from './sellers.graphql.js';
import { SellerEditor } from './sellers_.$id.js';

export const Route = createFileRoute('/_authenticated/_sellers/sellers')({
    component: SellerListPage,
    loader: () => ({ breadcrumb: () => <Trans>Sellers</Trans> }),
});

function SellerListPage() {
    const [selectedSeller, setSelectedSeller] = useState<{ id: string; name?: string }>();
    return (
        <>
            <ListPage
                pageId="seller-list"
                listQuery={sellerListQuery}
                route={Route}
                title={<Trans>Sellers</Trans>}
                defaultVisibility={{
                    name: true,
                }}
                onSearchTermChange={searchTerm => {
                    return {
                        name: { contains: searchTerm },
                    };
                }}
                customizeColumns={{
                    name: {
                        cell: ({ row }) => <span>{row.original.name}</span>,
                    },
                }}
                primaryRowAction={{
                    label: <Trans>Edit</Trans>,
                    onClick: row => setSelectedSeller({ id: row.original.id, name: row.original.name }),
                }}
                bulkActions={[
                    {
                        component: DeleteSellersBulkAction,
                    },
                ]}
            >
                <ActionBarItem itemId="create-button" requiresPermission={['CreateSeller']}>
                    <Button onClick={() => setSelectedSeller({ id: NEW_ENTITY_PATH })}>
                        <PlusIcon className="mr-2 h-4 w-4" />
                        <Trans>New Seller</Trans>
                    </Button>
                </ActionBarItem>
            </ListPage>
            <EntityEditorSheet
                open={Boolean(selectedSeller)}
                title={
                    selectedSeller?.id === NEW_ENTITY_PATH ? (
                        <Trans>New Seller</Trans>
                    ) : (
                        <Trans>Edit seller</Trans>
                    )
                }
                description={<Trans>Edit the seller without leaving the list</Trans>}
                loadingLabel={<Trans>Loading seller...</Trans>}
                onOpenChange={open => {
                    if (!open) setSelectedSeller(undefined);
                }}
            >
                {({ setDirty, requestClose, closeAfterSave }) =>
                    selectedSeller ? (
                        <SellerEditor
                            sellerId={selectedSeller.id}
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
