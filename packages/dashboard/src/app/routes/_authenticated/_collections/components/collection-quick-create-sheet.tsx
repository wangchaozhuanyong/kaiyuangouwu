import { EntityAssets, type EntityAssetValue } from '@/vdb/components/shared/entity-assets.js';
import { Button } from '@/vdb/components/ui/button.js';
import { Input } from '@/vdb/components/ui/input.js';
import { Label } from '@/vdb/components/ui/label.js';
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetFooter,
    SheetHeader,
    SheetTitle,
} from '@/vdb/components/ui/sheet.js';
import { Switch } from '@/vdb/components/ui/switch.js';
import { api } from '@/vdb/graphql/api.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { FormEvent, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { createCollectionDocument } from '../collections.graphql.js';
import { buildCollectionQuickCreateInput } from './collection-quick-create-input.js';

export interface CollectionQuickCreateParent {
    id: string;
    name: string;
}

interface CollectionQuickCreateSheetProps {
    open: boolean;
    parent?: CollectionQuickCreateParent;
    onOpenChange: (open: boolean) => void;
    onCreated: (parentId?: string) => void;
}

const MAX_NAME_LENGTH = 30;

export function CollectionQuickCreateSheet({
    open,
    parent,
    onOpenChange,
    onCreated,
}: Readonly<CollectionQuickCreateSheetProps>) {
    const { t } = useLingui();
    const queryClient = useQueryClient();
    const [name, setName] = useState('');
    const [isVisible, setIsVisible] = useState(true);
    const [assets, setAssets] = useState<EntityAssetValue>({});
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [formSession, setFormSession] = useState(0);

    useEffect(() => {
        if (!open) {
            setName('');
            setIsVisible(true);
            setAssets({});
            setFormSession(current => current + 1);
        }
    }, [open]);

    const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const trimmedName = name.trim();
        if (!trimmedName) {
            toast.error(t`Enter a collection name`);
            return;
        }

        setIsSubmitting(true);
        try {
            await api.mutate(createCollectionDocument, {
                input: buildCollectionQuickCreateInput({
                    name: trimmedName,
                    parentId: parent?.id,
                    isVisible,
                    assetIds: assets.assetIds ?? [],
                    featuredAssetId: assets.featuredAssetId,
                }),
            });

            queryClient.removeQueries({ queryKey: ['childCollections'] });
            queryClient.removeQueries({ queryKey: ['collection-tree'] });
            queryClient.removeQueries({ queryKey: ['collection-tree-children'] });
            await queryClient.invalidateQueries({ queryKey: ['PaginatedListDataTable'] });
            toast.success(parent ? t`Second-level collection created` : t`Top-level collection created`);
            onCreated(parent?.id);
            onOpenChange(false);
        } catch (error) {
            console.error('Failed to create collection:', error);
            toast.error(t`Failed to create collection. Check for a duplicate name and try again.`);
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
            <SheetContent
                side="right"
                data-collection-quick-create
                className="flex flex-col gap-0 p-0 data-[side=right]:w-[min(380px,100vw)] data-[side=right]:sm:max-w-[380px]"
            >
                <form className="flex min-h-0 flex-1 flex-col" onSubmit={handleSubmit}>
                    <SheetHeader className="border-b px-6 py-5 text-left">
                        <SheetTitle className="text-lg font-semibold">
                            {parent ? t`Add second-level collection` : t`Add top-level collection`}
                        </SheetTitle>
                        <SheetDescription className="sr-only">
                            {parent ? t`Add a second-level product group` : t`Add a top-level product group`}
                        </SheetDescription>
                    </SheetHeader>

                    <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-5">
                        <div className="space-y-3 rounded-md border bg-muted/25 p-4 text-sm">
                            <div className="grid grid-cols-[72px_1fr] gap-3">
                                <span className="text-muted-foreground">
                                    <Trans>Current level</Trans>
                                </span>
                                <span className="font-medium">
                                    {parent ? t`Second-level collection` : t`Top-level collection`}
                                </span>
                            </div>
                            <div className="grid grid-cols-[72px_1fr] gap-3">
                                <span className="text-muted-foreground">
                                    <Trans>Parent collection</Trans>
                                </span>
                                <span className="font-medium">{parent?.name ?? t`None`}</span>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <div className="flex items-center justify-between gap-3">
                                <Label htmlFor="quick-collection-name" className="text-base">
                                    <Trans>Collection name</Trans> <span className="text-destructive">*</span>
                                </Label>
                                <span className="text-xs text-muted-foreground">
                                    {name.length}/{MAX_NAME_LENGTH}
                                </span>
                            </div>
                            <Input
                                id="quick-collection-name"
                                value={name}
                                maxLength={MAX_NAME_LENGTH}
                                autoFocus
                                placeholder={t`Enter a collection name`}
                                className="h-10"
                                onChange={event => setName(event.target.value)}
                            />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="quick-collection-parent" className="text-base">
                                <Trans>Parent collection</Trans>
                            </Label>
                            <Input
                                id="quick-collection-parent"
                                value={parent?.name ?? t`No parent collection (top level)`}
                                readOnly
                                aria-readonly="true"
                                className="h-10 bg-muted/35"
                            />
                        </div>

                        <div className="space-y-3">
                            <Label htmlFor="quick-collection-visible" className="text-base">
                                <Trans>Storefront visibility</Trans>
                            </Label>
                            <div className="flex items-center gap-2">
                                <Switch
                                    id="quick-collection-visible"
                                    checked={isVisible}
                                    onCheckedChange={setIsVisible}
                                    aria-label={t`Storefront visibility`}
                                />
                                <span className="text-sm text-muted-foreground">
                                    {isVisible ? t`Visible` : t`Hidden`}
                                </span>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label className="text-base">
                                <Trans>Collection image</Trans>
                            </Label>
                            <div className="[&_[data-testid=entity-assets-featured]]:h-32">
                                <EntityAssets
                                    key={formSession}
                                    compact
                                    multiSelect={false}
                                    imageGuidance="productGroup"
                                    onChange={setAssets}
                                />
                            </div>
                            <p className="text-xs text-muted-foreground">
                                <Trans>
                                    Upload a square 1:1 image for the collection entry in the storefront.
                                </Trans>
                            </p>
                        </div>
                    </div>

                    <SheetFooter className="grid grid-cols-2 border-t px-6 py-4">
                        <Button
                            type="button"
                            variant="outline"
                            className="h-11 text-base"
                            disabled={isSubmitting}
                            onClick={() => onOpenChange(false)}
                        >
                            <Trans>Cancel</Trans>
                        </Button>
                        <Button
                            type="submit"
                            className="h-11 text-base"
                            disabled={isSubmitting || !name.trim()}
                        >
                            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                            {isSubmitting ? t`Creating...` : t`Create collection`}
                        </Button>
                    </SheetFooter>
                </form>
            </SheetContent>
        </Sheet>
    );
}
