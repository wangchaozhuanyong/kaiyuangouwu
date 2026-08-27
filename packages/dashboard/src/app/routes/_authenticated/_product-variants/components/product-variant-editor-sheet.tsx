import { EntityEditorSheet } from '@/vdb/components/shared/entity-editor-sheet.js';
import { useLingui } from '@lingui/react/macro';

import { ProductVariantEditor } from '../product-variants_.$id.js';

interface ProductVariantEditorSheetProps {
    open: boolean;
    variantId?: string;
    variantName?: string;
    linkSearch?: Record<string, string>;
    onSaved?: () => void;
    onOpenChange: (open: boolean) => void;
}

export function ProductVariantEditorSheet({
    open,
    variantId,
    variantName,
    linkSearch,
    onSaved,
    onOpenChange,
}: Readonly<ProductVariantEditorSheetProps>) {
    const { t } = useLingui();

    return (
        <EntityEditorSheet
            open={open}
            size="workbench"
            title={variantName ? t`Edit ${variantName}` : t`Edit product variant`}
            description={t`Edit the product variant without leaving the list`}
            loadingLabel={t`Loading product variant...`}
            onOpenChange={onOpenChange}
        >
            {({ setDirty, requestClose }) =>
                variantId ? (
                    <ProductVariantEditor
                        variantId={variantId}
                        presentation="sheet"
                        linkSearch={linkSearch}
                        onDirtyChange={setDirty}
                        onRequestClose={requestClose}
                        onSaved={onSaved}
                    />
                ) : null
            }
        </EntityEditorSheet>
    );
}
