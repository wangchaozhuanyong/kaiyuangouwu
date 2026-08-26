import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/vdb/components/ui/sheet.js';
import { Skeleton } from '@/vdb/components/ui/skeleton.js';
import { useLingui } from '@lingui/react/macro';
import { ReactNode, Suspense, useCallback, useEffect, useRef, useState } from 'react';

export type EntityEditorSheetSize = 'form' | 'management' | 'workbench';

export interface EntityEditorSheetControls {
    setDirty: (isDirty: boolean) => void;
    requestClose: () => void;
    closeAfterSave: () => void;
}

interface EntityEditorSheetProps {
    open: boolean;
    title: ReactNode;
    description: ReactNode;
    loadingLabel: ReactNode;
    size?: EntityEditorSheetSize;
    onOpenChange: (open: boolean) => void;
    children: (controls: EntityEditorSheetControls) => ReactNode;
}

const sizeClasses: Record<EntityEditorSheetSize, string> = {
    form: 'data-[side=right]:sm:w-[640px] data-[side=right]:sm:max-w-[640px]',
    management: 'data-[side=right]:sm:w-[860px] data-[side=right]:sm:max-w-[860px]',
    workbench: 'data-[side=right]:sm:w-[88vw] data-[side=right]:sm:max-w-[1440px]',
};

export function EntityEditorSheet({
    open,
    title,
    description,
    loadingLabel,
    size = 'form',
    onOpenChange,
    children,
}: Readonly<EntityEditorSheetProps>) {
    const { t } = useLingui();
    const [isDirty, setIsDirty] = useState(false);
    const contentRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;

        let observer: MutationObserver | undefined;
        const focusFirstField = () => {
            const field = contentRef.current?.querySelector<HTMLElement>(
                '[data-editor-autofocus], input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), select:not([disabled]), [role="combobox"]:not([aria-disabled="true"]), [contenteditable="true"]',
            );
            if (!field) return false;
            field.focus();
            observer?.disconnect();
            return true;
        };

        const frame = window.requestAnimationFrame(() => {
            if (!focusFirstField() && contentRef.current) {
                observer = new MutationObserver(focusFirstField);
                observer.observe(contentRef.current, { childList: true, subtree: true });
            }
        });

        return () => {
            window.cancelAnimationFrame(frame);
            observer?.disconnect();
        };
    }, [open]);

    const requestOpenChange = useCallback(
        (nextOpen: boolean) => {
            if (!nextOpen && isDirty && !window.confirm(t`Discard unsaved changes?`)) {
                return;
            }
            if (!nextOpen) {
                setIsDirty(false);
            }
            onOpenChange(nextOpen);
        },
        [isDirty, onOpenChange, t],
    );

    const closeAfterSave = useCallback(() => {
        setIsDirty(false);
        onOpenChange(false);
    }, [onOpenChange]);

    return (
        <Sheet open={open} onOpenChange={requestOpenChange}>
            <SheetContent
                ref={contentRef}
                side="right"
                showCloseButton={false}
                initialFocus={() => contentRef.current}
                tabIndex={-1}
                className={`flex gap-0 overflow-hidden p-0 data-[side=right]:w-full data-[side=right]:max-w-none ${sizeClasses[size]}`}
            >
                <SheetHeader className="sr-only">
                    <SheetTitle>{title}</SheetTitle>
                    <SheetDescription>{description}</SheetDescription>
                </SheetHeader>
                <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
                    {open ? (
                        <Suspense
                            fallback={
                                <div
                                    className="space-y-5 p-6"
                                    role="status"
                                    aria-live="polite"
                                    aria-label={typeof loadingLabel === 'string' ? loadingLabel : undefined}
                                >
                                    <span className="sr-only">{loadingLabel}</span>
                                    <div className="space-y-2">
                                        <Skeleton className="h-7 w-2/5" />
                                        <Skeleton className="h-4 w-3/5" />
                                    </div>
                                    <Skeleton className="h-24 w-full" />
                                    <div className="grid gap-4 sm:grid-cols-2">
                                        <Skeleton className="h-16 w-full" />
                                        <Skeleton className="h-16 w-full" />
                                        <Skeleton className="h-16 w-full" />
                                        <Skeleton className="h-16 w-full" />
                                    </div>
                                </div>
                            }
                        >
                            {children({
                                setDirty: setIsDirty,
                                requestClose: () => requestOpenChange(false),
                                closeAfterSave,
                            })}
                        </Suspense>
                    ) : null}
                </div>
            </SheetContent>
        </Sheet>
    );
}
