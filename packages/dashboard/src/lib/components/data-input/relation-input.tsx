import {
    DashboardFormComponent,
    DashboardFormComponentProps,
} from '@/vdb/framework/form-engine/form-engine-types.js';
import { graphql } from '@/vdb/graphql/graphql.js';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';

import {
    collectionRelationDepth,
    CollectionRelationItem,
    collectionRelationPath,
    compareCollectionRelationItems,
    isSelectableCollectionRelationItem,
} from './collection-relation-items.js';
import { createRelationSelectorConfig, RelationSelector } from './relation-selector.js';

function CollectionRelationLabel({ item }: Readonly<{ item: CollectionRelationItem }>) {
    const { i18n } = useLingui();
    const depth = collectionRelationDepth(item);
    const isSimplifiedChinese = i18n.locale.toLowerCase().startsWith('zh');
    const levelLabel =
        depth === 1
            ? isSimplifiedChinese
                ? // i18n-audit-ignore -- Locale-specific compact label paired with L1 below.
                  '一级'
                : 'L1'
            : depth === 2
              ? isSimplifiedChinese
                  ? // i18n-audit-ignore -- Locale-specific compact label paired with L2 below.
                    '二级'
                  : 'L2'
              : '!';

    return (
        <span className="flex min-w-0 items-center gap-2">
            <span
                className={
                    'inline-flex min-w-7 shrink-0 items-center justify-center rounded border px-1 py-0.5 ' +
                    'text-[10px] font-semibold leading-none text-muted-foreground'
                }
            >
                {/* i18n-audit-ignore -- levelLabel is selected from the active locale above. */}
                {levelLabel}
            </span>
            <span className="min-w-0 truncate">{collectionRelationPath(item)}</span>
        </span>
    );
}

/**
 * Single relation input component
 */
export interface SingleRelationInputProps<T = any> extends DashboardFormComponentProps {
    config: Parameters<typeof createRelationSelectorConfig<T>>[0];
    disabled?: boolean;
    className?: string;
    /**
     * @description
     * Custom text for the selector label,
     * defaults to `Select item` or `Select items`
     */
    selectorLabel?: React.ReactNode;
}

export function SingleRelationInput<T>({
    value,
    onChange,
    config,
    disabled,
    className,
    selectorLabel,
}: Readonly<SingleRelationInputProps<T>>) {
    const singleConfig = createRelationSelectorConfig<T>({
        ...config,
        multiple: false,
    });

    return (
        <RelationSelector
            config={singleConfig}
            value={value}
            selectorLabel={selectorLabel}
            onChange={newValue => onChange(newValue)}
            disabled={disabled}
            className={className}
        />
    );
}

/**
 * Multi relation input component
 */
export interface MultiRelationInputProps<T = any> extends DashboardFormComponentProps {
    config: Parameters<typeof createRelationSelectorConfig<T>>[0];
    disabled?: boolean;
    className?: string;
    selectorLabel?: React.ReactNode;
}

export function MultiRelationInput<T>({
    value,
    onChange,
    config,
    disabled,
    className,
    selectorLabel,
}: Readonly<MultiRelationInputProps<T>>) {
    const multiConfig = createRelationSelectorConfig<T>({
        ...config,
        multiple: true,
    });

    return (
        <RelationSelector
            config={multiConfig}
            value={value}
            onChange={newValue => onChange(newValue)}
            disabled={disabled}
            className={className}
            selectorLabel={selectorLabel}
        />
    );
}

(MultiRelationInput as DashboardFormComponent).metadata = {
    isListInput: true,
};

// Example configurations for common entities

/**
 * Product relation selector configuration
 */
export const productRelationConfig = createRelationSelectorConfig({
    listQuery: graphql(`
        query GetProductsForRelationSelector($options: ProductListOptions) {
            products(options: $options) {
                items {
                    id
                    name
                    slug
                    featuredAsset {
                        id
                        preview
                    }
                }
                totalItems
            }
        }
    `),
    idKey: 'id' as const,
    labelKey: 'name' as const,
    placeholder: msg`Search products...`,
    buildSearchFilter: (term: string) => ({
        name: { contains: term },
    }),
});

/**
 * Customer relation selector configuration
 */
export const customerRelationConfig = createRelationSelectorConfig({
    listQuery: graphql(`
        query GetCustomersForRelationSelector($options: CustomerListOptions) {
            customers(options: $options) {
                items {
                    id
                    firstName
                    lastName
                    emailAddress
                }
                totalItems
            }
        }
    `),
    idKey: 'id' as const,
    labelKey: 'emailAddress' as const,
    placeholder: msg`Search customers...`,
    buildSearchFilter: (term: string) => ({
        emailAddress: { contains: term },
    }),
});

/**
 * Collection relation selector configuration
 */
export const collectionRelationConfig = createRelationSelectorConfig<CollectionRelationItem>({
    listQuery: graphql(`
        query GetCollectionsForRelationSelector($options: CollectionListOptions) {
            collections(options: $options) {
                items {
                    id
                    name
                    slug
                    parentId
                    position
                    parent {
                        id
                        name
                        position
                    }
                    breadcrumbs {
                        id
                        name
                    }
                    featuredAsset {
                        id
                        preview
                    }
                }
                totalItems
            }
        }
    `),
    idKey: 'id' as const,
    labelKey: 'name' as const,
    pageSize: 200,
    placeholder: msg`Search collections...`,
    buildSearchFilter: (term: string) => ({
        name: { contains: term },
    }),
    sortItems: compareCollectionRelationItems,
    isItemDisabled: item => !isSelectableCollectionRelationItem(item),
    label: item => <CollectionRelationLabel item={item} />,
});
