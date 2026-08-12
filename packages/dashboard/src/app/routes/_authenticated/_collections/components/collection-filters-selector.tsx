import { ConfigurableOperationMultiSelector } from '@/vdb/components/shared/configurable-operation-multi-selector.js';
import { useLingui } from '@lingui/react/macro';
import { ConfigurableOperationInput as ConfigurableOperationInputType } from '@vendure/common/lib/generated-types';

import { getCollectionFiltersDocument } from '../collections.graphql.js';

export interface CollectionFiltersSelectorProps {
    value: ConfigurableOperationInputType[];
    onChange: (filters: ConfigurableOperationInputType[]) => void;
    onValidityChange?: (isValid: boolean) => void;
}

export function CollectionFiltersSelector({
    value,
    onChange,
    onValidityChange,
}: Readonly<CollectionFiltersSelectorProps>) {
    const { t } = useLingui();
    return (
        <div className="mt-4">
            <ConfigurableOperationMultiSelector
                value={value}
                onChange={onChange}
                queryDocument={getCollectionFiltersDocument}
                queryKey="getCollectionFilters"
                dataPath="collectionFilters"
                buttonText={t`Add collection filter`}
                showEnhancedDropdown={false}
                onValidityChange={onValidityChange}
            />
        </div>
    );
}
