// organize-imports-ignore -- Preserve the repository type import grouping.
import type { CollectionSummary, FulfillmentType, StorefrontLanguage } from '../../types';
import { lazy, Suspense, useState } from 'react';

import { PageSkeleton } from '../../route-loading';
import { InlineError, Sheet } from '../../storefront-ui/page-shell';
import { StorefrontErrorBoundary } from '../../StorefrontErrorBoundary';

export interface CatalogFilterValues {
    collectionId?: string;
    fulfillment: 'all' | FulfillmentType;
    inStockOnly: boolean;
    minPrice: string;
    maxPrice: string;
}

export type CatalogFilterSheetProps = {
    language: StorefrontLanguage;
    currencyCode: string;
    value: CatalogFilterValues;
    resultCount: number | null;
    onChange: (value: CatalogFilterValues) => void;
    onApply: (value: CatalogFilterValues) => void;
    onClose: () => void;
    collections?: CollectionSummary[];
    className?: string;
};

export function categoryFilterActionLabel(language: StorefrontLanguage, resultCount: number | null): string {
    if (resultCount === null) return language === 'zh' ? '应用筛选' : 'Apply filters';
    if (language === 'zh') return `查看 ${resultCount} 件商品`;
    return `View ${resultCount} ${resultCount === 1 ? 'product' : 'products'}`;
}

const loadContent = () =>
    import('./catalog-filter-content').then(module => ({ default: module.CatalogFilterContent }));

/** The closable shell is immediate; closed filters do not join catalog startup. */
export function CatalogFilterSheet(props: CatalogFilterSheetProps) {
    const [attempt, setAttempt] = useState(() => ({ id: 0, Content: lazy(loadContent) }));
    const retry = () => setAttempt(current => ({ id: current.id + 1, Content: lazy(loadContent) }));
    const Content = attempt.Content;
    const isZh = props.language === 'zh';
    return (
        <Sheet
            title={isZh ? '筛选' : 'Filter'}
            language={props.language}
            onClose={props.onClose}
            className={props.className}
        >
            <StorefrontErrorBoundary
                key={attempt.id}
                fallback={
                    <InlineError
                        message={isZh ? '筛选暂时无法加载' : 'Filters could not be loaded'}
                        action={isZh ? '重新尝试' : 'Try again'}
                        onAction={retry}
                    />
                }
            >
                <Suspense fallback={<PageSkeleton compact language={props.language} onRetry={retry} />}>
                    <Content {...props} />
                </Suspense>
            </StorefrontErrorBoundary>
        </Sheet>
    );
}
