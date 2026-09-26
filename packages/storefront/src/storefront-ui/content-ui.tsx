import { useNavigate } from '@tanstack/react-router';
import {
    Check,
    ChevronRight,
    CircleCheck,
    Download,
    Flame,
    Headphones,
    LayoutGrid,
    Package,
    RotateCcw,
    Sparkles,
    Store,
    Tag,
    Truck,
    Waypoints,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { publishedContentItems } from '../../../storefront-content-plugin/src/content-publication';
import { DesktopCouponTicket } from '../components/common/desktop-coupon-ticket';
import { useDesktopLayout } from '../desktop-layout';
import { selectManagedProducts } from '../home-merchandising';
import { resolveManagedContentCopy } from '../managed-content-copy';
import { managedContentStyle } from '../managed-content-style';
import { responsiveImageSources } from '../responsive-image';
import { StorefrontCouponCard } from '../storefront-coupons';
import { routePath } from '../storefront-router';
import {
    MarketConfig,
    Product,
    StorefrontContentBlock,
    StorefrontContentItem,
    StorefrontContentTargetType,
    StorefrontFlashSale,
    StorefrontFlashSaleItem,
    StorefrontFlashSaleProduct,
    StorefrontLanguage,
} from '../types';

import { EmptyState, SectionHeader, Subpage } from './page-shell';
import {
    contentNumberSetting,
    contentStringArraySetting,
    formatMoney,
    productImage,
    SafeImage,
    trimText,
} from './product-display';
import { ProductSection } from './product-section';

export function BrandLogo({ url, name, className }: { url: string | null; name: string; className: string }) {
    const sourceUrl = url?.trim() || null;
    const responsiveSource = sourceUrl ? responsiveImageSources(sourceUrl, 'thumbnail') : null;

    if (!responsiveSource) {
        return (
            <span className={`${className} is-brand-fallback`} aria-hidden="true">
                <Store size={24} />
            </span>
        );
    }

    return (
        <span className={`${className} is-brand-image`}>
            <SafeImage
                src={sourceUrl ?? ''}
                imageKind="thumbnail"
                sizes="36px"
                width={36}
                height={36}
                alt={name}
            />
        </span>
    );
}

export interface HomepageCouponHubProps {
    block?: StorefrontContentBlock;
    coupons: StorefrontCouponCard[];
    language: StorefrontLanguage;
    loading: boolean;
    onClaim: (campaignId: string) => Promise<string | null>;
    onToast?: (message: string) => void;
}

export function HomepageCouponHub({
    block,
    coupons,
    language,
    loading,
    onClaim,
    onToast,
}: HomepageCouponHubProps) {
    const navigate = useNavigate();
    const desktop = useDesktopLayout();
    const isZh = language === 'zh';
    const [claimingId, setClaimingId] = useState<string | null>(null);
    const handleClaim = async (coupon: StorefrontCouponCard) => {
        if (!coupon.claimable || claimingId) return;
        setClaimingId(coupon.id);
        const error = await onClaim(coupon.campaignId);
        setClaimingId(null);
        if (error) {
            if (onToast) onToast(error);
        } else {
            if (onToast) onToast(isZh ? '优惠券领取成功' : 'Coupon claimed successfully');
        }
    };

    return (
        <section className="coupon-hub-section" aria-label={isZh ? '专享特惠与优惠券' : 'Exclusive Coupons'}>
            <div className="coupon-hub-header">
                <div className="coupon-hub-title-lockup">
                    <span className="coupon-hub-icon-pill" aria-hidden="true">
                        <Tag size={13} />
                    </span>
                    <h2 className="coupon-hub-title">
                        {block?.title || (isZh ? '专享特惠专区' : 'Exclusive Coupons')}
                    </h2>
                </div>
                <button
                    type="button"
                    className="coupon-hub-more-btn"
                    onClick={() => void navigate({ to: routePath('coupons') } as never)}
                >
                    <span>{isZh ? '全部优惠' : 'All Offers'}</span>
                    <ChevronRight size={13} aria-hidden="true" />
                </button>
            </div>

            <div className="coupon-hub-scroll" role="list">
                {coupons.map(coupon => {
                    const canClaim = coupon.claimable && !coupon.claimed;
                    const claimAction = (
                        <button
                            type="button"
                            className={`coupon-claim-btn ${!canClaim ? 'is-claimed' : ''}${claimingId === coupon.id ? ' is-claiming' : ''}`}
                            onClick={() => void handleClaim(coupon)}
                            disabled={!canClaim || loading || claimingId !== null}
                            aria-label={
                                !canClaim
                                    ? isZh
                                        ? `已领取 ${coupon.title}`
                                        : `Claimed ${coupon.title}`
                                    : isZh
                                      ? `领取 ${coupon.title}`
                                      : `Claim ${coupon.title}`
                            }
                        >
                            <span className="coupon-btn-text-wrap">
                                {claimingId === coupon.id ? (
                                    <span>{isZh ? '领取中' : 'Claiming'}</span>
                                ) : !canClaim ? (
                                    <>
                                        <span>{isZh ? '已领取' : 'Claimed'}</span>
                                        <Check size={12} strokeWidth={2.4} aria-hidden="true" />
                                    </>
                                ) : (
                                    <span>{isZh ? '立即领取' : 'Claim'}</span>
                                )}
                            </span>
                        </button>
                    );
                    if (desktop)
                        return (
                            <DesktopCouponTicket
                                key={coupon.id}
                                card={coupon}
                                role="listitem"
                                action={claimAction}
                            />
                        );

                    return (
                        <div
                            key={coupon.id}
                            className={`coupon-ticket-card coupon-ticket-${coupon.theme} ${!canClaim ? 'is-claimed' : ''}`}
                            role="listitem"
                        >
                            <div className="coupon-ticket-main">
                                <div className="coupon-ticket-top">
                                    <span className="coupon-ticket-tag">{coupon.tag}</span>
                                </div>
                                <div
                                    className={`coupon-ticket-value${
                                        coupon.unitBefore ? ' is-unit-before' : ''
                                    }`}
                                >
                                    {coupon.unitBefore ? (
                                        <>
                                            <small className="coupon-unit">{coupon.unit}</small>
                                            <strong className="coupon-num">{coupon.value}</strong>
                                        </>
                                    ) : (
                                        <>
                                            <strong className="coupon-num">{coupon.value}</strong>
                                            {coupon.unit && (
                                                <small className="coupon-unit">{coupon.unit}</small>
                                            )}
                                        </>
                                    )}
                                </div>
                                <p className="coupon-ticket-desc">{coupon.description}</p>
                            </div>

                            <div className="coupon-ticket-action">{claimAction}</div>
                        </div>
                    );
                })}
            </div>
        </section>
    );
}

export function aggregateFlashSaleProducts(items: StorefrontFlashSaleItem[]): StorefrontFlashSaleProduct[] {
    const productsMap = new Map<string, StorefrontFlashSaleItem[]>();
    for (const item of items) {
        const list = productsMap.get(item.productId);
        if (list) {
            list.push(item);
        } else {
            productsMap.set(item.productId, [item]);
        }
    }

    const aggregated: StorefrontFlashSaleProduct[] = [];
    for (const [productId, variants] of productsMap.entries()) {
        let lowestVariant = variants[0];
        for (let i = 1; i < variants.length; i++) {
            const v = variants[i];
            if (v.salePrice < lowestVariant.salePrice) {
                lowestVariant = v;
            } else if (v.salePrice === lowestVariant.salePrice) {
                if (v.originalPrice - v.salePrice > lowestVariant.originalPrice - lowestVariant.salePrice) {
                    lowestVariant = v;
                }
            }
        }

        const minSalePrice = lowestVariant.salePrice;
        const hasPriceRange = variants.some(v => v.salePrice !== minSalePrice);
        const hasMultipleVariants = variants.length > 1;
        const imageUrl = lowestVariant.imageUrl || variants.find(v => Boolean(v.imageUrl))?.imageUrl || null;

        aggregated.push({
            productId,
            productVariantId: lowestVariant.productVariantId,
            productName: lowestVariant.productName,
            variantName: lowestVariant.variantName,
            salePrice: minSalePrice,
            originalPrice: lowestVariant.originalPrice,
            currencyCode: lowestVariant.currencyCode,
            imageUrl,
            hasMultipleVariants,
            hasPriceRange,
            variantCount: variants.length,
        });
    }

    return aggregated;
}

export function FlashSaleSection({
    title,
    items,
    locale,
    language,
    endsAt,
    onMore,
    onProduct,
    layout = 'carousel',
}: {
    title: string;
    items: Array<StorefrontFlashSaleItem | StorefrontFlashSaleProduct>;
    locale: string;
    language: StorefrontLanguage;
    endsAt: string | null;
    onMore?: () => void;
    onProduct: (productId: string, variantId?: string) => void;
    layout?: 'carousel' | 'grid';
}) {
    const isZh = language === 'zh';
    const countdown = useFlashSaleCountdown(endsAt, language);
    if (!items.length) return null;
    return (
        <section className="content-section flash-sale-section">
            <SectionHeader
                kind="flash-sale"
                title={title}
                titleAccessory={
                    countdown ? (
                        <span
                            className="flash-sale-countdown"
                            role="timer"
                            aria-label={`${isZh ? '距结束' : 'Ends in'} ${countdown}`}
                        >
                            <span className="flash-sale-countdown-label">{isZh ? '距结束' : 'Ends in'}</span>
                            <strong>{countdown}</strong>
                        </span>
                    ) : undefined
                }
                action={onMore ? (isZh ? '更多' : 'More') : undefined}
                onAction={onMore}
            />
            <div
                className={`flash-sale-grid${layout === 'grid' ? ' is-expanded' : ''}`}
                aria-label={
                    isZh ? `秒杀商品，共 ${items.length} 件` : `Flash-sale products, ${items.length} items`
                }
            >
                {items.map((item, index) => {
                    const hasMultipleVariants =
                        'hasMultipleVariants' in item ? item.hasMultipleVariants : false;
                    const hasPriceRange = 'hasPriceRange' in item ? item.hasPriceRange : false;
                    return (
                        <button
                            type="button"
                            className="flash-sale-card"
                            key={item.productId}
                            onClick={() => onProduct(item.productId, item.productVariantId)}
                            aria-label={`${isZh ? '查看秒杀商品' : 'View flash-sale product'} ${item.productName}`}
                        >
                            <FlashSaleImage
                                imageUrl={item.imageUrl}
                                productName={item.productName}
                                index={index}
                                layout={layout}
                                badge={isZh ? '限时价' : 'Limited price'}
                            />
                            <strong className="flash-sale-name">{item.productName}</strong>
                            {hasMultipleVariants ? (
                                <small className="flash-sale-variant-hint">
                                    {isZh ? '多规格可选' : 'Multiple options'}
                                </small>
                            ) : item.variantName && item.variantName !== item.productName ? (
                                <small>{item.variantName}</small>
                            ) : null}
                            <span className="flash-sale-price">
                                <b>
                                    {formatMoney(item.salePrice, item.currencyCode, locale)}
                                    {hasPriceRange ? (
                                        <span className="flash-sale-price-suffix">
                                            {isZh ? ' 起' : ' up'}
                                        </span>
                                    ) : null}
                                </b>
                                <del>{formatMoney(item.originalPrice, item.currencyCode, locale)}</del>
                            </span>
                        </button>
                    );
                })}
            </div>
        </section>
    );
}

function FlashSaleImage({
    imageUrl,
    productName,
    index,
    layout,
    badge,
}: {
    imageUrl: string | null;
    productName: string;
    index: number;
    layout: 'carousel' | 'grid';
    badge: string;
}) {
    const frameRef = useRef<HTMLSpanElement>(null);
    const [preload, setPreload] = useState(index < 4);

    useEffect(() => {
        if (preload || layout !== 'carousel' || typeof IntersectionObserver === 'undefined') return;
        const frame = frameRef.current;
        const scroller = frame?.closest('.flash-sale-grid');
        if (!frame || !(scroller instanceof HTMLElement)) return;
        const observer = new IntersectionObserver(
            entries => {
                if (entries.some(entry => entry.isIntersecting)) {
                    setPreload(true);
                    observer.disconnect();
                }
            },
            {
                root: scroller,
                rootMargin: '0px 480px 0px 120px',
                threshold: 0.01,
            },
        );
        observer.observe(frame);
        return () => observer.disconnect();
    }, [layout, preload]);

    return (
        <span ref={frameRef} className="flash-sale-image">
            {imageUrl ? (
                <SafeImage
                    src={imageUrl}
                    alt={productName}
                    imageKind={layout === 'carousel' ? 'thumbnail' : 'card'}
                    sizes={
                        layout === 'carousel'
                            ? '(min-width: 420px) 126px, 30vw'
                            : '(min-width: 1024px) 220px, (min-width: 420px) 160px, 42vw'
                    }
                    loading={preload ? 'eager' : 'lazy'}
                    fetchPriority={index < 2 ? 'high' : 'auto'}
                />
            ) : (
                <span className="image-placeholder" aria-hidden="true">
                    <Package />
                </span>
            )}
            <em>{badge}</em>
        </span>
    );
}

export function FlashSalePage({
    sales,
    language,
    locale,
    onBack,
    onProduct,
}: {
    sales: StorefrontFlashSale[];
    language: StorefrontLanguage;
    locale: string;
    onBack: () => void;
    onProduct: (productId: string, variantId?: string) => void;
}) {
    const isZh = language === 'zh';
    const rawItems = sales
        .flatMap(sale => sale.items)
        .filter(
            (item, index, allItems) =>
                allItems.findIndex(candidate => candidate.productVariantId === item.productVariantId) ===
                index,
        );
    const items = aggregateFlashSaleProducts(rawItems);
    return (
        <Subpage title={isZh ? '限时秒杀' : 'Flash sale'} language={language} onBack={onBack}>
            {items.length ? (
                <FlashSaleSection
                    title={isZh ? '限时秒杀' : 'Flash sale'}
                    items={items}
                    locale={locale}
                    language={language}
                    endsAt={sales[0]?.endsAt ?? null}
                    onProduct={onProduct}
                    layout="grid"
                />
            ) : (
                <EmptyState
                    icon={<Flame />}
                    title={isZh ? '暂无进行中的秒杀' : 'No active flash sale'}
                    detail={isZh ? '请留意首页的下次活动' : 'Check the home page for the next event'}
                />
            )}
        </Subpage>
    );
}

export function RecommendationPage({
    products,
    block,
    market,
    locale,
    language,
    onBack,
    onProduct,
}: {
    products: Product[];
    block?: StorefrontContentBlock;
    market: MarketConfig;
    locale: string;
    language: StorefrontLanguage;
    onBack: () => void;
    onProduct: (product: Product) => void;
}) {
    const isZh = language === 'zh';
    return (
        <Subpage
            title={resolveManagedContentCopy(block, 'title', isZh ? '猜你喜欢' : 'You may also like')}
            language={language}
            onBack={onBack}
        >
            {products.length ? (
                <ProductSection
                    subtitle={resolveManagedContentCopy(
                        block,
                        'subtitle',
                        isZh
                            ? '结合你的购买品类和浏览记录推荐'
                            : 'Based on your purchase categories and browsing history',
                    )}
                    products={products}
                    market={market}
                    locale={locale}
                    language={language}
                    onProduct={onProduct}
                />
            ) : (
                <EmptyState
                    icon={<Sparkles />}
                    title={isZh ? '暂无推荐商品' : 'No recommendations yet'}
                    detail={
                        isZh
                            ? '浏览或购买商品后，这里会显示更符合你喜好的内容'
                            : 'Browse or purchase products to improve these recommendations'
                    }
                />
            )}
        </Subpage>
    );
}

export function useFlashSaleCountdown(endsAt: string | null, language: StorefrontLanguage): string {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (!endsAt) return;
        const timer = window.setInterval(() => setNow(Date.now()), 1_000);
        return () => window.clearInterval(timer);
    }, [endsAt]);
    if (!endsAt) return '';
    const remainingSeconds = Math.max(0, Math.floor((Date.parse(endsAt) - now) / 1_000));
    if (remainingSeconds <= 0) return language === 'zh' ? '已结束' : 'Ended';
    const days = Math.floor(remainingSeconds / 86_400);
    const hours = Math.floor((remainingSeconds % 86_400) / 3_600);
    const minutes = Math.floor((remainingSeconds % 3_600) / 60);
    const seconds = remainingSeconds % 60;
    return [days ? `${days}${language === 'zh' ? '天' : 'd'}` : '', hours, minutes, seconds]
        .filter(value => value !== '')
        .map((value, index) =>
            typeof value === 'number' && index > 0 ? String(value).padStart(2, '0') : value,
        )
        .join(' : ');
}

