import { desktopCatalogInput, desktopCatalogRoute } from '../../desktop-catalog-query';
import { RouteState } from '../../storefront-router';
import { useStorefront } from '../../StorefrontContext';
import { CollectionSummary, StorefrontLanguage } from '../../types';

interface DesktopCategoryNavigationContext {
    route: RouteState;
    language: StorefrontLanguage;
    collections: CollectionSummary[];
    loading: boolean;
    error: string | null;
    refetchStorefront: () => Promise<void>;
    navigate: (route: RouteState) => void;
}

export function DesktopCategoryNavigation() {
    const runtime: DesktopCategoryNavigationContext = useStorefront();
    const { route, language, collections, navigate } = runtime;
    const isZh = language === 'zh';
    const isCatalogPage = route.name === 'home' || route.name === 'category' || route.name === 'search';
    const catalogRoute: RouteState = isCatalogPage ? route : { name: 'home' };
    const input = desktopCatalogInput(catalogRoute);
    const activeCollection = isCatalogPage
        ? collections.find(collection => collection.id === route.collectionId)
        : undefined;
    const activeChild = activeCollection?.children?.find(collection => collection.id === route.childId);
    const update = (changes: Partial<RouteState>) => navigate(desktopCatalogRoute(catalogRoute, changes));
    const clearFilters = () => navigate(desktopCatalogRoute({ name: 'home' }));

    if (!isCatalogPage) return null;
    return (
        <section
            className="desktop-category-navigation"
            aria-label={isZh ? '商品分类' : 'Product categories'}
        >
            <nav
                className="desktop-local-navigation"
                aria-label={isZh ? '选择商品分类' : 'Choose a category'}
            >
                <button
                    type="button"
                    className={isCatalogPage && !input.collectionId && !input.term ? 'is-active' : undefined}
                    aria-pressed={isCatalogPage && !input.collectionId && !input.term}
                    onClick={clearFilters}
                >
                    <span>{isZh ? '全部商品' : 'All products'}</span>
                </button>
                {collections.map(collection => (
                    <div key={collection.id}>
                        <button
                            type="button"
                            className={activeCollection?.id === collection.id ? 'is-active' : undefined}
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
                            <span>{collection.name}</span>
                        </button>
                    </div>
                ))}
            </nav>
            {activeCollection?.children?.length ? (
                <nav
                    className="desktop-subcategories"
                    aria-label={isZh ? '选择子分类' : 'Choose a subcategory'}
                >
                    <button
                        type="button"
                        aria-pressed={!activeChild}
                        onClick={() => update({ childId: 'all' })}
                    >
                        {isZh ? '全部' : 'All'}
                    </button>
                    {activeCollection.children.map(child => (
                        <button
                            key={child.id}
                            type="button"
                            aria-pressed={activeChild?.id === child.id}
                            onClick={() => update({ childId: child.id })}
                        >
                            {child.name}
                        </button>
                    ))}
                </nav>
            ) : null}
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
