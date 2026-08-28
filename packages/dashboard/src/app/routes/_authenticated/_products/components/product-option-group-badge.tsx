import { ConfirmationDialog } from '@/vdb/components/shared/confirmation-dialog.js';
import { PermissionGuard } from '@/vdb/components/shared/permission-guard.js';
import { Badge } from '@/vdb/components/ui/badge.js';
import { Button } from '@/vdb/components/ui/button.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { Link } from '@tanstack/react-router';
import { ArrowUpRight, Layers3, Trash2 } from 'lucide-react';

import { useRemoveOptionGroup } from '../hooks/use-remove-option-group.js';
import { ForceRemoveOptionGroupDialog } from './force-remove-option-group-dialog.js';

interface ProductOptionGroupBadgeProps {
    id: string;
    name: string;
    options: Array<{ id: string; name: string }>;
    productId: string;
    /**
     * When provided, the badge renders a remove control that detaches the option
     * group from the product (issue #4703 — a wrongly-added option group could
     * not be removed from the product detail page). Called after a successful
     * removal so the parent can refresh.
     */
    onRemoved?: () => void;
}

export function ProductOptionGroupBadge({
    id,
    name,
    options,
    productId,
    onRemoved,
}: Readonly<ProductOptionGroupBadgeProps>) {
    const { t } = useLingui();
    const { remove, forceRemove, inUseGroupId, clearInUseGroup, isPending } = useRemoveOptionGroup(
        productId,
        { onRemoved },
    );

    return (
        <>
            <article className="rounded-lg border bg-card px-4 py-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                            <Layers3 className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                            <span className="font-semibold">{name}</span>
                            <Badge variant="outline" className="font-normal">
                                <Trans>Linked to this product</Trans>
                            </Badge>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                            {options.length > 0 ? (
                                options.map(option => (
                                    <Badge key={option.id} variant="secondary" className="font-normal">
                                        {option.name}
                                    </Badge>
                                ))
                            ) : (
                                <span className="text-sm text-muted-foreground">
                                    <Trans>No option values</Trans>
                                </span>
                            )}
                        </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            render={
                                <Link
                                    to={`/option-groups/${id}`}
                                    search={{ from: 'product', productId }}
                                    aria-label={t`Open template ${name}`}
                                />
                            }
                        >
                            <Trans>Open template</Trans>
                            <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                        </Button>
                        {onRemoved && (
                            <PermissionGuard requires={['UpdateProduct', 'UpdateCatalog']}>
                                <ConfirmationDialog
                                    title={t`Remove option group`}
                                    description={t`Are you sure you want to remove this option group from the product?`}
                                    onConfirm={() => remove(id)}
                                >
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        aria-label={t`Remove option group`}
                                        disabled={isPending}
                                        className="text-muted-foreground hover:text-destructive"
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </ConfirmationDialog>
                            </PermissionGuard>
                        )}
                    </div>
                </div>
            </article>
            <ForceRemoveOptionGroupDialog
                open={inUseGroupId === id}
                onOpenChange={open => {
                    if (!open) {
                        clearInUseGroup();
                    }
                }}
                onConfirm={forceRemove}
                isPending={isPending}
            />
        </>
    );
}