export const dualCardTemplateIds = [
    'tech-duo',
    'ocean-cobalt',
    'forest-amber',
    'graphite-lime',
    'berry-slate',
] as const;

export type DualCardTemplateId = (typeof dualCardTemplateIds)[number];

export function HomeDualCategoryShowcase({
    language,
    block,
    onContentTarget,
}: {
    language: StorefrontLanguage;
    block: StorefrontContentBlock;
    onContentTarget: (targetType: StorefrontContentTargetType, targetValue: string | null) => void;
}) {
    const isZh = language === 'zh';
    const items = publishedContentItems(block);
    if (!block.enabled || !items.length) return null;
    const template = dualCardTemplateSetting(block.settings);

    return (
        <section
            className="home-dual-showcase"
            data-card-template={template}
            aria-label={block.title || (isZh ? '核心品类精选' : 'Core Categories')}
        >
            {items.map((item, index) => {
                const disabled = item.targetType === 'NONE' || !item.targetValue;
                const ShowcaseIcon = index === 0 ? Waypoints : Headphones;
                const badgeLabel = localizedDualCardItemSetting(
                    item.settings,
                    'badgeLabel',
                    language,
                    block.subtitle || (isZh ? '核心品类' : 'Core category'),
                );
                const ctaLabel = localizedDualCardItemSetting(
                    item.settings,
                    'ctaLabel',
                    language,
                    block.ctaLabel || (isZh ? '查看分类' : 'View category'),
                );
                return (
                    <button
                        key={item.id}
                        type="button"
                        className={`showcase-card showcase-card--${index === 0 ? 'gateway' : 'support'}${item.imageUrl ? ' has-managed-image' : ''}`}
                        disabled={disabled}
                        onClick={() => onContentTarget(item.targetType, item.targetValue)}
                    >
                        {item.imageUrl ? (
                            <>
                                <span className="showcase-card-media" aria-hidden="true">
                                    <SafeImage src={item.imageUrl} alt="" imageKind="card" loading="lazy" />
                                </span>
                                <span className="showcase-card-image-shade" aria-hidden="true" />
                            </>
                        ) : null}
                        {template === 'tech-duo' ? (
                            <span className="showcase-card-icon" aria-hidden="true">
                                <ShowcaseIcon />
                            </span>
                        ) : null}
                        <div className="showcase-content">
                            {badgeLabel ? <span className="showcase-badge">{badgeLabel}</span> : null}
                            <h3>{item.label}</h3>
                            {item.description ? <p>{item.description}</p> : null}
                            {!disabled && ctaLabel ? (
                                <span className="showcase-link">
                                    {ctaLabel} <ChevronRight aria-hidden="true" />
                                </span>
                            ) : null}
                        </div>
                    </button>
                );
            })}
        </section>
    );
}

