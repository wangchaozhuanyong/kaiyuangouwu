import { useNavigate } from '@tanstack/react-router';
import {
    Check,
    ChevronRight,
    CircleCheck,
    Clock3,
    Download,
    Flame,
    LayoutGrid,
    Package,
    RotateCcw,
    Sparkles,
    Tag,
    Truck,
} from 'lucide-react';
import { useEffect, useState } from 'react';

import { selectManagedProducts } from '../home-merchandising';
import { storefrontWebpUrl } from '../responsive-image';
import { StorefrontCouponCard } from '../storefront-coupons';
import { routePath } from '../storefront-router';
import {
    MarketConfig,
    Product,
    ProductVariant,
    StorefrontContentBlock,
    StorefrontContentItem,
    StorefrontContentTargetType,
    StorefrontFlashSale,
    StorefrontFlashSaleItem,
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
    const effectiveUrl = url ? storefrontWebpUrl(url, 'thumbnail') : '/storefront/logo.svg';
    return <img className={className} src={effectiveUrl} alt={name} />;
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
    const isZh = language === 'zh';
    const [claimingId, setClaimingId] = useState<string | null>(null);
    const handleClaim = async (coupon: StorefrontCouponCard) => {
        if (!coupon.claimable || claimingId) return;
        setClaimingId(coupon.id);
        const error = await onClaim(coupon.campaignId);
        setClaimingId(null);
        if (error && onToast) onToast(error);
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
                    const isClaimed = coupon.claimed;
                    const canClaim = coupon.claimable;

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
                                <div className="coupon-ticket-value">
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

                            <div className="coupon-ticket-divider" aria-hidden="true">
                                <span className="coupon-notch coupon-notch-top" />
                                <span className="coupon-notch-line" />
                                <span className="coupon-notch-bottom" />
                            </div>

                            <div className="coupon-ticket-action">
                                <button
                                    type="button"
                                    className={`coupon-claim-btn ${!canClaim ? 'is-claimed' : ''}`}
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
                                    {!canClaim ? (
                                        <span className="coupon-btn-text-wrap">
                                            <Check size={12} strokeWidth={2.8} aria-hidden="true" />
                                            <span>
                                                {isZh
                                                    ? isClaimed
                                                        ? '已领'
                                                        : '已领完'
                                                    : isClaimed
                                                      ? 'Got'
                                                      : 'Ended'}
                                            </span>
                                        </span>
                                    ) : (
                                        <span className="coupon-btn-text-wrap">
                                            {isZh ? (
                                                <>
                                                    <span>{isClaimed ? '再领' : '立即'}</span>
                                                    <span>{isClaimed ? '一张' : '领取'}</span>
                                                </>
                                            ) : (
                                                <span>Claim</span>
                                            )}
                                        </span>
                                    )}
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>
        </section>
    );
}

