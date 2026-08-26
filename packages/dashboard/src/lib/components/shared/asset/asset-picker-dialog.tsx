import type { ImageSizeGuidance } from '@/vdb/components/help/help-content.js';
import { getImageSizeGuidance, localizeHelpText } from '@/vdb/components/help/help-content.js';
import { PermissionGuard } from '@/vdb/components/shared/permission-guard.js';
import { Button } from '@/vdb/components/ui/button.js';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/vdb/components/ui/dialog.js';
import { getDashboardActionBarItems } from '@/vdb/framework/layout-engine/layout-extensions.js';
import { PageContext } from '@/vdb/framework/layout-engine/page-provider.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { ImageIcon } from 'lucide-react';
import { useState } from 'react';

import { Asset, AssetGallery } from './asset-gallery.js';

export type { ImageSizeGuidance };

export function ImageSizeHint({
    guidance,
    className = '',
}: Readonly<{ guidance: ImageSizeGuidance; className?: string }>) {
    const { i18n } = useLingui();
    const copy = localizeHelpText(getImageSizeGuidance(guidance), i18n.locale);

    return (
        <p
            className={`flex items-start gap-1.5 rounded-md border bg-muted/50 px-2.5 py-2 text-xs leading-5 text-muted-foreground ${className}`}
            data-testid="image-size-hint"
        >
            <ImageIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <span>{copy}</span>
        </p>
    );
}

/**
 * @description
 * Props for the {@link AssetPickerDialog} component.
 *
 * @docsCategory components
 * @docsPage AssetPickerDialog
 */
export interface AssetPickerDialogProps {
    /**
     * @description
     * Whether the dialog is open.
     */
    open: boolean;
    /**
     * @description
     * The function to call when the dialog is closed.
     */
    onClose: () => void;
    /**
     * @description
     * The function to call when assets are selected.
     */
    onSelect: (assets: Asset[]) => void;
    /**
     * @description
     * Whether multiple assets can be selected.
     */
    multiSelect?: boolean;
    /**
     * @description
     * The initial assets that should be selected.
     */
    initialSelectedAssets?: Asset[];
    /**
     * @description
     * The title of the dialog.
     */
    title?: string;
    /**
     * @description
     * An optional page ID for the dialog. When provided, this is exposed via the
     * internal `PageContext` so that extensions can register
     * {@link DashboardActionBarItem}s targeted at this specific dialog. Any
     * registered action bar items will be rendered in the dialog footer.
     */
    pageId?: string;
    /**
     * @description
     * The image usage whose recommended dimensions should be shown in the picker.
     */
    imageGuidance?: ImageSizeGuidance;
}

/**
 * @description
 * A dialog which allows the creation and selection of assets.
 *
 * @docsCategory components
 * @docsPage AssetPickerDialog
 * @docsWeight 0
 */
export function AssetPickerDialog({
    open,
    onClose,
    onSelect,
    multiSelect = false,
    initialSelectedAssets = [],
    title,
    pageId,
    imageGuidance = 'assetLibrary',
}: AssetPickerDialogProps) {
    const { t } = useLingui();
    const [selectedAssets, setSelectedAssets] = useState<Asset[]>(initialSelectedAssets);
    const pageContextValue = { pageId };
    const extensionActionBarItems = pageId
        ? getDashboardActionBarItems(pageId).filter(item => item.type !== 'dropdown')
        : [];

    const handleAssetSelect = (assets: Asset[]) => {
        setSelectedAssets(assets);
    };

    const handleConfirm = () => {
        onSelect(selectedAssets);
        onClose();
    };

    return (
        <Dialog open={open} onOpenChange={onClose}>
            <PageContext.Provider value={pageContextValue}>
                <DialogContent className="sm:max-w-[800px] lg:max-w-[1000px] h-[85vh] p-0 flex flex-col">
                    <DialogHeader className="px-6 pt-6">
                        <DialogTitle>
                            {title ?? (multiSelect ? t`Select assets` : t`Select asset`)}
                        </DialogTitle>
                        <DialogDescription className="sr-only">
                            {multiSelect
                                ? t`Browse and select one or more assets`
                                : t`Browse and select an asset`}
                        </DialogDescription>
                        <ImageSizeHint guidance={imageGuidance} className="mt-2" />
                    </DialogHeader>

                    <div className="flex-1 overflow-y-auto px-6 pt-1">
                        <AssetGallery
                            onSelect={handleAssetSelect}
                            multiSelect="manual"
                            initialSelectedAssets={initialSelectedAssets}
                            fixedHeight={false}
                            displayBulkActions={false}
                        />
                    </div>

                    <DialogFooter className="px-6 pb-6 pt-4 border-t">
                        {extensionActionBarItems.map((item, index) => (
                            <PermissionGuard
                                key={item.id ?? `${item.pageId}-${index}`}
                                requires={item.requiresPermission ?? []}
                            >
                                <item.component context={pageContextValue} />
                            </PermissionGuard>
                        ))}
                        <Button variant="outline" onClick={onClose}>
                            <Trans>Cancel</Trans>
                        </Button>
                        <Button onClick={handleConfirm} disabled={selectedAssets.length === 0}>
                            {multiSelect ? (
                                selectedAssets.length === 1 ? (
                                    <Trans>Select 1 asset</Trans>
                                ) : (
                                    <Trans>Select {selectedAssets.length} assets</Trans>
                                )
                            ) : (
                                <Trans>Select asset</Trans>
                            )}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </PageContext.Provider>
        </Dialog>
    );
}
