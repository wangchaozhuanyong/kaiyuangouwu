import { AssetGallery, AssetViewMode } from '@/vdb/components/shared/asset/asset-gallery.js';
import { ImageSizeHint } from '@/vdb/components/shared/asset/asset-picker-dialog.js';
import { EntityEditorSheet } from '@/vdb/components/shared/entity-editor-sheet.js';
import { Page, PageBlock, PageTitle } from '@/vdb/framework/layout-engine/page-layout.js';
import { z } from '@/vdb/lib/zod.js';
import { Trans } from '@lingui/react/macro';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { AssetEditor } from './assets_.$id.js';
import { DeleteAssetsBulkAction } from './components/asset-bulk-actions.js';

const assetSearchSchema = z.object({
    perPage: z.coerce.number().int().positive().catch(24),
    viewMode: z.enum(['grid', 'list']).catch('grid'),
});

type AssetSearch = z.infer<typeof assetSearchSchema>;

export const Route = createFileRoute('/_authenticated/_assets/assets')({
    component: RouteComponent,
    loader: () => ({ breadcrumb: () => <Trans>Assets</Trans> }),
    validateSearch: (search: Record<string, unknown>) => assetSearchSchema.parse(search),
});

function RouteComponent() {
    const navigate = useNavigate({ from: Route.fullPath });
    const { perPage, viewMode } = Route.useSearch();
    const [selectedAsset, setSelectedAsset] = useState<{ id: string; name: string }>();

    const handlePageSizeChange = (newPageSize: number) => {
        navigate({
            search: (prev: AssetSearch) => ({ ...prev, perPage: newPageSize }),
        });
    };

    const handleViewModeChange = (mode: AssetViewMode) => {
        navigate({
            search: (prev: AssetSearch) => ({ ...prev, viewMode: mode }),
        });
    };

    return (
        <>
            <Page pageId="asset-list">
                <PageTitle>
                    <Trans>Assets</Trans>
                </PageTitle>
                <PageBlock blockId="asset-gallery" column="main">
                    <ImageSizeHint guidance="assetLibrary" className="mb-4" />
                    <AssetGallery
                        selectable={true}
                        multiSelect="auto"
                        pageSize={perPage}
                        onPageSizeChange={handlePageSizeChange}
                        viewMode={viewMode}
                        onViewModeChange={handleViewModeChange}
                        showDetailLinks={true}
                        onEditAsset={asset => setSelectedAsset({ id: asset.id, name: asset.name })}
                        bulkActions={[
                            {
                                component: DeleteAssetsBulkAction,
                                placement: 'primary',
                            },
                        ]}
                    />
                </PageBlock>
            </Page>
            <EntityEditorSheet
                open={Boolean(selectedAsset)}
                size="management"
                title={<Trans>Edit asset</Trans>}
                description={<Trans>Preview and edit asset details without leaving the library</Trans>}
                loadingLabel={<Trans>Loading asset...</Trans>}
                onOpenChange={open => {
                    if (!open) setSelectedAsset(undefined);
                }}
            >
                {({ setDirty, requestClose, closeAfterSave }) =>
                    selectedAsset ? (
                        <AssetEditor
                            assetId={selectedAsset.id}
                            presentation="sheet"
                            onDirtyChange={setDirty}
                            onRequestClose={requestClose}
                            onSaved={closeAfterSave}
                        />
                    ) : null
                }
            </EntityEditorSheet>
        </>
    );
}
