import { collectionRelationConfig } from '@/vdb/components/data-input/relation-input.js';
import { RelationSelector } from '@/vdb/components/data-input/relation-selector.js';
import { Button } from '@/vdb/components/ui/button.js';
import { api } from '@/vdb/graphql/api.js';
import { useJobQueuePolling } from '@/vdb/hooks/use-job-queue-polling.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { Link } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import {
    productCollectionAssignmentDetailDocument,
    updateProductCollectionAssignmentDocument,
} from '../products.graphql.js';
import {
    hasDirectProductAssignment,
    setDirectProductAssignment,
    type CollectionFilterValue,
} from './product-collection-assignment.js';

interface ProductCollection {
    id: string;
    name: string;
    slug: string;
    filters: CollectionFilterValue[];
}

interface ProductCollectionsPanelProps {
    productId: string;
    collections: ProductCollection[];
    onMembershipRefresh: () => void;
}

type AssignmentChange = {
    collectionId: string;
    assigned: boolean;
};

const directCollectionRelationConfig = {
    ...collectionRelationConfig,
    multiple: true,
};

export function ProductCollectionsPanel({
    productId,
    collections,
    onMembershipRefresh,
}: Readonly<ProductCollectionsPanelProps>) {
    const { t } = useLingui();
    const [isUpdating, setIsUpdating] = useState(false);
    const [directCollectionIds, setDirectCollectionIds] = useState(() =>
        collections
            .filter(collection => hasDirectProductAssignment(collection.filters, productId))
            .map(collection => collection.id),
    );
    const { isPolling, startPolling } = useJobQueuePolling('apply-collection-filters', () => {
        onMembershipRefresh();
    });

    const serverDirectCollectionIds = useMemo(
        () =>
            new Set(
                collections
                    .filter(collection => hasDirectProductAssignment(collection.filters, productId))
                    .map(collection => collection.id),
            ),
        [collections, productId],
    );
    const directCollectionIdSet = useMemo(() => new Set(directCollectionIds), [directCollectionIds]);
    const automaticallyMatchedCollections = collections.filter(
        collection =>
            !serverDirectCollectionIds.has(collection.id) && !directCollectionIdSet.has(collection.id),
    );

    const updateAssignment = async ({ collectionId, assigned }: AssignmentChange) => {
        const result = await api.query(productCollectionAssignmentDetailDocument, { id: collectionId });
        if (!result.collection) {
            throw new Error(t`Product group not found`);
        }

        await api.mutate(updateProductCollectionAssignmentDocument, {
            input: {
                id: collectionId,
                filters: setDirectProductAssignment(result.collection.filters, productId, assigned),
            },
        });
    };

    const handleAssignmentsChange = async (value: string | string[] | null | undefined) => {
        const nextCollectionIds = Array.isArray(value) ? value : value ? [value] : [];
        const previousCollectionIds = directCollectionIds;
        const previousIdSet = new Set(previousCollectionIds);
        const nextIdSet = new Set(nextCollectionIds);
        const changes: AssignmentChange[] = [
            ...nextCollectionIds
                .filter(collectionId => !previousIdSet.has(collectionId))
                .map(collectionId => ({ collectionId, assigned: true })),
            ...previousCollectionIds
                .filter(collectionId => !nextIdSet.has(collectionId))
                .map(collectionId => ({ collectionId, assigned: false })),
        ];

        if (changes.length === 0) {
            return;
        }

        setDirectCollectionIds(nextCollectionIds);
        setIsUpdating(true);
        const results = await Promise.allSettled(changes.map(updateAssignment));
        const savedCollectionIds = new Set(previousCollectionIds);
        let failedCount = 0;

        results.forEach((result, index) => {
            const change = changes[index];
            if (!change) {
                return;
            }
            if (result.status === 'fulfilled') {
                if (change.assigned) {
                    savedCollectionIds.add(change.collectionId);
                } else {
                    savedCollectionIds.delete(change.collectionId);
                }
            } else {
                failedCount += 1;
            }
        });

        setDirectCollectionIds([...savedCollectionIds]);
        setIsUpdating(false);

        if (results.some(result => result.status === 'fulfilled')) {
            startPolling();
        }
        if (failedCount > 0) {
            toast.error(t`Failed to update product groups`, {
                description: t`${failedCount} product group changes could not be saved.`,
            });
        } else {
            toast.success(t`Product groups updated`, {
                description: t`The storefront membership is being refreshed.`,
            });
        }
    };

    return (
        <div className="space-y-4">
            <div className="space-y-2">
                <div>
                    <p className="text-sm font-medium">
                        <Trans>Directly assigned</Trans>
                    </p>
                    <p className="text-xs text-muted-foreground">
                        <Trans>Choose product groups here. Changes are saved immediately.</Trans>
                    </p>
                </div>
                <RelationSelector
                    config={directCollectionRelationConfig}
                    value={directCollectionIds}
                    onChange={value => void handleAssignmentsChange(value)}
                    disabled={isUpdating}
                    selectorLabel={<Trans>Add product group</Trans>}
                />
                {(isUpdating || isPolling) && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                        {isUpdating ? (
                            <Trans>Saving product groups...</Trans>
                        ) : (
                            <Trans>Refreshing matches...</Trans>
                        )}
                    </div>
                )}
            </div>

            {automaticallyMatchedCollections.length > 0 && (
                <div className="space-y-2 border-t pt-3">
                    <p className="text-xs font-medium text-muted-foreground">
                        <Trans>Matched by automatic rules</Trans>
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                        {automaticallyMatchedCollections.map(collection => (
                            <Button
                                key={collection.id}
                                render={<Link to={`/collections/${collection.id}`} />}
                                variant="outline"
                                size="sm"
                            >
                                {collection.name}
                            </Button>
                        ))}
                    </div>
                </div>
            )}

            <Button render={<Link to="/collections" />} variant="ghost" size="sm">
                <Trans>Manage product groups</Trans>
            </Button>
        </div>
    );
}