export function FlashSaleSection({
    title,
    subtitle,
    items,
    locale,
    language,
    endsAt,
    onMore,
    onProduct,
}: {
    title: string;
    subtitle?: string;
    items: StorefrontFlashSaleItem[];
    locale: string;
    language: StorefrontLanguage;
    endsAt: string | null;
    onMore?: () => void;
    onProduct: (productId: string) => void;
}) {
    const isZh = language === 'zh';
    const countdown = useFlashSaleCountdown(endsAt, language);
    if (!items.length) return null;
    return (
        <section className="content-section flash-sale-section">
            <SectionHeader
                title={title}
                subtitle={subtitle}
                action={onMore ? (isZh ? '更多' : 'More') : undefined}
                onAction={onMore}
            />
            {countdown ? (
                <div className="flash-sale-countdown" role="timer">
                    <Clock3 aria-hidden="true" />
                    <span>{isZh ? '距结束' : 'Ends in'}</span>
                    <strong>{countdown}</strong>
                </div>
            ) : null}
            <div className="flash-sale-grid">
                {items.map(item => (
                    <button
                        type="button"
                        className="flash-sale-card"
                        key={item.productVariantId}
                        onClick={() => onProduct(item.productId)}
                        aria-label={`${isZh ? '查看秒杀商品' : 'View flash-sale product'} ${item.productName}`}
                    >
                        <span className="flash-sale-image">
                            {item.imageUrl ? (
                                <SafeImage src={item.imageUrl} alt="" imageKind="card" loading="lazy" />
                            ) : (
                                <span className="image-placeholder" aria-hidden="true">
                                    <Package />
                                </span>
                            )}
                            <em>{isZh ? '限时价' : 'Limited price'}</em>
                        </span>
                        <strong className="flash-sale-name">{item.productName}</strong>
                        <small>{item.variantName}</small>
                        <span className="flash-sale-price">
                            <b>{formatMoney(item.salePrice, item.currencyCode, locale)}</b>
                            <del>{formatMoney(item.originalPrice, item.currencyCode, locale)}</del>
                        </span>
                    </button>
                ))}
            </div>
        </section>
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
    onProduct: (productId: string) => void;
}) {
    const isZh = language === 'zh';
    const items = sales
        .flatMap(sale => sale.items)
        .filter(
            (item, index, allItems) =>
                allItems.findIndex(candidate => candidate.productVariantId === item.productVariantId) ===
                index,
        );
    return (
        <Subpage title={isZh ? '限时秒杀' : 'Flash sale'} language={language} onBack={onBack}>
            {items.length ? (
                <FlashSaleSection
                    title={sales[0]?.name || (isZh ? '限时秒杀' : 'Flash sale')}
                    subtitle={
                        isZh
                            ? '活动价格会在购物车和结算页自动生效'
                            : 'Sale prices apply automatically in cart and checkout'
                    }
                    items={items}
                    locale={locale}
                    language={language}
                    endsAt={sales[0]?.endsAt ?? null}
                    onProduct={onProduct}
                />
            ) : (
                <EmptyState
                    icon={<Flame />}
                    title={isZh ? '暂无进行中的秒杀' : 'No active flash sale'}
                    detail={
                        isZh
                            ? '请留意首页和店铺公告中的下次活动'
                            : 'Check the home page and store announcements for the next event'
                    }
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
    addingVariantId,
    onBack,
    onProduct,
    onAdd,
}: {
    products: Product[];
    block?: StorefrontContentBlock;
    market: MarketConfig;
    locale: string;
    language: StorefrontLanguage;
    addingVariantId: string | null;
    onBack: () => void;
    onProduct: (product: Product) => void;
    onAdd: (variant: ProductVariant) => void;
}) {
    const isZh = language === 'zh';
    return (
        <Subpage
            title={block?.title || (isZh ? '猜你喜欢' : 'You may also like')}
            language={language}
            onBack={onBack}
        >
            {products.length ? (
                <ProductSection
                    subtitle={
                        block?.subtitle ||
                        (isZh
                            ? '结合你的购买品类和浏览记录推荐'
                            : 'Based on your purchase categories and browsing history')
                    }
                    products={products}
                    market={market}
                    locale={locale}
                    addingVariantId={addingVariantId}
                    onProduct={onProduct}
                    onAdd={onAdd}
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
    if (!block.items.length) return null;
    const template = dualCardTemplateSetting(block.settings);

    return (
        <section
            className="home-dual-showcase"
            data-card-template={template}
            aria-label={block.title || (isZh ? '核心品类精选' : 'Core Categories')}
        >
            {block.items.slice(0, 2).map(item => {
                const disabled = item.targetType === 'NONE' || !item.targetValue;
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
                        className={`showcase-card${item.imageUrl ? ' has-managed-image' : ''}`}
                        disabled={disabled}
                        style={
                            item.imageUrl
                                ? {
                                      backgroundImage: [
                                          'linear-gradient(145deg, rgba(12, 25, 41, 0.88), rgba(15, 23, 42, 0.78))',
                                          `url(${JSON.stringify(storefrontWebpUrl(item.imageUrl, 'card'))})`,
                                      ].join(', '),
                                      backgroundPosition: 'center',
                                      backgroundSize: 'cover',
                                  }
                                : undefined
                        }
                        onClick={() => onContentTarget(item.targetType, item.targetValue)}
                    >
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
    const sourceKey = `${field}Zh`;
    const preferred = settings?.[preferredKey];
    const source = settings?.[sourceKey];
    if (typeof preferred === 'string' && preferred.trim()) return preferred.trim();
    if (typeof source === 'string' && source.trim()) return source.trim();
    return fallback;
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
                    <strong>{isZh ? '售后入口' : 'After-sales'}</strong>
                    <small>{isZh ? '可在订单内提交申请' : 'Request support from an order'}</small>
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
                backgroundColor: block.backgroundColor ?? undefined,
                color: block.textColor ?? undefined,
            }}
        >
            <SectionHeader
                title={block.title}
                subtitle={block.subtitle}
                action={blockHasTarget ? block.ctaLabel || undefined : undefined}
                onAction={
                    blockHasTarget ? () => onContentTarget(block.targetType, block.targetValue) : undefined
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
