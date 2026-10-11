import { SectionHeader } from '../../storefront-ui/page-shell';
import '../../styles/search-loading.css';

/** Uses the same product-row geometry before the recommendation query resolves. */
export function SearchRecommendationSkeleton({ count = 10 }: { count?: number }) {
    return (
        <div className="search-recommendation-list search-loading-skeleton" aria-hidden="true">
            {Array.from({ length: count }, (_, index) => (
                <div className="product-row is-compact" key={index}>
                    <div className="product-row-image skeleton-block" />
                    <div className="product-row-content">
                        <div className="product-row-top">
                            <span className="skeleton-block search-loading-name" />
                            <span className="skeleton-block search-loading-meta" />
                        </div>
                        <span className="skeleton-block search-loading-price" />
                    </div>
                </div>
            ))}
        </div>
    );
}

export function EmbeddedSearchLoading({
    isZh,
    categoryCount,
    results = false,
}: {
    isZh: boolean;
    categoryCount: number;
    results?: boolean;
}) {
    return (
        <div
            className="search-page is-embedded-search search-module-loading search-loading-skeleton"
            aria-busy="true"
            data-page-pending="module"
        >
            <span className="visually-hidden" role="status">
                {isZh ? '正在加载搜索' : 'Loading search'}
            </span>
            <div className={results ? 'search-results' : 'search-discovery'}>
                {!results && (
                    <>
                        <section className="search-recent">
                            <header>
                                <h2>{isZh ? '最近搜索' : 'Recent searches'}</h2>
                            </header>
                            <div className="search-tags" aria-hidden="true">
                                <span className="skeleton-block search-loading-tag" />
                            </div>
                        </section>
                        <section className="search-browse">
                            <header>
                                <h2>{isZh ? '分类直达' : 'Browse categories'}</h2>
                                <span>{isZh ? '按商品分类浏览' : 'Explore the range'}</span>
                            </header>
                            <div className="search-category-links" aria-hidden="true">
                                {Array.from({ length: categoryCount }, (_, index) => (
                                    <div className="search-loading-category" key={index}>
                                        <span className="skeleton-block search-loading-icon" />
                                        <span className="skeleton-block search-loading-name" />
                                    </div>
                                ))}
                            </div>
                        </section>
                    </>
                )}
                <section className="product-section">
                    <SectionHeader
                        icon={false}
                        title={
                            results
                                ? isZh
                                    ? '搜索结果'
                                    : 'Search results'
                                : isZh
                                  ? '今日推荐'
                                  : "Today's picks"
                        }
                    />
                    <SearchRecommendationSkeleton />
                </section>
            </div>
        </div>
    );
}
