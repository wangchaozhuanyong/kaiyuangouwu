import { ChevronRight, LayoutGrid } from 'lucide-react';

import { catalogRouteWithChanges } from '../../catalog-route-query';
import { interceptContentNavigation } from '../../content-target-href';
import { routeHref, RouteState } from '../../storefront-router';
import { collectionImage, SafeImage } from '../../storefront-ui/product-display';
import { useStorefront } from '../../StorefrontContext';
import { CollectionSummary, Product, StorefrontLanguage } from '../../types';

interface DesktopCategoryNavigationContext {
    route: RouteState;
    language: StorefrontLanguage;
    collections: CollectionSummary[];
    products: Product[];
    loading: boolean;
    error: string | null;
    refetchStorefront: () => Promise<void>;
    navigate: (route: RouteState) => void;
}

export function DesktopCategoryNavigation({ expandChildren = false }: { expandChildren?: boolean } = {}) {
    const runtime: DesktopCategoryNavigationContext = useStorefront();
    const { route, language, collections, navigate } = runtime;
    const products = runtime.products ?? [];
    const isZh = language === 'zh';
    const isCatalogPage = route.name === 'home' || route.name === 'category' || route.name === 'search';
    const catalogRoute: RouteState = isCatalogPage ? route : { name: 'home' };
    const activeCollection = isCatalogPage
        ? collections.find(collection => collection.id === route.collectionId)
        : undefined;
    const update = (changes: Partial<RouteState>) => navigate(catalogRouteWithChanges(catalogRoute, changes));

    if (!isCatalogPage) return null;
    return (
        <section
            className="desktop-category-navigation"
            aria-label={isZh ? '商品分类' : 'Product categories'}
        >
            {expandChildren && (
                <strong className="desktop-category-directory-title">
                    <span className="desktop-category-icon" aria-hidden="true">
                        <LayoutGrid strokeWidth={1.7} />
                    </span>
                    <span>{isZh ? '全部分类目录' : 'All categories'}</span>
                </strong>
            )}
            <div className="desktop-category-row">
                <nav
                    className="desktop-local-navigation"
                    aria-label={isZh ? '选择商品分类' : 'Choose a category'}
                >
                    {collections.map(collection => {
                        const image = collectionImage(collection, products);
                        const isExpanded =
                            expandChildren &&
                            activeCollection?.id === collection.id &&
                            Boolean(collection.children?.length);
                        return (
                            <div
                                className={`desktop-category-entry${isExpanded ? ' is-expanded' : ''}`}
                                key={collection.id}
                            >
                                <a
                                    href={routeHref({
                                        name: 'category',
                                        collectionId: collection.id,
                                        publicLanguage: language,
                                    })}
                                    className={
                                        activeCollection?.id === collection.id ? 'is-active' : undefined
                                    }
                                    aria-current={activeCollection?.id === collection.id ? 'page' : undefined}
                                    aria-expanded={
                                        expandChildren && collection.children?.length ? isExpanded : undefined
                                    }
                                    onClick={event =>
                                        interceptContentNavigation(event, () =>
                                            update({
                                                name: 'category',
                                                collectionId: collection.id,
                                                childId: 'all',
                                                term: undefined,
                                            }),
                                        )
                                    }
                                >
                                    <span className="desktop-category-icon" aria-hidden="true">
                                        {image ? (
                                            <SafeImage
                                                src={image}
                                                alt=""
                                                imageKind="icon"
                                                sizes="32px"
                                                loading="eager"
                                                errorFallback={<LayoutGrid aria-hidden="true" />}
                                            />
                                        ) : (
                                            <LayoutGrid />
                                        )}
                                    </span>
                                    <span className="desktop-category-name">{collection.name}</span>
                                    {expandChildren && Boolean(collection.children?.length) ? (
                                        <ChevronRight
                                            className="desktop-category-chevron"
                                            aria-hidden="true"
                                        />
                                    ) : null}
                                </a>
                                {expandChildren && Boolean(collection.children?.length) ? (
                                    <div
                                        className="desktop-category-children"
                                        inert={!isExpanded}
                                        aria-hidden={!isExpanded}
                                    >
                                        <div className="desktop-category-children-clip">
                                            <DesktopSubcategoryNavigation collection={collection} />
                                        </div>
                                    </div>
                                ) : null}
                            </div>
                        );
                    })}
                </nav>
            </div>
            {runtime.loading && !collections.length ? (
                <p className="desktop-category-status" role="status">
                    {isZh ? '正在加载分类…' : 'Loading categories…'}
                </p>
            ) : null}
            {runtime.error ? (
                <button
                    type="button"
                    className="desktop-category-retry"
                    onClick={() => void runtime.refetchStorefront()}
                >
                    {isZh ? '重新加载分类' : 'Reload categories'}
                </button>
            ) : null}
        </section>
    );
}

export function DesktopSubcategoryNavigation({ collection }: { collection?: CollectionSummary } = {}) {
    const runtime: DesktopCategoryNavigationContext = useStorefront();
    const { route, language, collections, navigate } = runtime;
    if (route.name !== 'category') return null;

    const displayedCollection = collection ?? collections.find(item => item.id === route.collectionId);
    if (!displayedCollection?.children?.length) return null;

    const activeChild =
        displayedCollection.id === route.collectionId
            ? displayedCollection.children.find(child => child.id === route.childId)
            : undefined;
    const update = (changes: Partial<RouteState>) => navigate(catalogRouteWithChanges(route, changes));
    const isZh = language === 'zh';

    return (
        <aside className="desktop-subcategory-sidebar" aria-label={isZh ? '子分类' : 'Subcategories'}>
            <strong>{displayedCollection.name}</strong>
            <nav
                aria-label={
                    isZh ? `选择${displayedCollection.name}分类` : `Choose ${displayedCollection.name}`
                }
            >
                {displayedCollection.children.map(child => (
                    <a
                        key={child.id}
                        href={routeHref({
                            name: 'category',
                            collectionId: displayedCollection.id,
                            childId: child.id,
                            publicLanguage: language,
                        })}
                        title={child.name}
                        aria-current={activeChild?.id === child.id ? 'page' : undefined}
                        onClick={event =>
                            interceptContentNavigation(event, () => update({ childId: child.id }))
                        }
                    >
                        <span className="desktop-subcategory-name">{child.name}</span>
                    </a>
                ))}
            </nav>
        </aside>
    );
}
