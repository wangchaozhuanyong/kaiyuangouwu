import { EntityEditorSheet } from '@/vdb/components/shared/entity-editor-sheet.js';
import { Button } from '@/vdb/components/ui/button.js';
import { NEW_ENTITY_PATH } from '@/vdb/constants.js';
import { ActionBarItem } from '@/vdb/framework/layout-engine/action-bar-item-wrapper.js';
import { ListPage } from '@/vdb/framework/page/list-page.js';
import { Trans } from '@lingui/react/macro';
import { createFileRoute } from '@tanstack/react-router';
import { PlusIcon } from 'lucide-react';
import { useState } from 'react';
import { DeleteCountriesBulkAction } from './components/country-bulk-actions.js';
import { countriesListQuery } from './countries.graphql.js';
import { CountryEditor } from './countries_.$id.js';

export const Route = createFileRoute('/_authenticated/_countries/countries')({
    component: CountryListPage,
    loader: () => ({ breadcrumb: () => <Trans>Countries</Trans> }),
});

function CountryListPage() {
    const [selectedCountry, setSelectedCountry] = useState<{ id: string; name?: string }>();
    return (
        <>
            <ListPage
                pageId="country-list"
                listQuery={countriesListQuery}
                route={Route}
                title={<Trans>Countries</Trans>}
                defaultVisibility={{
                    name: true,
                    code: true,
                    enabled: true,
                }}
                onSearchTermChange={searchTerm => {
                    return searchTerm
                        ? {
                              name: { contains: searchTerm },
                              code: { contains: searchTerm },
                          }
                        : {};
                }}
                transformVariables={variables => {
                    return {
                        ...variables,
                        options: {
                            ...variables.options,
                            filterOperator: 'OR',
                        },
                    };
                }}
                customizeColumns={{
                    name: {
                        cell: ({ row }) => <span>{row.original.name}</span>,
                    },
                }}
                primaryRowAction={{
                    label: <Trans>Edit</Trans>,
                    onClick: row => setSelectedCountry({ id: row.original.id, name: row.original.name }),
                }}
                bulkActions={[
                    {
                        component: DeleteCountriesBulkAction,
                    },
                ]}
            >
                <ActionBarItem itemId="create-button" requiresPermission={['CreateCountry']}>
                    <Button onClick={() => setSelectedCountry({ id: NEW_ENTITY_PATH })}>
                        <PlusIcon />
                        <Trans>Add Country</Trans>
                    </Button>
                </ActionBarItem>
            </ListPage>
            <EntityEditorSheet
                open={Boolean(selectedCountry)}
                title={
                    selectedCountry?.id === NEW_ENTITY_PATH ? (
                        <Trans>Add Country</Trans>
                    ) : (
                        <Trans>Edit country</Trans>
                    )
                }
                description={<Trans>Edit the country without leaving the list</Trans>}
                loadingLabel={<Trans>Loading country...</Trans>}
                onOpenChange={open => {
                    if (!open) setSelectedCountry(undefined);
                }}
            >
                {({ setDirty, requestClose, closeAfterSave }) =>
                    selectedCountry ? (
                        <CountryEditor
                            countryId={selectedCountry.id}
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
