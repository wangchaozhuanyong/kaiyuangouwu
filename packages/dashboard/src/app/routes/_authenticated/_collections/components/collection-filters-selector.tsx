import { ConfigurableOperationMultiSelector } from '@/vdb/components/shared/configurable-operation-multi-selector.js';
import { cn } from '@/vdb/lib/utils.js';
import { useLingui } from '@lingui/react/macro';
import { ConfigurableOperationInput as ConfigurableOperationInputType } from '@vendure/common/lib/generated-types';
import { ListChecks, ListFilter } from 'lucide-react';
import { useState } from 'react';

import { getCollectionFiltersDocument } from '../collections.graphql.js';

export interface CollectionFiltersSelectorProps {
    value: ConfigurableOperationInputType[];
    onChange: (filters: ConfigurableOperationInputType[]) => void;
    onValidityChange?: (isValid: boolean) => void;
}

const manualFilterCodes = new Set(['product-id-filter', 'variant-id-filter']);

type AssignmentMode = 'manual' | 'automatic';

export function CollectionFiltersSelector({
    value,
    onChange,
    onValidityChange,
}: Readonly<CollectionFiltersSelectorProps>) {
    const { t } = useLingui();
    const [assignmentMode, setAssignmentMode] = useState<AssignmentMode>(() =>
        value.some(filter => manualFilterCodes.has(filter.code)) &&
        !value.some(filter => !manualFilterCodes.has(filter.code))
            ? 'manual'
            : 'automatic',
    );

    return (
        <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label={t`Product assignment`}>
                <button
                    type="button"
                    role="radio"
                    aria-checked={assignmentMode === 'manual'}
                    className={cn(
                        'flex items-start gap-3 rounded-md border p-4 text-left transition-colors',
                        assignmentMode === 'manual'
                            ? 'border-primary bg-primary/5'
                            : 'border-border hover:bg-muted/40',
                    )}
                    onClick={() => setAssignmentMode('manual')}
                >
                    <ListChecks className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
                    <span>
                        <span className="block text-sm font-medium">{t`Select products manually`}</span>
                        <span className="mt-1 block text-xs text-muted-foreground">
                            {t`Search the product catalog and choose the products for this category.`}
                        </span>
                    </span>
                </button>
                <button
                    type="button"
                    role="radio"
                    aria-checked={assignmentMode === 'automatic'}
                    className={cn(
                        'flex items-start gap-3 rounded-md border p-4 text-left transition-colors',
                        assignmentMode === 'automatic'
                            ? 'border-primary bg-primary/5'
                            : 'border-border hover:bg-muted/40',
                    )}
                    onClick={() => setAssignmentMode('automatic')}
                >
                    <ListFilter className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
                    <span>
                        <span className="block text-sm font-medium">{t`Assign automatically by conditions`}</span>
                        <span className="mt-1 block text-xs text-muted-foreground">
                            {t`Products matching the configured conditions are added automatically.`}
                        </span>
                    </span>
                </button>
            </div>
            <ConfigurableOperationMultiSelector
                value={value}
                onChange={onChange}
                queryDocument={getCollectionFiltersDocument}
                queryKey="getCollectionFilters"
                dataPath="collectionFilters"
                buttonText={assignmentMode === 'manual' ? t`Choose products` : t`Add automatic condition`}
                showEnhancedDropdown={false}
                onValidityChange={onValidityChange}
                operationFilter={operation =>
                    assignmentMode === 'manual'
                        ? manualFilterCodes.has(operation.code)
                        : !manualFilterCodes.has(operation.code)
                }
            />
        </div>
    );
}
