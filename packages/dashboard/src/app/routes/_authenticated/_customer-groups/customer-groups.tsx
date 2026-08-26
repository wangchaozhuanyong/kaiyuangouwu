import { EntityEditorSheet } from '@/vdb/components/shared/entity-editor-sheet.js';
import { Button } from '@/vdb/components/ui/button.js';
import { NEW_ENTITY_PATH } from '@/vdb/constants.js';
import { ActionBarItem } from '@/vdb/framework/layout-engine/action-bar-item-wrapper.js';
import { ListPage } from '@/vdb/framework/page/list-page.js';
import { Trans } from '@lingui/react/macro';
import { createFileRoute } from '@tanstack/react-router';
import { PlusIcon } from 'lucide-react';
import { useState } from 'react';
import { DeleteCustomerGroupsBulkAction } from './components/customer-group-bulk-actions.js';
import { CustomerGroupMembersSheet } from './components/customer-group-members-sheet.js';
import { customerGroupListDocument } from './customer-groups.graphql.js';
import { CustomerGroupEditor } from './customer-groups_.$id.js';

export const Route = createFileRoute('/_authenticated/_customer-groups/customer-groups')({
    component: CustomerGroupListPage,
    loader: () => ({ breadcrumb: () => <Trans>Customer Groups</Trans> }),
});

function CustomerGroupListPage() {
    const [quickCreateOpen, setQuickCreateOpen] = useState(false);
    return (
        <>
            <ListPage
                pageId="customer-group-list"
                title={<Trans>Customer Groups</Trans>}
                listQuery={customerGroupListDocument}
                route={Route}
                customizeColumns={{
                    name: {
                        cell: ({ row }) => <span>{row.original.name}</span>,
                    },
                    customers: {
                        cell: ({ cell }) => {
                            const value = cell.getValue();
                            if (!value) {
                                return null;
                            }
                            return (
                                <div className="flex flex-wrap gap-2 items-center">
                                    <CustomerGroupMembersSheet
                                        customerGroupId={cell.row.original.id}
                                        customerGroupName={cell.row.original.name}
                                    >
                                        <Trans>{value.totalItems} customers</Trans>
                                    </CustomerGroupMembersSheet>
                                </div>
                            );
                        },
                    },
                }}
                onSearchTermChange={searchTerm => {
                    return {
                        name: { contains: searchTerm },
                    };
                }}
                primaryRowAction={{ label: <Trans>Manage</Trans>, href: row => `./${row.original.id}` }}
                bulkActions={[
                    {
                        component: DeleteCustomerGroupsBulkAction,
                    },
                ]}
            >
                <ActionBarItem itemId="create-button" requiresPermission={['CreateCustomerGroup']}>
                    <Button onClick={() => setQuickCreateOpen(true)}>
                        <PlusIcon className="mr-2 h-4 w-4" />
                        <Trans>New Customer Group</Trans>
                    </Button>
                </ActionBarItem>
            </ListPage>
            <EntityEditorSheet
                open={quickCreateOpen}
                title={<Trans>New Customer Group</Trans>}
                description={<Trans>Create a customer group without leaving the list</Trans>}
                loadingLabel={<Trans>Loading customer group...</Trans>}
                onOpenChange={setQuickCreateOpen}
            >
                {({ setDirty, requestClose, closeAfterSave }) => (
                    <CustomerGroupEditor
                        customerGroupId={NEW_ENTITY_PATH}
                        presentation="sheet"
                        onDirtyChange={setDirty}
                        onRequestClose={requestClose}
                        onSaved={behavior => {
                            if (behavior === 'close') closeAfterSave();
                        }}
                    />
                )}
            </EntityEditorSheet>
        </>
    );
}
