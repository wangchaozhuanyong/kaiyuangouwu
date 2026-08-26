import { Switch } from '@/vdb/components/ui/switch.js';
import { api } from '@/vdb/graphql/api.js';
import { useLingui } from '@lingui/react/macro';
import { ResultOf } from 'gql.tada';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { updateCollectionDocument } from '../collections.graphql.js';

export interface CollectionVisibilityValue {
    id: string;
    isPrivate: boolean;
}
interface CollectionVisibilitySwitchProps {
    collection: CollectionVisibilityValue & { name: string };
    onVisibilityUpdated: (value: CollectionVisibilityValue) => void;
}

export function CollectionVisibilitySwitch({
    collection,
    onVisibilityUpdated,
}: Readonly<CollectionVisibilitySwitchProps>) {
    const { t } = useLingui();
    const [isVisible, setIsVisible] = useState(!collection.isPrivate);
    const [isUpdating, setIsUpdating] = useState(false);

    useEffect(() => {
        setIsVisible(!collection.isPrivate);
    }, [collection.isPrivate]);

    const handleVisibilityChange = async (checked: boolean) => {
        const previousValue = isVisible;
        setIsVisible(checked);
        setIsUpdating(true);

        try {
            const result = (await api.mutate(updateCollectionDocument, {
                input: { id: collection.id, isPrivate: !checked },
            })) as ResultOf<typeof updateCollectionDocument>;
            const updatedValue = {
                id: result.updateCollection.id,
                isPrivate: result.updateCollection.isPrivate,
            };

            setIsVisible(!updatedValue.isPrivate);
            onVisibilityUpdated(updatedValue);
            toast.success(
                updatedValue.isPrivate
                    ? t`Collection is now hidden from the storefront`
                    : t`Collection is now visible in the storefront`,
            );
        } catch (error) {
            setIsVisible(previousValue);
            console.error('Failed to update collection visibility:', error);
            toast.error(t`Failed to update storefront visibility`);
        } finally {
            setIsUpdating(false);
        }
    };

    return (
        <div className="flex items-center gap-2">
            <Switch
                checked={isVisible}
                disabled={isUpdating}
                onCheckedChange={handleVisibilityChange}
                aria-label={t`${collection.name} storefront visibility`}
            />
            <span className="text-xs text-muted-foreground">{isVisible ? t`Visible` : t`Hidden`}</span>
        </div>
    );
}
