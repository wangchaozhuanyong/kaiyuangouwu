import { ArrowRight, ChevronLeft, ChevronRight, Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';

import { productAvailability } from '../../product-availability';
import { minimumProductPrice, SafeImage } from '../../storefront-ui/product-display';
import {
    CollectionSummary,
    MarketConfig,
    Product,
    StorefrontContentBlock,
    StorefrontContentTargetType,
    StorefrontLanguage,
} from '../../types';
import { resolveBottomNavigationItems } from '../common/bottom-navigation';
import { ProductCard } from '../common/product-card';

type SortType = 'recommended' | 'price-asc' | 'newest';

export interface DesktopUnifiedHomeProps {
    products: Product[];
    loading: boolean;
    collections: CollectionSummary[];
    contentBlocks: StorefrontContentBlock[];
    language: StorefrontLanguage;
    storefrontName: string;
    storefrontDescription: string;
    storefrontTagline: string;
    market: MarketConfig;
    locale: string;
    onProductSelect: (productId: string) => void;
    onCollectionSelect: (collectionId: string) => void;
    onContentTarget: (targetType: StorefrontContentTargetType, targetValue: string | null) => void;
}

export function DesktopUnifiedHome({
    products,
    loading,
    collections,
    contentBlocks,
    language,
    storefrontName,
    storefrontDescription,
    storefrontTagline,
    market,
    locale,
    onProductSelect,
    onCollectionSelect,
    onContentTarget,
}: DesktopUnifiedHomeProps) {
    const isZh = language === 'zh';
    const [collectionId, setCollectionId] = useState('all');
    const [sort, setSort] = useState<SortType>('recommended');
    const [inStockOnly, setInStockOnly] = useState(false);
    const [toolPage, setToolPage] = useState(0);
    const hero = contentBlocks.find(block => block.type === 'HERO' && block.enabled);
    const quickLinks = contentBlocks
        .find(block => block.type === 'QUICK_LINKS' && block.enabled)
        ?.items.filter(item => item.enabled && item.label.trim() && item.targetType !== 'NONE');
    const navigationLinks = resolveBottomNavigationItems(
        contentBlocks.find(block => block.type === 'NAVIGATION' && block.enabled),
        language,
    ).filter(item => item.routeName === 'category' || item.routeName === 'services');
    const tools = quickLinks?.length
        ? quickLinks
        : [
              ...navigationLinks.map(item => ({
                  id: item.key,
                  label: item.label,
                  description:
                      item.routeName === 'category'
                          ? isZh
                              ? '浏览店铺当前开放的商品分类'
                              : 'Browse available product categories'
                          : isZh
                            ? '查看店铺提供的工具与服务'
                            : 'Explore tools and services',
                  imageUrl: item.iconUrl,
                  targetType: item.routeName === 'category' ? ('CATEGORY' as const) : ('PAGE' as const),
                  targetValue: item.routeName === 'category' ? null : 'services',
              })),
              {
                  id: 'storefront-support',
                  label: isZh ? '帮助中心' : 'Help center',
                  description: isZh ? '订单与服务遇到问题，查看帮助' : 'Find help with orders and services',
                  imageUrl: null,
                  targetType: 'SUPPORT' as const,
                  targetValue: null,
              },
          ];
    const toolPages = Array.from({ length: Math.ceil(tools.length / 3) }, (_, index) =>
        tools.slice(index * 3, index * 3 + 3),
    );
    const activeToolPage = Math.min(toolPage, Math.max(0, toolPages.length - 1));
    const moveToolPage = (direction: -1 | 1) => {
        if (toolPages.length < 2) return;
        setToolPage((activeToolPage + direction + toolPages.length) % toolPages.length);
    };
    const heroTitle = hero?.title?.trim() || storefrontTagline.trim() || storefrontName;
    const heroEyebrow = hero?.subtitle?.trim() || storefrontName;
    const heroDescription =
        hero?.body?.trim() ||
        storefrontDescription.trim() ||
        (isZh ? '发现店铺精选商品与服务。' : 'Discover selected products and services.');
    const heroHasTarget = Boolean(
        hero &&
        hero.targetType !== 'NONE' &&
        (hero.targetValue || ['CATEGORY', 'SUPPORT', 'COUPON'].includes(hero.targetType)),
    );

    const visibleProducts = useMemo(() => {
        let result = products.filter(product => {
            const inCollection =
                collectionId === 'all' ||
                product.collections.some(
                    collection =>
                        collection.id === collectionId ||
                        collection.breadcrumbs?.some(crumb => crumb.id === collectionId),
                );
            const inStock = product.variants.some(variant => !productAvailability(variant).soldOut);
            return inCollection && (!inStockOnly || inStock);
        });
        if (sort === 'price-asc') {
            result = [...result].sort(
                (left, right) => minimumProductPrice(left) - minimumProductPrice(right),
            );
        }
        if (sort === 'newest') {
            result = [...result].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
        }
        return result;
    }, [collectionId, inStockOnly, products, sort]);

    const selectCollection = (id: string) => {
        setCollectionId(id);
    };

    return (
        <section className="proto-home-container" aria-label={isZh ? '店铺首页' : 'Store home'}>
            <div className="proto-hero-section">
                <div className="proto-hero-grid">
                    <article className={`proto-hero-featured${hero?.imageUrl ? ' has-media' : ''}`}>
                        <div className="proto-featured-content">
                            <span className="proto-flagship-badge">
                                <Sparkles aria-hidden="true" size={13} />
                                {heroEyebrow}
                            </span>
                            <h1 className="proto-flagship-title">{heroTitle}</h1>
                            <p className="proto-flagship-desc">{heroDescription}</p>
                        </div>
                        <div className="proto-flagship-actions">
                            <button
                                type="button"
                                className="proto-btn-upgrade"
                                onClick={() =>
                                    heroHasTarget && hero
                                        ? onContentTarget(hero.targetType, hero.targetValue)
                                        : onContentTarget('CATEGORY', null)
                                }
                            >
                                {(heroHasTarget && hero?.ctaLabel?.trim()) ||
                                    (isZh ? '浏览商品' : 'Browse products')}
                            </button>
                            {heroHasTarget && (
                                <button
                                    type="button"
                                    className="proto-btn-secondary"
                                    onClick={() => onContentTarget('CATEGORY', null)}
                                >
                                    {isZh ? '查看全部商品' : 'Explore all products'}
                                    <ArrowRight aria-hidden="true" />
                                </button>
                            )}
                        </div>
                        {hero?.imageUrl && (
                            <SafeImage
                                frameClassName="proto-featured-media-frame"
                                className="proto-featured-media"
                                src={hero.imageUrl}
                                alt=""
                                imageKind="hero"
                                fetchPriority="high"
                            />
                        )}
                    </article>

                    {tools.length > 0 && (
                        <aside className="proto-hero-tools" aria-label={isZh ? '快捷入口' : 'Shortcuts'}>
                            <div className="proto-tools-header">
                                <span className="proto-tools-title">
                                    <span className="proto-tools-title-mark" aria-hidden="true">
                                        <Sparkles />
                                    </span>
                                    <span>{isZh ? '快捷入口' : 'Quick access'}</span>
                                </span>
                                {toolPages.length > 1 ? (
                                    <div className="proto-tools-pagination">
                                        <button
                                            type="button"
                                            aria-label={isZh ? '上一组快捷入口' : 'Previous shortcuts'}
                                            onClick={() => moveToolPage(-1)}
                                        >
                                            <ChevronLeft aria-hidden="true" />
                                        </button>
                                        <span className="proto-tools-page-status" aria-live="polite">
                                            {activeToolPage + 1} / {toolPages.length}
                                        </span>
                                        <button
                                            type="button"
                                            aria-label={isZh ? '下一组快捷入口' : 'Next shortcuts'}
                                            onClick={() => moveToolPage(1)}
                                        >
                                            <ChevronRight aria-hidden="true" />
                                        </button>
                                    </div>
                                ) : null}
                            </div>
                            {toolPages[activeToolPage] ? (
                                <div className="proto-tools-list" key={`tool-page-${activeToolPage}`}>
                                    {toolPages[activeToolPage].map(item => (
                                        <button
                                            key={item.id}
                                            type="button"
                                            className="proto-tool-item"
                                            onClick={() => onContentTarget(item.targetType, item.targetValue)}
                                        >
                                            <span className="proto-tool-left">
                                                {item.imageUrl ? (
                                                    <SafeImage
                                                        frameClassName="proto-tool-image-frame"
                                                        className="proto-tool-image"
                                                        src={item.imageUrl}
                                                        alt=""
                                                        imageKind="icon"
                                                        sizes="32px"
                                                        loading="lazy"
                                                        showFallbackIcon={false}
                                                    />
                                                ) : (
                                                    <Sparkles
                                                        className="proto-tool-emoji"
                                                        aria-hidden="true"
                                                    />
                                                )}
                                                <span>
                                                    <span className="proto-tool-name">{item.label}</span>
                                                    {item.description && (
                                                        <span className="proto-tool-sub">
                                                            {item.description}
                                                        </span>
                                                    )}
                                                </span>
                                            </span>
                                            <ArrowRight className="proto-tool-arrow" aria-hidden="true" />
                                        </button>
                                    ))}
                                </div>
                            ) : null}
                        </aside>
                    )}
                </div>
            </div>

            <div className="proto-filter-bar">
                <div
                    className="proto-category-pills"
                    role="group"
                    aria-label={isZh ? '商品分类' : 'Product categories'}
                >
                    <button
                        type="button"
                        className={`proto-cat-pill ${collectionId === 'all' ? 'is-active' : ''}`}
                        onClick={() => selectCollection('all')}
                    >
                        {isZh ? '全部商品' : 'All products'}
                    </button>
                    {collections.slice(0, 5).map(collection => (
                        <button
                            key={collection.id}
                            type="button"
                            className={`proto-cat-pill ${collectionId === collection.id ? 'is-active' : ''}`}
                            onClick={() => selectCollection(collection.id)}
                            aria-pressed={collectionId === collection.id}
                        >
                            {collection.name}
                        </button>
                    ))}
                </div>
                <div className="proto-sort-controls">
                    <button
                        type="button"
                        className="proto-category-link"
                        onClick={() =>
                            collectionId === 'all'
                                ? onContentTarget('CATEGORY', null)
                                : onCollectionSelect(collectionId)
                        }
                    >
                        {isZh ? '查看分类' : 'View category'}
                        <ArrowRight aria-hidden="true" />
                    </button>
                    <label>
                        <span className="sr-only">{isZh ? '排序' : 'Sort'}</span>
                        <select value={sort} onChange={event => setSort(event.target.value as SortType)}>
                            <option value="recommended">{isZh ? '综合推荐' : 'Recommended'}</option>
                            <option value="price-asc">{isZh ? '价格从低到高' : 'Price low to high'}</option>
                            <option value="newest">{isZh ? '最新上架' : 'Newest'}</option>
                        </select>
                    </label>
                    <label className="proto-stock-toggle">
                        <input
                            type="checkbox"
                            checked={inStockOnly}
                            onChange={event => setInStockOnly(event.target.checked)}
                        />
                        <span>{isZh ? '仅看有货' : 'In stock only'}</span>
                    </label>
                </div>
            </div>

            <div className="proto-product-section">
                <div className="proto-product-heading">
                    <div>
                        <h2>{isZh ? '精选商品' : 'Featured products'}</h2>
                    </div>
                    {!loading && products.length > 0 && (
                        <span className="proto-product-count">
                            {isZh
                                ? `当前展示 ${visibleProducts.length} 件`
                                : `${visibleProducts.length} shown`}
                        </span>
                    )}
                </div>
                {loading ? (
                    <div className="proto-product-grid" aria-label={isZh ? '商品加载中' : 'Loading products'}>
                        {Array.from({ length: 4 }, (_, index) => (
                            <div className="proto-product-skeleton" key={index} aria-hidden="true" />
                        ))}
                    </div>
                ) : visibleProducts.length > 0 ? (
                    <div className="proto-product-grid">
                        {visibleProducts.map((product, index) => (
                            <ProductCard
                                key={product.id}
                                product={product}
                                market={market}
                                locale={locale}
                                language={language}
                                priority={!hero?.imageUrl && index === 0}
                                imageSizes="(min-width: 1280px) 202px, (min-width: 1024px) 18vw, calc(50vw - 24px)"
                                onOpen={() => onProductSelect(product.id)}
                            />
                        ))}
                    </div>
                ) : (
                    <div className="empty-state">
                        <strong>
                            {products.length > 0
                                ? isZh
                                    ? '当前筛选下没有商品'
                                    : 'No products match these filters'
                                : isZh
                                  ? '当前店铺暂无上架商品'
                                  : 'No products are available yet'}
                        </strong>
                        {products.length > 0 && (
                            <button
                                type="button"
                                onClick={() => {
                                    setCollectionId('all');
                                    setInStockOnly(false);
                                }}
                            >
                                {isZh ? '清除筛选' : 'Clear filters'}
                            </button>
                        )}
                    </div>
                )}
            </div>
        </section>
    );
}
