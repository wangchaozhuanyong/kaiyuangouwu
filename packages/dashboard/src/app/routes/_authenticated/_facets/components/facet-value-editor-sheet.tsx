import { EntityEditorSheet } from '@/vdb/components/shared/entity-editor-sheet.js';
import { NEW_ENTITY_PATH } from '@/vdb/constants.js';
import { useLingui } from '@lingui/react/macro';

import { FacetValueEditor } from '../facets_.$facetId.values_.$id.js';

interface FacetValueEditorSheetProps {
    open: boolean;
    facetId: string;
    facetValueId?: string;
    facetValueName?: string;
    onOpenChange: (open: boolean) => void;
}

export function FacetValueEditorSheet({
    open,
    facetId,
    facetValueId,
    facetValueName,
    onOpenChange,
}: Readonly<FacetValueEditorSheetProps>) {
    const { t } = useLingui();
    const isNew = facetValueId === NEW_ENTITY_PATH;

    return (
        <EntityEditorSheet
            open={open}
            title={isNew ? t`Add facet value` : t`Edit ${facetValueName ?? t`facet value`}`}
            description={t`Edit the facet value without leaving the facet`}
            loadingLabel={t`Loading facet value...`}
            onOpenChange={onOpenChange}
        >
            {({ setDirty, requestClose, closeAfterSave }) =>
                facetValueId ? (
                    <FacetValueEditor
                        facetId={facetId}
                        facetValueId={facetValueId}
                        presentation="sheet"
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