export function dualCardTemplateSetting(
    settings: Record<string, unknown> | null | undefined,
): DualCardTemplateId {
    const value = settings?.dualCardTemplate;
    return dualCardTemplateIds.includes(value as DualCardTemplateId)
        ? (value as DualCardTemplateId)
        : 'tech-duo';
}

export function localizedDualCardItemSetting(
    settings: Record<string, unknown> | null | undefined,
    field: 'badgeLabel' | 'ctaLabel',
    language: StorefrontLanguage,
    fallback: string,
): string {
    const preferredKey = `${field}${language === 'zh' ? 'Zh' : 'En'}`;
    const preferred = settings?.[preferredKey];
    if (
        typeof preferred === 'string' &&
        preferred.trim() &&
        (language === 'zh' || !containsHanContent(preferred))
    ) {
        return preferred.trim();
    }
    return fallback;
}

function containsHanContent(value: string): boolean {
    return /\p{Script=Han}/u.test(value);
}

export function HomeTrustGuaranteeStrip({ language }: { language: StorefrontLanguage }) {
    const isZh = language === 'zh';
    return (
        <section className="home-trust-strip" aria-label={isZh ? '购物信息' : 'Shopping information'}>
            <div className="trust-item item-genuine">
                <div className="trust-icon-box">
                    <CircleCheck aria-hidden="true" />
                </div>
                <div className="trust-text">
                    <strong>{isZh ? '商品信息' : 'Product details'}</strong>
                    <small>{isZh ? '价格库存以详情为准' : 'Current price and stock'}</small>
                </div>
            </div>
            <div className="trust-item item-delivery">
                <div className="trust-icon-box">
                    <Download aria-hidden="true" />
                </div>
                <div className="trust-text">
                    <strong>{isZh ? '订单交付' : 'Order delivery'}</strong>
                    <small>{isZh ? '数字交付状态订单内可查' : 'Digital status appears in orders'}</small>
                </div>
            </div>
            <div className="trust-item item-shipping">
                <div className="trust-icon-box">
                    <Truck aria-hidden="true" />
                </div>
                <div className="trust-text">
                    <strong>{isZh ? '配送跟踪' : 'Delivery tracking'}</strong>
                    <small>{isZh ? '发货后查看物流轨迹' : 'Track physical shipments'}</small>
                </div>
            </div>
            <div className="trust-item item-support">
                <div className="trust-icon-box">
                    <RotateCcw aria-hidden="true" />
                </div>
                <div className="trust-text">
                    <strong>{isZh ? '售后入口' : 'Returns'}</strong>
                    <small>{isZh ? '可在订单内提交申请' : 'Request a return from an order'}</small>
                </div>
            </div>
        </section>
    );
}

