import { EntityEditorSheet } from '@/vdb/components/shared/entity-editor-sheet.js';
import { Badge } from '@/vdb/components/ui/badge.js';
import { Button } from '@/vdb/components/ui/button.js';
import { NEW_ENTITY_PATH } from '@/vdb/constants.js';
import { ActionBarItem } from '@/vdb/framework/layout-engine/action-bar-item-wrapper.js';
import { ListPage } from '@/vdb/framework/page/list-page.js';
import { Trans } from '@lingui/react/macro';
import { createFileRoute } from '@tanstack/react-router';
import { PlusIcon } from 'lucide-react';
import { useState } from 'react';
import { DeleteTaxCategoriesBulkAction } from './components/tax-category-bulk-actions.js';
import { taxCategoryListQuery } from './tax-categories.graphql.js';
import { TaxCategoryEditor } from './tax-categories_.$id.js';

export const Route = createFileRoute('/_authenticated/_tax-categories/tax-categories')({
    component: TaxCategoryListPage,
    loader: () => ({ breadcrumb: () => <Trans>Tax Categories</Trans> }),
});

function TaxCategoryListPage() {
    const [selectedTaxCategory, setSelectedTaxCategory] = useState<{ id: string; name?: string }>();
    return (
        <>
            <ListPage
                pageId="tax-category-list"
                listQuery={taxCategoryListQuery}
                route={Route}
                title={<Trans>Tax Categories</Trans>}
                defaultVisibility={{
                    name: true,
                    isDefault: true,
                }}
                onSearchTermChange={searchTerm => {
                    if (searchTerm === '') {
                        return {};
                    }

                    return {
                        name: { contains: searchTerm },
                    };
                }}
                customizeColumns={{
                    name: {
                        cell: ({ row }) => <span>{row.original.name}</span>,
                    },
                    isDefault: {
                        cell: ({ row }) => (
                            <Badge variant={row.original.isDefault ? 'success' : 'secondary'}>
                                {row.original.isDefault ? <Trans>Yes</Trans> : <Trans>No</Trans>}
                            </Badge>
                        ),
                    },
                }}
                primaryRowAction={{
                    label: <Trans>Edit</Trans>,
                    onClick: row => setSelectedTaxCategory({ id: row.original.id, name: row.original.name }),
                }}
                bulkActions={[
                    {
                        component: DeleteTaxCategoriesBulkAction,
                    },
                ]}
            >
                <ActionBarItem itemId="create-button" requiresPermission={['CreateTaxCategory']}>
                    <Button onClick={() => setSelectedTaxCategory({ id: NEW_ENTITY_PATH })}>
                        <PlusIcon />
                        <Trans>New Tax Category</Trans>
                    </Button>
                </ActionBarItem>
            </ListPage>
            <EntityEditorSheet
                open={Boolean(selectedTaxCategory)}
                title={
                    selectedTaxCategory?.id === NEW_ENTITY_PATH ? (
                        <Trans>New Tax Category</Trans>
                    ) : (
                        <Trans>Edit tax category</Trans>
                    )
                }
                description={<Trans>Edit the tax category without leaving the list</Trans>}
                loadingLabel={<Trans>Loading tax category...</Trans>}
                onOpenChange={open => {
                    if (!open) setSelectedTaxCategory(undefined);
                }}
            >
                {({ setDirty, requestClose, closeAfterSave }) =>
                    selectedTaxCategory ? (
                        <TaxCategoryEditor
                            taxCategoryId={selectedTaxCategory.id}
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
