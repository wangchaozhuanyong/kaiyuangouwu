import { Check, LayoutGrid } from 'lucide-react';

import allCategoriesIcon from '../../assets/icons/catalog-directory-color.webp';
import allProductsIcon from '../../assets/icons/catalog-products-color.webp';
import { catalogInputFromRoute, catalogRouteWithChanges } from '../../catalog-route-query';
import { RouteState } from '../../storefront-router';
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
    const input = catalogInputFromRoute(catalogRoute);
    const activeCollection = isCatalogPage
        ? collections.find(collection => collection.id === route.collectionId)
        : undefined;
    const update = (changes: Partial<RouteState>) => navigate(catalogRouteWithChanges(catalogRoute, changes));
    const clearFilters = () => navigate(catalogRouteWithChanges({ name: 'home' }));

    if (!isCatalogPage) return null;
    return (
        <section
            className="desktop-category-navigation"
            aria-label={isZh ? '商品分类' : 'Product categories'}
        >
            {expandChildren && (
                <strong className="desktop-category-directory-title">
                    <span className="desktop-category-icon" aria-hidden="true">
                        <img src={allCategoriesIcon} width={28} height={28} alt="" decoding="async" />
                    </span>
                    <span>{isZh ? '全部分类目录' : 'All categories'}</span>
                </strong>
            )}
            <div className="desktop-category-row">
                <nav
                    className="desktop-local-navigation"
                    aria-label={isZh ? '选择商品分类' : 'Choose a category'}
                >
                    <button
                        type="button"
                        className={
                            isCatalogPage && !input.collectionId && !input.term ? 'is-active' : undefined
                        }
                        aria-pressed={isCatalogPage && !input.collectionId && !input.term}
                        onClick={clearFilters}
                    >
                        <span className="desktop-category-icon" aria-hidden="true">
                            <img src={allProductsIcon} width={28} height={28} alt="" decoding="async" />
                        </span>
                        <span>{isZh ? '全部商品' : 'All products'}</span>
                    </button>
                    {collections.map(collection => {
                        const image = collectionImage(collection, products);
                        return (
                            <div className="desktop-category-entry" key={collection.id}>
                                <button
                                    type="button"
                                    className={
                                        activeCollection?.id === collection.id ? 'is-active' : undefined
                                    }
                                    aria-pressed={activeCollection?.id === collection.id}
                                    onClick={() =>
                                        update({
                                            name: 'category',
                                            collectionId: collection.id,
                                            childId: 'all',
                                            term: undefined,
                                        })
                                    }
                                >
                                    <span className="desktop-category-icon" aria-hidden="true">
                                        {image ? (
                                            <SafeImage
                                                src={image}
                                                alt=""
                                                imageKind="icon"
                                                sizes="28px"
                                                loading="eager"
                                            />
                                        ) : (
                                            <LayoutGrid />
                                        )}
                                    </span>
                                    <span>{collection.name}</span>
                                </button>
                                {expandChildren && activeCollection?.id === collection.id ? (
                                    <DesktopSubcategoryNavigation />
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

export function DesktopSubcategoryNavigation() {
    const runtime: DesktopCategoryNavigationContext = useStorefront();
    const { route, language, collections, navigate } = runtime;
    if (route.name !== 'category') return null;

    const activeCollection = collections.find(collection => collection.id === route.collectionId);
    if (!activeCollection?.children?.length) return null;

    const activeChild = activeCollection.children.find(collection => collection.id === route.childId);
    const update = (changes: Partial<RouteState>) => navigate(catalogRouteWithChanges(route, changes));
    const isZh = language === 'zh';

    return (
        <aside className="desktop-subcategory-sidebar" aria-label={isZh ? '子分类' : 'Subcategories'}>
            <strong>{activeCollection.name}</strong>
            <nav aria-label={isZh ? `选择${activeCollection.name}分类` : `Choose ${activeCollection.name}`}>
                <button
                    type="button"
                    title={isZh ? `全部${activeCollection.name}` : `All ${activeCollection.name}`}
                    aria-pressed={!activeChild}
                    onClick={() => update({ childId: 'all' })}
                >
                    <span>{isZh ? `全部${activeCollection.name}` : `All ${activeCollection.name}`}</span>
                    {!activeChild ? <Check aria-hidden="true" /> : null}
                </button>
                {activeCollection.children.map(child => (
                    <button
                        key={child.id}
                        type="button"
                        title={child.name}
                        aria-pressed={activeChild?.id === child.id}
                        onClick={() => update({ childId: child.id })}
                    >
                        <span>{child.name}</span>
                        {activeChild?.id === child.id ? <Check aria-hidden="true" /> : null}
                    </button>
                ))}
            </nav>
        </aside>
    );
}