export function ManagedContentSection({
    block,
    products,
    onContentTarget,
}: {
    block: StorefrontContentBlock;
    products: Product[];
    onContentTarget: (targetType: StorefrontContentTargetType, targetValue: string | null) => void;
}) {
    const blockHasTarget = block.targetType !== 'NONE' && Boolean(block.targetValue);
    const displayCount = Math.min(50, Math.max(1, contentNumberSetting(block.settings?.displayCount, 8)));
    const selectedProductIds = contentStringArraySetting(block.settings?.selectedProductIds);
    const selectedProducts = selectManagedProducts({
        productIds: selectedProductIds,
        products,
        count: displayCount,
    });
    const itemProductIds = new Set(
        block.items.flatMap(item =>
            item.targetType === 'PRODUCT' && item.targetValue ? [item.targetValue] : [],
        ),
    );
    const additionalSelectedProducts = selectedProducts.filter(product => !itemProductIds.has(product.id));
    const blockTargetProduct =
        block.targetType === 'PRODUCT'
            ? products.find(product => product.id === block.targetValue)
            : undefined;
    return (
        <section
            className={`content-section managed-content-section managed-content-${block.type.toLowerCase()}`}
            style={{
                ...managedContentStyle(block),
            }}
        >
            <SectionHeader
                title={block.title}
                subtitle={block.subtitle}
                subtitlePlacement={block.type === 'CATEGORY_AD' ? 'end' : 'below'}
                action={
                    block.type !== 'CATEGORY_AD' && blockHasTarget ? block.ctaLabel || undefined : undefined
                }
                onAction={
                    block.type !== 'CATEGORY_AD' && blockHasTarget
                        ? () => onContentTarget(block.targetType, block.targetValue)
                        : undefined
                }
            />
            {block.body && <p className="managed-content-body">{block.body}</p>}
            {block.imageUrl && !block.items.length && !additionalSelectedProducts.length && (
                <button
                    className="managed-content-banner"
                    type="button"
                    disabled={!blockHasTarget}
                    onClick={() => onContentTarget(block.targetType, block.targetValue)}
                >
                    <SafeImage
                        src={block.imageUrl}
                        fallbackSrc={productImage(blockTargetProduct) ?? undefined}
                        alt={block.title}
                        imageKind="hero"
                        loading="lazy"
                    />
                </button>
            )}
            {!!(block.items.length || additionalSelectedProducts.length) && (
                <div className="managed-content-grid">
                    {block.items.map(item => (
                        <ManagedContentItemButton
                            key={item.id}
                            item={item}
                            products={products}
                            onContentTarget={onContentTarget}
                        />
                    ))}
                    {additionalSelectedProducts.map(product => (
                        <ManagedSelectedProductButton
                            key={product.id}
                            product={product}
                            onContentTarget={onContentTarget}
                        />
                    ))}
                </div>
            )}
        </section>
    );
}

