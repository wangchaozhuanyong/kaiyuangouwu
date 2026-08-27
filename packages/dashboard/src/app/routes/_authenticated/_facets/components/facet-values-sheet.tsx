import { Button } from '@/vdb/components/ui/button.js';
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
    SheetTrigger,
} from '@/vdb/components/ui/sheet.js';
import { NEW_ENTITY_PATH } from '@/vdb/constants.js';
import { FullWidthPageBlock } from '@/vdb/framework/layout-engine/page-layout.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { Loader2, PanelLeftOpen } from 'lucide-react';
import { Suspense, useCallback, useState } from 'react';
import { FacetValueEditor } from '../facets_.$facetId.values_.$id.js';
import { FacetValuesTable } from './facet-values-table.js';

export interface FacetValuesSheetProps {
    facetName: string;
    facetId: string;
    children?: React.ReactNode;
}

export function FacetValuesSheet({ facetName, facetId, children }: Readonly<FacetValuesSheetProps>) {
    const { t } = useLingui();
    const [open, setOpen] = useState(false);
    const [selectedFacetValue, setSelectedFacetValue] = useState<{ id: string; name?: string }>();
    const [isDirty, setIsDirty] = useState(false);

    const returnToList = useCallback(() => {
        if (isDirty && !window.confirm(t`Discard unsaved changes?`)) {
            return;
        }
        setIsDirty(false);
        setSelectedFacetValue(undefined);
    }, [isDirty, t]);

    const handleOpenChange = (nextOpen: boolean) => {
        if (!nextOpen && isDirty && !window.confirm(t`Discard unsaved changes?`)) {
            return;
        }
        if (!nextOpen) {
            setIsDirty(false);
            setSelectedFacetValue(undefined);
        }
        setOpen(nextOpen);
    };

    return (
        <Sheet open={open} onOpenChange={handleOpenChange}>
            <SheetTrigger render={<Button variant="outline" size="sm" className="flex items-center gap-2" />}>
                {children}
                <PanelLeftOpen className="w-4 h-4" />
            </SheetTrigger>
            <SheetContent className="flex min-w-[90vw] flex-col gap-0 overflow-hidden p-0 lg:min-w-[800px]">
                {selectedFacetValue ? (
                    <>
                        <SheetHeader className="sr-only">
                            <SheetTitle>
                                {selectedFacetValue.id === NEW_ENTITY_PATH
                                    ? t`Add facet value`
                                    : t`Edit ${selectedFacetValue.name ?? 'facet value'}`}
                            </SheetTitle>
                            <SheetDescription>
                                {t`Edit the facet value without leaving the facet values panel`}
                            </SheetDescription>
                        </SheetHeader>
                        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
                            <Suspense
                                fallback={
                                    <div className="flex h-full min-h-64 items-center justify-center gap-2 text-muted-foreground">
                                        <Loader2 className="h-5 w-5 animate-spin" />
                                        <span>{t`Loading facet value...`}</span>
                                    </div>
                                }
                            >
                                <FacetValueEditor
                                    facetId={facetId}
                                    facetValueId={selectedFacetValue.id}
                                    presentation="sheet"
                                    onDirtyChange={setIsDirty}
                                    onRequestClose={returnToList}
                                    onSaved={behavior => {
                                        if (behavior === 'close') {
                                            setIsDirty(false);
                                            setSelectedFacetValue(undefined);
                                        }
                                    }}
                                />
                            </Suspense>
                        </div>
                    </>
                ) : (
                    <>
                        <SheetHeader className="border-b px-6 py-5 text-left">
                            <SheetTitle>
                                <Trans>Facet values for {facetName}</Trans>
                            </SheetTitle>
                            <SheetDescription>
                                <Trans>
                                    These are the facet values for the <strong>{facetName}</strong> facet.
                                </Trans>
                            </SheetDescription>
                        </SheetHeader>
                        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
                            <FullWidthPageBlock blockId="facet-values-sheet-table">
                                <FacetValuesTable
                                    facetId={facetId}
                                    onEditFacetValue={setSelectedFacetValue}
                                    onAddFacetValue={() => setSelectedFacetValue({ id: NEW_ENTITY_PATH })}
                                />
                            </FullWidthPageBlock>
                        </div>
                    </>
                )}
            </SheetContent>
        </Sheet>
    );
}
