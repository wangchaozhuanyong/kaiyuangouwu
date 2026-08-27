import { EntityEditorSheet } from '@/vdb/components/shared/entity-editor-sheet.js';
import { NEW_ENTITY_PATH } from '@/vdb/constants.js';
import { useLingui } from '@lingui/react/macro';

import { ProductOptionEditor } from '../../_option-groups/option-groups_.$groupId.options_.$id.js';

interface ProductOptionEditorSheetProps {
    open: boolean;
    groupId: string;
    optionId?: string;
    optionName?: string;
    fullPageHref?: string;
    linkSearch?: Record<string, string>;
    onOpenChange: (open: boolean) => void;
}

export function ProductOptionEditorSheet({
    open,
    groupId,
    optionId,
    optionName,
    fullPageHref,
    linkSearch,
    onOpenChange,
}: Readonly<ProductOptionEditorSheetProps>) {
    const { t } = useLingui();
    const isNew = optionId === NEW_ENTITY_PATH;

    return (
        <EntityEditorSheet
            open={open}
            title={isNew ? t`Add option value` : t`Edit ${optionName ?? t`product option`}`}
            description={t`Edit the product option without leaving the option group`}
            loadingLabel={t`Loading product option...`}
            onOpenChange={onOpenChange}
        >
            {({ setDirty, requestClose, closeAfterSave }) =>
                optionId ? (
                    <ProductOptionEditor
                        groupId={groupId}
                        optionId={optionId}
                        presentation="sheet"
                        fullPageHref={fullPageHref}
                        linkSearch={linkSearch}
                        onDirtyChange={setDirty}
                        onRequestClose={requestClose}
                        onSaved={behavior => {
                            if (behavior === 'close') {
                                closeAfterSave();
                            }
                        }}
                    />
                ) : null
            }
        </EntityEditorSheet>
    );
}