export function ManagedSelectedProductButton({
    product,
    onContentTarget,
}: {
    product: Product;
    onContentTarget: (targetType: StorefrontContentTargetType, targetValue: string | null) => void;
}) {
    const imageUrl = productImage(product);
    return (
        <button
            className="managed-content-card is-product-media"
            type="button"
            onClick={() => onContentTarget('PRODUCT', product.id)}
        >
            <span className="managed-content-media" aria-hidden="true">
                {imageUrl ? (
                    <SafeImage src={imageUrl} alt="" imageKind="card" loading="lazy" />
                ) : (
                    <span className="managed-content-placeholder">
                        <LayoutGrid aria-hidden="true" />
                    </span>
                )}
            </span>
            <span className="managed-content-copy">
                <span>
                    <strong>{product.name}</strong>
                    {product.description ? <small>{trimText(product.description, 72)}</small> : null}
                </span>
                <ChevronRight aria-hidden="true" />
            </span>
        </button>
    );
}

export function ManagedContentItemButton({
    item,
    products,
    onContentTarget,
}: {
    item: StorefrontContentItem;
    products: Product[];
    onContentTarget: (targetType: StorefrontContentTargetType, targetValue: string | null) => void;
}) {
    const disabled = item.targetType === 'NONE' || !item.targetValue;
    const targetProduct =
        item.targetType === 'PRODUCT' ? products.find(product => product.id === item.targetValue) : undefined;
    const targetProductImage = productImage(targetProduct);
    return (
        <button
            className={`managed-content-card${targetProduct ? ' is-product-media' : ''}`}
            type="button"
            disabled={disabled}
            onClick={() => onContentTarget(item.targetType, item.targetValue)}
        >
            <span className="managed-content-media" aria-hidden="true">
                {item.imageUrl ? (
                    <SafeImage
                        src={item.imageUrl}
                        fallbackSrc={targetProductImage ?? undefined}
                        alt=""
                        imageKind="card"
                        loading="lazy"
                    />
                ) : targetProductImage ? (
                    <SafeImage src={targetProductImage} alt="" imageKind="card" loading="lazy" />
                ) : (
                    <span className="managed-content-placeholder">
                        <LayoutGrid aria-hidden="true" />
                    </span>
                )}
            </span>
            <span className="managed-content-copy">
                <span>
                    <strong>{item.label}</strong>
                    {item.description && <small>{item.description}</small>}
                </span>
                {!disabled && <ChevronRight aria-hidden="true" />}
            </span>
        </button>
    );
}
