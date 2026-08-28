import { ChannelCodeLabel } from '@/vdb/components/shared/channel-code-label.js';
import { MultiSelect } from '@/vdb/components/shared/multi-select.js';
import { Button } from '@/vdb/components/ui/button.js';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/vdb/components/ui/dialog.js';
import { Input } from '@/vdb/components/ui/input.js';
import { toast } from '@/vdb/components/ui/sonner.js';
import { DEFAULT_CHANNEL_CODE } from '@/vdb/constants.js';
import { api } from '@/vdb/graphql/api.js';
import { useChannel } from '@/vdb/hooks/use-channel.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { useMutation, useQuery } from '@tanstack/react-query';
import { LoaderCircle } from 'lucide-react';
import { useEffect, useState } from 'react';

import { allProductIdsDocument, assignProductsToChannelDocument } from '../products.graphql.js';

import {
    assignProductBatchesToChannels,
    fetchAllProductIds,
    isAssignAllProductsAvailable,
} from './assign-all-products.js';

type AssignmentProgress =
    | { phase: 'idle'; completed: 0; total: 0 }
    | { phase: 'fetching' | 'assigning'; completed: number; total: number };

export function AssignAllProductsDialog({
    open,
    onOpenChange,
    onSuccess,
}: Readonly<{
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSuccess?: () => void;
}>) {
    const { t } = useLingui();
    const { channels, activeChannel } = useChannel();
    const [selectedChannelIds, setSelectedChannelIds] = useState<string[]>([]);
    const [priceFactor, setPriceFactor] = useState(1);
    const [progress, setProgress] = useState<AssignmentProgress>({
        phase: 'idle',
        completed: 0,
        total: 0,
    });
    const availableChannels = channels.filter(channel => channel.id !== activeChannel?.id);
    const isAvailable = isAssignAllProductsAvailable(activeChannel, channels, DEFAULT_CHANNEL_CODE);

    const productCountQuery = useQuery({
        queryKey: ['all-default-channel-product-count', activeChannel?.id],
        queryFn: () => api.query(allProductIdsDocument, { options: { take: 1 } }),
        enabled: open && isAvailable,
    });
    const productCount = productCountQuery.data?.products.totalItems ?? 0;

    const assignmentMutation = useMutation({
        mutationFn: async () => {
            setProgress({ phase: 'fetching', completed: 0, total: productCount });
            const productIds = await fetchAllProductIds(
                async ({ skip, take }) => {
                    const pageResult = await api.query(allProductIdsDocument, {
                        options: { skip, take, sort: { id: 'ASC' } },
                    });
                    return pageResult.products;
                },
                ({ fetched, total }) => {
                    setProgress({ phase: 'fetching', completed: fetched, total });
                },
            );

            if (productIds.length === 0) {
                return { productCount: 0, targetCount: selectedChannelIds.length, failures: [] };
            }

            setProgress({
                phase: 'assigning',
                completed: 0,
                total: productIds.length * selectedChannelIds.length,
            });
            const assignmentResult = await assignProductBatchesToChannels({
                productIds,
                channelIds: selectedChannelIds,
                priceFactor,
                mutationFn: api.mutate(assignProductsToChannelDocument),
                onProgress: ({ completed, total }) => {
                    setProgress({ phase: 'assigning', completed, total });
                },
            });
            return {
                productCount: productIds.length,
                targetCount: selectedChannelIds.length,
                failures: assignmentResult.failures,
            };
        },
        onSuccess: result => {
            if (result.productCount === 0) {
                toast.info(t`There are no products in the default store`);
                onOpenChange(false);
                return;
            }

            if (result.failures.length === 0) {
                toast.success(
                    t`Assigned all ${result.productCount} products to ${result.targetCount} stores`,
                );
                setSelectedChannelIds([]);
                onOpenChange(false);
            } else {
                const failedChannelCodes = Array.from(
                    new Set(
                        result.failures.map(
                            failure =>
                                channels.find(channel => channel.id === failure.channelId)?.code ??
                                failure.channelId,
                        ),
                    ),
                ).join(', ');
                toast.warning(t`Some product batches could not be assigned`, {
                    description: t`Failed stores: ${failedChannelCodes}. You can run the assignment again safely.`,
                });
            }
            onSuccess?.();
        },
        onError: () => {
            toast.error(t`Failed to assign all products`);
        },
        onSettled: () => {
            setProgress({ phase: 'idle', completed: 0, total: 0 });
        },
    });

    useEffect(() => {
        if (!open && !assignmentMutation.isPending) {
            setSelectedChannelIds([]);
            setPriceFactor(1);
        }
    }, [assignmentMutation.isPending, open]);

    if (!isAvailable) {
        return null;
    }

    const handleOpenChange = (nextOpen: boolean) => {
        if (!assignmentMutation.isPending) {
            onOpenChange(nextOpen);
        }
    };
    const canAssign =
        !productCountQuery.isPending &&
        !productCountQuery.isError &&
        productCount > 0 &&
        selectedChannelIds.length > 0 &&
        !assignmentMutation.isPending;
    const progressPercent = progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0;

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent className="sm:max-w-[480px]">
                <DialogHeader>
                    <DialogTitle>
                        <Trans>Assign all products to stores</Trans>
                    </DialogTitle>
                    <DialogDescription>
                        <Trans>
                            Assign every product in the default store, including its SKUs, assets, and
                            options, to one or more other stores.
                        </Trans>
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
                        {productCountQuery.isPending && <Trans>Counting products...</Trans>}
                        {productCountQuery.isError && (
                            <span className="text-destructive">
                                <Trans>Could not load the product count</Trans>
                            </span>
                        )}
                        {productCountQuery.isSuccess && productCount === 0 && (
                            <Trans>There are no products in the default store</Trans>
                        )}
                        {productCountQuery.isSuccess && productCount > 0 && (
                            <Trans>{productCount} products will be assigned</Trans>
                        )}
                    </div>
                    <div className="grid gap-2">
                        <label className="text-sm font-medium" htmlFor="assign-all-products-channels">
                            <Trans>Target stores</Trans>
                        </label>
                        <MultiSelect
                            id="assign-all-products-channels"
                            multiple={true}
                            items={availableChannels.map(channel => ({
                                value: channel.id,
                                label: channel.code,
                                display: <ChannelCodeLabel code={channel.code} />,
                            }))}
                            value={selectedChannelIds}
                            onChange={setSelectedChannelIds}
                            placeholder={t`Select one or more channels`}
                            searchPlaceholder={t`Search channels...`}
                            showSearch
                            disabled={assignmentMutation.isPending}
                        />
                    </div>
                    <div className="grid gap-2">
                        <label className="text-sm font-medium" htmlFor="assign-all-products-price-factor">
                            <Trans>Price conversion factor</Trans>
                        </label>
                        <Input
                            id="assign-all-products-price-factor"
                            type="number"
                            min="0"
                            max="99999"
                            step="0.01"
                            value={priceFactor}
                            onChange={event => setPriceFactor(Number.parseFloat(event.target.value) || 1)}
                            disabled={assignmentMutation.isPending}
                        />
                    </div>
                    {assignmentMutation.isPending && progress.phase !== 'idle' && (
                        <div className="grid gap-2" aria-live="polite">
                            <div className="flex justify-between text-sm">
                                <span>
                                    {progress.phase === 'fetching' ? (
                                        <Trans>Loading products...</Trans>
                                    ) : (
                                        <Trans>Assigning products...</Trans>
                                    )}
                                </span>
                                <span>
                                    {progress.completed}/{progress.total}
                                </span>
                            </div>
                            <div className="h-2 overflow-hidden rounded-full bg-muted">
                                <div
                                    className="h-full bg-primary transition-[width]"
                                    style={{ width: `${progressPercent}%` }}
                                />
                            </div>
                        </div>
                    )}
                </div>
                <DialogFooter>
                    <Button
                        variant="outline"
                        onClick={() => handleOpenChange(false)}
                        disabled={assignmentMutation.isPending}
                    >
                        <Trans>Cancel</Trans>
                    </Button>
                    <Button onClick={() => assignmentMutation.mutate()} disabled={!canAssign}>
                        {assignmentMutation.isPending && <LoaderCircle className="animate-spin" />}
                        {assignmentMutation.isPending ? (
                            <Trans>Assigning...</Trans>
                        ) : (
                            <Trans>Assign all products</Trans>
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
