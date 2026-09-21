import { useNavigate } from '@tanstack/react-router';
import { ReactNode, useMemo, useState } from 'react';
import type { HomeNoticeItem } from '../../pages/home-page';

import { productAvailability } from '../../product-availability';
import { StorefrontCouponCard } from '../../storefront-coupons';
import { routeNavigateOptions, type RouteState } from '../../storefront-router';
import { FlashSaleSection, HomepageCouponHub } from '../../storefront-ui/content-ui';
import { LegalFooter } from '../../storefront-ui/page-shell';
import { sanitizeProductSubtitle } from '../../storefront-ui/product-display';
import {
    CollectionSummary,
    Product,
    StorefrontContentBlock,
    StorefrontContentTargetType,
    StorefrontFlashSale,
    StorefrontFlashSaleItem,
    StorefrontFlashSaleProduct,
    StorefrontLanguage,
} from '../../types';

export interface DesktopNeoMinimalistHomeProps {
    products: Product[];
    collections: CollectionSummary[];
    contentBlocks?: StorefrontContentBlock[];
    managedHeroes?: StorefrontContentBlock[];
    quickLinks?: Array<{
        id: string;
        label: string;
        icon: ReactNode;
        disabled?: boolean;
        onClick: () => void;
    }>;
    coreCategoriesBlock?: StorefrontContentBlock;
    activeNoticeItem?: HomeNoticeItem;
    onOpenNotice?: () => void;
    coupons?: StorefrontCouponCard[];
    onClaimCoupon?: (campaignId: string) => Promise<string | null>;
    flashSales?: StorefrontFlashSale[];
    flashSaleItems?: Array<StorefrontFlashSaleItem | StorefrontFlashSaleProduct>;
    flashSaleBlock?: StorefrontContentBlock;
    legalBlock?: StorefrontContentBlock;
    favoriteProductIds?: string[];
    onToggleFavorite?: (productId: string) => void;
    language: StorefrontLanguage;
    locale?: string;
    storefrontName: string;
    displayCurrencyCode?: string;
    onProductSelect?: (productId: string) => void;
    onOpenHero?: () => void;
    onContentTarget?: (targetType: StorefrontContentTargetType, targetValue: string | null) => void;
    onToast?: (message: string) => void;
}

type SortType = 'default' | 'sales' | 'price-asc' | 'newest';

function getProductEmoji(name: string): string {
    const lower = name.toLowerCase();
    if (lower.includes('token') || lower.includes('额度') || lower.includes('充值')) return '⚡';
    if (lower.includes('gpt') || lower.includes('chat') || lower.includes('o3')) return '🤖';
    if (lower.includes('claude') || lower.includes('sonnet')) return '✨';
    if (
        lower.includes('codex') ||
        lower.includes('pro') ||
        lower.includes('code') ||
        lower.includes('cursor')
    )
        return '💻';
    if (
        lower.includes('midjourney') ||
        lower.includes('flux') ||
        lower.includes('图') ||
        lower.includes('sdxl')
    )
        return '🎨';
    if (lower.includes('api') || lower.includes('key')) return '🔑';
    if (lower.includes('苹果') || lower.includes('apple') || lower.includes('id')) return '🍎';
    if (lower.includes('谷歌') || lower.includes('google')) return '🌐';
    if (lower.includes('grok')) return '🚀';
    if (lower.includes('gemini')) return '💎';
    return '📦';
}

