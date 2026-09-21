import { ArrowRight, Sparkles } from 'lucide-react';
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
import { ProductCard } from '../common/product-card';

type SortType = 'recommended' | 'price-asc' | 'newest';

export interface DesktopUnifiedHomeProps {
    products: Product[];
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
    const hero = contentBlocks.find(block => block.type === 'HERO');
    const quickLinks = contentBlocks
        .find(block => block.type === 'QUICK_LINKS')
        ?.items.filter(item => item.enabled && item.label.trim());
    const featuredProduct =
        (hero?.targetType === 'PRODUCT' && products.find(product => product.id === hero.targetValue)) ||
        products[0];
    const tools = (quickLinks ?? []).slice(0, 3);

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
        if (id !== 'all') onCollectionSelect(id);
    };

    return (
        <section className="proto-home-container" aria-label={isZh ? '店铺首页' : 'Store home'}>
            <div className="proto-hero-section">
                <div className="proto-hero-grid">
                    <article className="proto-hero-featured">
                        <div className="proto-featured-content">
                            <span className="proto-flagship-badge">
                                <Sparkles aria-hidden="true" size={13} />
                                {hero?.title || storefrontTagline || storefrontName}
                            </span>
                            <h1 className="proto-flagship-title">
                                {featuredProduct?.name || hero?.subtitle || storefrontName}
                            </h1>
                            <p className="proto-flagship-desc">
                                {hero?.body ||
                                    storefrontDescription ||
                                    (isZh
                                        ? '发现店铺精选商品与服务。'
                                        : 'Discover selected products and services.')}
                            </p>
                        </div>
                        <div className="proto-flagship-actions">
                            <button
                                type="button"
                                className="proto-btn-upgrade"
                                onClick={() =>
                                    featuredProduct
                                        ? onProductSelect(featuredProduct.id)
                                        : onContentTarget('CATEGORY', null)
                                }
                            >
                                {hero?.ctaLabel || (isZh ? '查看详情' : 'View details')}
                            </button>
                        </div>
                        {hero?.imageUrl && (
                            <SafeImage className="proto-featured-media" src={hero.imageUrl} alt="" />
                        )}
                    </article>

                    {tools.length > 0 && (
                        <aside className="proto-hero-tools" aria-label={isZh ? '快捷入口' : 'Shortcuts'}>
                            <div className="proto-tools-header">
                                <span className="proto-tools-title">
                                    {isZh ? '快捷入口' : 'Quick access'}
                                </span>
                            </div>
                            <div className="proto-tools-list">
                                {tools.map(item => (
                                    <button
                                        key={item.id}
                                        type="button"
                                        className="proto-tool-item"
                                        onClick={() => onContentTarget(item.targetType, item.targetValue)}
                                    >
                                        <span className="proto-tool-left">
                                            {item.imageUrl ? (
                                                <SafeImage
                                                    className="proto-tool-image"
                                                    src={item.imageUrl}
                                                    alt=""
                                                />
                                            ) : (
                                                <Sparkles className="proto-tool-emoji" aria-hidden="true" />
                                            )}
                                            <span>
                                                <span className="proto-tool-name">{item.label}</span>
                                                {item.description && (
                                                    <span className="proto-tool-sub">{item.description}</span>
                                                )}
                                            </span>
                                        </span>
                                        <ArrowRight className="proto-tool-arrow" aria-hidden="true" />
                                    </button>
                                ))}
                            </div>
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
                        {isZh ? '全部商品' : 'All products'} ({products.length})
                    </button>
                    {collections.slice(0, 4).map(collection => {
                        const count = products.filter(product =>
                            product.collections.some(item => item.id === collection.id),
                        ).length;
                        return (
                            <button
                                key={collection.id}
                                type="button"
                                className={`proto-cat-pill ${collectionId === collection.id ? 'is-active' : ''}`}
                                onClick={() => selectCollection(collection.id)}
                            >
                                {collection.name} ({count})
                            </button>
                        );
                    })}
                </div>
                <div className="proto-sort-controls">
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
                {visibleProducts.length > 0 ? (
                    <div className="proto-product-grid">
                        {visibleProducts.map(product => (
                            <ProductCard
                                key={product.id}
                                product={product}
                                market={market}
                                locale={locale}
                                language={language}
                                onOpen={() => onProductSelect(product.id)}
                            />
                        ))}
                    </div>
                ) : (
                    <div className="empty-state">
                        <strong>{isZh ? '当前筛选下没有商品' : 'No products match these filters'}</strong>
                        <button
                            type="button"
                            onClick={() => {
                                setCollectionId('all');
                                setInStockOnly(false);
                            }}
                        >
                            {isZh ? '清除筛选' : 'Clear filters'}
                        </button>
                    </div>
                )}
            </div>
        </section>
    );
}