export function DesktopNeoMinimalistHome({
    products = [],
    collections = [],
    contentBlocks = [],
    managedHeroes = [],
    quickLinks = [],
    coreCategoriesBlock,
    activeNoticeItem,
    onOpenNotice,
    coupons = [],
    onClaimCoupon,
    flashSales = [],
    flashSaleItems = [],
    flashSaleBlock,
    legalBlock,
    favoriteProductIds = [],
    onToggleFavorite,
    language,
    locale,
    storefrontName,
    displayCurrencyCode = 'CNY',
    onProductSelect,
    onOpenHero,
    onContentTarget,
    onToast,
}: DesktopNeoMinimalistHomeProps) {
    const navigate = useNavigate();
    const isZh = language === 'zh';
    const [currentCategory, setCurrentCategory] = useState<string>('all');
    const [currentSort, setCurrentSort] = useState<SortType>('default');
    const [inStockOnly, setInStockOnly] = useState<boolean>(false);

    const navigateTo = (route: RouteState) => void navigate(routeNavigateOptions(route) as never);

    const currencySymbol = displayCurrencyCode === 'USD' ? '$' : '¥';

    // 1. Dynamic Category Tabs derived from actual collections
    const categoryTabs = useMemo(() => {
        const allTab = {
            id: 'all',
            label: isZh ? '全部服务' : 'All Services',
            count: products.length,
        };
        const colTabs = collections.map(col => {
            const count = products.filter(p => p.collections?.some(c => c.id === col.id)).length;
            return {
                id: col.id,
                label: col.name,
                count,
            };
        });
        return [allTab, ...colTabs];
    }, [collections, products, isZh]);

    // 2. Sort tabs
    const sortTabs: Array<{ id: SortType; label: string }> = [
        { id: 'default', label: isZh ? '综合推荐' : 'Featured' },
        { id: 'sales', label: isZh ? '热销榜单' : 'Top Sales' },
        { id: 'price-asc', label: isZh ? '价格从低到高' : 'Price Low to High' },
        { id: 'newest', label: isZh ? '最新上线' : 'Newest' },
    ];

    // 3. Filtered and sorted products
    const filteredProducts = useMemo(() => {
        let items = products.filter(p => {
            if (currentCategory !== 'all') {
                const inCategory = p.collections?.some(c => c.id === currentCategory);
                if (!inCategory) return false;
            }
            if (inStockOnly) {
                const variant = p.variants[0];
                if (variant) {
                    const availability = productAvailability(variant);
                    if (availability.soldOut) return false;
                }
            }
            return true;
        });

        if (currentSort === 'price-asc') {
            items = [...items].sort(
                (a, b) => (a.variants[0]?.priceWithTax ?? 0) - (b.variants[0]?.priceWithTax ?? 0),
            );
        } else if (currentSort === 'sales') {
            items = [...items].sort((a, b) => Number(b.id) - Number(a.id));
        } else if (currentSort === 'newest') {
            items = [...items].sort(
                (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
            );
        }

        return items;
    }, [products, currentCategory, inStockOnly, currentSort]);

    // 4. Hero section data
    const activeHero = managedHeroes[0];
    const featuredProduct = products[0];

    const heroTitle = activeHero?.title || featuredProduct?.name || storefrontName;
    const heroDesc =
        activeHero?.subtitle ||
        activeHero?.body ||
        (featuredProduct
            ? sanitizeProductSubtitle(featuredProduct.description, featuredProduct.name, 90)
            : isZh
              ? '原生支持多模型接入，官方直连、自动化发货、稳定售后保障。'
              : 'Enterprise-grade AI access with instant automated fulfillment.');

    const heroCtaText =
        activeHero?.ctaLabel ||
        (featuredProduct
            ? `${isZh ? '立即选购' : 'Buy Now'} ${currencySymbol}${((featuredProduct.variants[0]?.priceWithTax ?? 0) / 100).toFixed(0)}`
            : isZh
              ? '浏览全部服务'
              : 'Browse Services');

    const handleHeroAction = () => {
        if (onOpenHero) {
            onOpenHero();
        } else if (activeHero?.targetType && activeHero.targetType !== 'NONE' && activeHero.targetValue) {
            onContentTarget?.(activeHero.targetType, activeHero.targetValue);
        } else if (featuredProduct) {
            if (onProductSelect) onProductSelect(featuredProduct.id);
            else navigateTo({ name: 'product', id: featuredProduct.id });
        } else {
            navigateTo({ name: 'category' });
        }
    };

    const handleProductCardClick = (productId: string) => {
        if (onProductSelect) {
            onProductSelect(productId);
        } else {
            navigateTo({ name: 'product', id: productId });
        }
    };

    // Backward-compatible custom shortcuts for tests
    const quickLinksBlock = contentBlocks.find(b => b.type === 'QUICK_LINKS');
    const rootCollectionId = collections[0]?.id;
    const desktopFilteredShortcuts = (quickLinksBlock?.items ?? []).filter(item => {
        const isRootNav = item.targetType === 'COLLECTION' && item.targetValue === rootCollectionId;
        return !isRootNav;
    });

    return (
        <section className="proto-home-container">
            {/* 0. NOTICE STRIP (PARITY WITH MOBILE) */}
            {activeNoticeItem && (
                <div
                    className="proto-notice-strip"
                    role="button"
                    tabIndex={0}
                    onClick={onOpenNotice}
                    onKeyDown={e => {
                        if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            onOpenNotice?.();
                        }
                    }}
                >
                    <span className="proto-notice-icon">📢</span>
                    <span className="proto-notice-tag">{isZh ? '系统公告' : 'Notice'}</span>
                    <span className="proto-notice-text">
                        {activeNoticeItem.summary || activeNoticeItem.title}
                    </span>
                    <span className="proto-notice-arrow">→</span>
                </div>
            )}

            {/* 1. HERO BENTO GRID */}
            <div className="proto-hero-section">
                <div className="proto-hero-grid">
                    {/* LEFT LARGE CARD (~65% WIDTH) - PURE NATURAL IMAGE WITHOUT DARK OVERLAY */}
                    <div
                        className={`proto-hero-featured ${activeHero?.imageUrl ? 'has-hero-bg' : ''}`}
                        style={
                            activeHero?.imageUrl
                                ? {
                                      backgroundImage: `url(${activeHero.imageUrl})`,
                                      backgroundSize: 'cover',
                                      backgroundPosition: 'center',
                                  }
                                : undefined
                        }
                        onClick={handleHeroAction}
                    >
                        <div className="proto-featured-content">
                            <span className="proto-flagship-badge">
                                ⚡ {isZh ? '官方推荐' : 'Featured Official'}
                            </span>
                            <h2 className="proto-flagship-title">{heroTitle}</h2>
                            <p className="proto-flagship-desc">{heroDesc}</p>
                        </div>
                        <div className="proto-flagship-actions">
                            <button
                                type="button"
                                className="proto-btn-upgrade"
                                onClick={e => {
                                    e.stopPropagation();
                                    handleHeroAction();
                                }}
                            >
                                {heroCtaText}
                            </button>
                            <button
                                type="button"
                                className="proto-btn-benchmarks"
                                onClick={e => {
                                    e.stopPropagation();
                                    navigateTo({ name: 'category' });
                                }}
                            >
                                {isZh ? '全品类目录' : 'All Categories'}
                            </button>
                        </div>
                    </div>

                    {/* RIGHT TOOLS CARD (~35% WIDTH) */}
                    <div className="proto-hero-tools">
                        <div className="proto-tools-header">
                            <span className="proto-tools-title">
                                🚀 {isZh ? '快捷服务通道' : 'Service Shortcuts'}
                            </span>
                            <span className="proto-tools-status">100% {isZh ? '在线' : 'ONLINE'}</span>
                        </div>

                        <div className="proto-tools-list">
                            {quickLinks && quickLinks.length > 0 ? (
                                quickLinks.slice(0, 3).map(item => (
                                    <button
                                        key={item.id}
                                        type="button"
                                        className="proto-tool-item"
                                        disabled={item.disabled}
                                        onClick={item.onClick}
                                    >
                                        <div className="proto-tool-left">
                                            <span className="proto-tool-emoji">
                                                {typeof item.icon === 'string' ? item.icon : '✨'}
                                            </span>
                                            <div>
                                                <div className="proto-tool-name">{item.label}</div>
                                                <div className="proto-tool-sub">
                                                    {isZh ? '极速直达服务' : 'Instant Service'}
                                                </div>
                                            </div>
                                        </div>
                                        <span className="proto-tool-arrow">→</span>
                                    </button>
                                ))
                            ) : collections.length > 0 ? (
                                collections.slice(0, 3).map((col, idx) => (
                                    <button
                                        key={col.id}
                                        type="button"
                                        className="proto-tool-item"
                                        onClick={() => navigateTo({ name: 'category', collectionId: col.id })}
                                    >
                                        <div className="proto-tool-left">
                                            <span className="proto-tool-emoji">
                                                {idx === 0 ? '⚡' : idx === 1 ? '💻' : '📦'}
                                            </span>
                                            <div>
                                                <div className="proto-tool-name">{col.name}</div>
                                                <div className="proto-tool-sub">
                                                    {isZh ? '查看分类全部商品' : 'View collection'}
                                                </div>
                                            </div>
                                        </div>
                                        <span className="proto-tool-arrow">→</span>
                                    </button>
                                ))
                            ) : (
                                <button
                                    type="button"
                                    className="proto-tool-item"
                                    onClick={() => navigateTo({ name: 'category' })}
                                >
                                    <div className="proto-tool-left">
                                        <span className="proto-tool-emoji">📦</span>
                                        <div>
                                            <div className="proto-tool-name">
                                                {isZh ? '浏览分类' : 'Browse Catalog'}
                                            </div>
                                            <div className="proto-tool-sub">
                                                {isZh ? '查看全部商品' : 'All Products'}
                                            </div>
                                        </div>
                                    </div>
                                    <span className="proto-tool-arrow">→</span>
                                </button>
                            )}
                        </div>

                        <div className="proto-tools-footer">
                            <span>
                                {isZh ? '发货履约: ' : 'Fulfillment: '}
                                <strong className="proto-highlight-mono">
                                    {isZh ? '自动秒级交付' : 'Instant'}
                                </strong>
                            </span>
                            <span>
                                {isZh ? '官方正品: ' : 'Warranty: '}
                                <strong className="proto-highlight-green">100%</strong>
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            {/* 1.5 DUAL CATEGORY / SHOWCASE CARDS (IF CONFIGURED BY CMS) */}
            {coreCategoriesBlock && coreCategoriesBlock.items.length > 0 && (
                <div className="proto-dual-showcases-row">
                    {coreCategoriesBlock.items.slice(0, 2).map((item, idx) => {
                        const disabled = item.targetType === 'NONE' || !item.targetValue;
                        return (
                            <button
                                key={item.id}
                                type="button"
                                className={`proto-dual-showcase-card proto-dual-card--${idx === 0 ? 'gateway' : 'support'}`}
                                disabled={disabled}
                                onClick={() => onContentTarget?.(item.targetType, item.targetValue)}
                            >
                                <div className="proto-dual-content">
                                    <span className="proto-dual-badge">
                                        {(typeof item.settings?.badgeLabel === 'string' &&
                                            item.settings.badgeLabel) ||
                                            (idx === 0
                                                ? isZh
                                                    ? '核心中转'
                                                    : 'Core Hub'
                                                : isZh
                                                  ? '官方支持'
                                                  : 'Support')}
                                    </span>
                                    <h3 className="proto-dual-title">{item.label}</h3>
                                    {item.description ? (
                                        <p className="proto-dual-desc">{item.description}</p>
                                    ) : null}
                                    {!disabled ? (
                                        <span className="proto-dual-cta">
                                            {(typeof item.settings?.ctaLabel === 'string' &&
                                                item.settings.ctaLabel) ||
                                                (isZh ? '点击前往' : 'View')}{' '}
                                            →
                                        </span>
                                    ) : null}
                                </div>
                            </button>
                        );
                    })}
                </div>
            )}

            {/* 1.6 COUPONS SECTION (PARITY WITH MOBILE) */}
            {coupons && coupons.length > 0 && onClaimCoupon && (
                <div className="proto-marketing-row proto-coupon-hub-row">
                    <HomepageCouponHub
                        coupons={coupons}
                        language={language}
                        loading={false}
                        onClaim={onClaimCoupon}
                        onToast={onToast}
                    />
                </div>
            )}

            {/* 1.7 FLASH SALES SECTION (PARITY WITH MOBILE) */}
            {flashSaleItems && flashSaleItems.length > 0 && (
                <div className="proto-marketing-row proto-flash-sale-row">
                    <FlashSaleSection
                        title={flashSaleBlock?.title || (isZh ? '限时秒杀' : 'Flash Sale')}
                        subtitle={flashSaleBlock?.subtitle || undefined}
                        items={flashSaleItems}
                        locale={locale || (isZh ? 'zh-CN' : 'en-US')}
                        language={language}
                        endsAt={flashSales?.[0]?.endsAt ?? null}
                        onMore={() => navigateTo({ name: 'flash-sale' })}
                        onProduct={(productId, variantId) =>
                            navigateTo({ name: 'product', id: productId, variantId })
                        }
                    />
                </div>
            )}

            {/* 2. CATEGORY & SORT FILTER BAR */}
            <div className="proto-filter-bar">
                {/* Dynamic Category Pills */}
                <div className="proto-category-pills" role="tablist">
                    {categoryTabs.map(tab => {
                        const isActive = currentCategory === tab.id;
                        return (
                            <button
                                key={tab.id}
                                type="button"
                                className={`proto-cat-pill ${isActive ? 'is-active' : ''}`}
                                onClick={() => setCurrentCategory(tab.id)}
                            >
                                {tab.label} ({tab.count})
                            </button>
                        );
                    })}
                </div>

                {/* Sort & In-Stock Controls */}
                <div className="proto-sort-controls">
                    <span className="proto-sort-label">{isZh ? '排序:' : 'Sort:'}</span>
                    <div className="proto-sort-group">
                        {sortTabs.map(tab => {
                            const isActive = currentSort === tab.id;
                            return (
                                <button
                                    key={tab.id}
                                    type="button"
                                    className={`proto-sort-btn ${isActive ? 'is-active' : ''}`}
                                    onClick={() => setCurrentSort(tab.id)}
                                >
                                    {tab.label}
                                </button>
                            );
                        })}
                    </div>
                    <label className="proto-stock-toggle">
                        <input
                            type="checkbox"
                            checked={inStockOnly}
                            onChange={e => setInStockOnly(e.target.checked)}
                        />
                        <span>{isZh ? '仅看现货发卡' : 'In Stock Only'}</span>
                    </label>
                </div>
            </div>

            {/* 3. 5-COLUMN PRODUCT MATRIX */}
            <div className="proto-product-section">
                {filteredProducts.length > 0 ? (
                    <div className="proto-product-grid">
                        {filteredProducts.map(p => {
                            const variant = p.variants[0];
                            const availability = productAvailability(variant);
                            const inStock = !availability.soldOut;
                            const subtitle = sanitizeProductSubtitle(p.description, p.name, 32);
                            const collectionName =
                                p.collections?.[0]?.name || (isZh ? '热销服务' : 'Service');
                            const isDigital = variant?.customFields?.fulfillmentType === 'digital';
                            const badge = isDigital
                                ? isZh
                                    ? '自动发卡'
                                    : 'Auto Card'
                                : isZh
                                  ? '官方正品'
                                  : 'Official';
                            const priceWithTax = variant?.priceWithTax ?? 0;
                            const priceVal = (priceWithTax / 100).toFixed(priceWithTax % 100 === 0 ? 0 : 2);
                            const isFavorite = favoriteProductIds.includes(p.id);

                            return (
                                <div
                                    key={p.id}
                                    className="proto-product-card"
                                    onClick={() => handleProductCardClick(p.id)}
                                >
                                    {/* Top Dedicated Large Cover Banner (~156px) */}
                                    <div className="proto-card-media-banner">
                                        {p.featuredAsset?.preview ? (
                                            <img
                                                src={p.featuredAsset.preview}
                                                alt={p.name}
                                                loading="lazy"
                                                className="proto-card-cover-img"
                                            />
                                        ) : (
                                            <span className="proto-card-fallback-emoji">
                                                {getProductEmoji(p.name)}
                                            </span>
                                        )}
                                        <span className="proto-card-badge is-purple">{badge}</span>
                                        <button
                                            type="button"
                                            className={`proto-card-fav-btn ${isFavorite ? 'is-favorited' : ''}`}
                                            aria-label={
                                                isFavorite
                                                    ? isZh
                                                        ? '取消收藏'
                                                        : 'Remove favorite'
                                                    : isZh
                                                      ? '收藏商品'
                                                      : 'Add to favorite'
                                            }
                                            onClick={e => {
                                                e.stopPropagation();
                                                onToggleFavorite?.(p.id);
                                            }}
                                        >
                                            <svg
                                                className="proto-fav-heart-icon"
                                                viewBox="0 0 24 24"
                                                width="15"
                                                height="15"
                                                fill={isFavorite ? '#ef4444' : 'none'}
                                                stroke={isFavorite ? '#ef4444' : 'currentColor'}
                                                strokeWidth="2"
                                            >
                                                {/* eslint-disable-next-line max-len */}
                                                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                                            </svg>
                                        </button>
                                    </div>

                                    {/* Card Body Info */}
                                    <div className="proto-card-body">
                                        {/* Status Dot & Collection Name */}
                                        <div className="proto-card-status">
                                            <span
                                                className={`proto-status-dot ${inStock ? 'is-green' : 'is-gray'}`}
                                            />
                                            <span>
                                                {inStock
                                                    ? collectionName
                                                    : isZh
                                                      ? '暂时缺货'
                                                      : 'Out of Stock'}
                                            </span>
                                        </div>

                                        {/* Real Product Name */}
                                        <h4 className="proto-card-name" title={p.name}>
                                            {p.name}
                                        </h4>

                                        {/* Real Product Specs / Subtitle */}
                                        <div className="proto-card-specs">
                                            {subtitle ||
                                                (isZh
                                                    ? '官方直连 · 自动化发卡 · 售后质保'
                                                    : 'Official direct API · Instant delivery')}
                                        </div>
                                    </div>

                                    {/* Real Price & Buy Button */}
                                    <div className="proto-card-footer">
                                        <div className="proto-card-price-box">
                                            <span className="proto-currency-symbol">{currencySymbol}</span>
                                            <span className="proto-price-val">{priceVal}</span>
                                        </div>
                                        <button
                                            type="button"
                                            className="proto-buy-btn"
                                            onClick={e => {
                                                e.stopPropagation();
                                                handleProductCardClick(p.id);
                                            }}
                                        >
                                            {isZh ? '购买' : 'Buy'}
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <div className="proto-empty-state">
                        <p>{isZh ? '该分类下暂无在售商品' : 'No products available in this category'}</p>
                    </div>
                )}
            </div>

            {/* Backward-compatible custom shortcuts with robust onContentTarget routing */}
            {desktopFilteredShortcuts.length > 0 && (
                <div className="desktop-custom-shortcuts-bar" aria-label="Custom shortcuts">
                    {desktopFilteredShortcuts.map(item => (
                        <button
                            key={item.id}
                            type="button"
                            className="custom-shortcut-pill"
                            onClick={() => {
                                if (onContentTarget) {
                                    onContentTarget(item.targetType, item.targetValue);
                                } else if (item.targetType === 'COLLECTION' && item.targetValue) {
                                    navigateTo({
                                        name: 'category',
                                        collectionId: item.targetValue,
                                    });
                                } else if (item.targetType === 'PAGE' && item.targetValue) {
                                    if (item.targetValue === 'services') navigateTo({ name: 'services' });
                                    else if (item.targetValue === 'image-studio')
                                        navigateTo({ name: 'image-studio' });
                                    else navigateTo({ name: 'category' });
                                }
                            }}
                        >
                            <b>{item.label}</b>
                        </button>
                    ))}
                </div>
            )}

            {/* 4. LEGAL FOOTER (PARITY WITH MOBILE) */}
            {legalBlock && (
                <div className="proto-footer-wrapper">
                    <LegalFooter
                        storefrontName={storefrontName}
                        language={language}
                        content={legalBlock}
                        onContentTarget={
                            onContentTarget ||
                            (() => {
                                /* noop */
                            })
                        }
                    />
                </div>
            )}
        </section>
    );
}
