import { useNavigate, useRouter } from '@tanstack/react-router';
import { ChevronRight, CircleCheck, Heart, RotateCcw, Share2, ShoppingCart, Truck } from 'lucide-react';
import { Suspense, useEffect, useState } from 'react';

import { ShopApi } from '../api';
import { LazySharePosterModal } from '../lazy-storefront-pages';
import { productAvailability, productAvailabilityLabel } from '../product-availability';
import { productGalleryAssets } from '../product-media';
import { ProductReviewsSection } from '../review-pages';
import { productDescriptionText, sanitizeProductDescription } from '../rich-text';
import { bestProductCouponPrice } from '../storefront-coupons';
import { ProductDetailPageContext } from '../storefront-page-contexts';
import { routeNavigateOptions, type RouteState } from '../storefront-router';
import { SubHeader } from '../storefront-ui/page-shell';
import { formatMoney, SafeImage } from '../storefront-ui/product-display';
import { ProductGallery } from '../storefront-ui/product-gallery';
import { ProductSection } from '../storefront-ui/product-section';
import {
    DigitalDeliveryMode,
    MarketConfig,
    Product,
    ProductVariant,
    StoreCustomerCoupon,
    StorefrontCouponCampaign,
    StorefrontFlashSaleItem,
    StorefrontLanguage,
} from '../types';

// TODO: Fix internal imports later

export interface ProductDetailPageProps {
    api: ShopApi;
    product: Product;
    products: Product[];
    cartQuantity: number;
    market: MarketConfig;
    locale: string;
    language: StorefrontLanguage;
    storefrontName: string;
    logoUrl: string | null;
    flashSaleItems: StorefrontFlashSaleItem[];
    couponCampaigns: StorefrontCouponCampaign[];
    customerCoupons: StoreCustomerCoupon[];
    addingVariantId: string | null;
    favorite: boolean;
    onAdd: (variant: ProductVariant) => void;
    onBuyNow: (variant: ProductVariant) => void;
    onFavorite: () => void;
    onNotify: (message: string) => void;
}

function formatManualDeliverySla(minutesInput: number, isZh: boolean): string {
    const minutes = Math.max(5, Math.trunc(minutesInput));
    if (minutes % 1440 === 0) {
        const days = minutes / 1440;
        return isZh ? `${days}天` : `${days} ${days === 1 ? 'day' : 'days'}`;
    }
    if (minutes % 60 === 0) {
        const hours = minutes / 60;
        return isZh ? `${hours}小时` : `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
    }
    return isZh ? `${minutes}分钟` : `${minutes} minutes`;
}

export function ProductDetailPage() {
    const navigate = useNavigate();
    const navigateTo = (route: RouteState) => void navigate(routeNavigateOptions(route) as never);
    const router = useRouter();
    const goBack = () => router.history.back();
    const {
        api,
        product,
        products,
        cartQuantity,
        market,
        locale,
        language,
        storefrontName,
        logoUrl,
        flashSaleItems,
        couponCampaigns,
        customerCoupons,
        addingVariantId,
        favorite,
        onAdd,
        onBuyNow,
        onFavorite,
        onNotify,
    } = ProductDetailPageContext.useValue();
    const isZh = language === 'zh';
    const [variantId, setVariantId] = useState(product.variants[0]?.id ?? '');
    const [headerScrolled, setHeaderScrolled] = useState(false);
    const variant = product.variants.find(item => item.id === variantId) ?? product.variants[0];
    const activeFlashItem = flashSaleItems.find(item => item.productVariantId === variant?.id);
    const displayedPrice = activeFlashItem?.salePrice ?? variant?.priceWithTax ?? null;
    const displayedCurrencyCode =
        activeFlashItem?.currencyCode ?? variant?.currencyCode ?? market.currencyCode;
    const couponPrice =
        variant && displayedPrice != null
            ? bestProductCouponPrice({
                  campaigns: couponCampaigns,
                  customerCoupons,
                  collectionIds: product.collections.map(collection => collection.id),
                  productVariantId: variant.id,
                  priceWithTax: displayedPrice,
                  currencyCode: displayedCurrencyCode,
              })
            : null;
    const assets = productGalleryAssets(product);
    const isDigital =
        (product.customFields?.fulfillmentType ?? variant?.customFields.fulfillmentType) === 'digital';
    const digitalDeliveryMode: DigitalDeliveryMode =
        variant?.customFields.digitalDeliveryMode ?? 'manual_service';
    const isAutoCard = isDigital && digitalDeliveryMode === 'auto_card';
    const isFileDownload = isDigital && digitalDeliveryMode === 'file_download';
    const availability = productAvailability(variant);
    const stockLabel = productAvailabilityLabel(availability, language);
    const packaging = !isDigital && product.packaging?.enabled ? product.packaging : null;
    const refundPolicy = product.customFields?.refundPolicy ?? 'MERCHANT_REVIEW';
    const manualSlaText = formatManualDeliverySla(
        product.customFields?.manualDeliverySlaMinutes ?? 1440,
        isZh,
    );
    const isUnitVariant = packaging?.unitVariant.id === variant?.id;
    const isPackageVariant = packaging?.packageVariant.id === variant?.id;
    const unavailable = !variant || availability.soldOut;
    const similarProducts = products.filter(item => item.id !== product.id).slice(0, 4);
    const descriptionText = productDescriptionText(product.description);
    const descriptionHtml = sanitizeProductDescription(product.description);
    const [posterOpen, setPosterOpen] = useState(false);
    const shareProduct = () => {
        setPosterOpen(true);
    };

    useEffect(() => {
        const updateHeader = () => setHeaderScrolled(window.scrollY > 16);
        updateHeader();
        window.addEventListener('scroll', updateHeader, { passive: true });
        return () => window.removeEventListener('scroll', updateHeader);
    }, []);

    return (
        <main className="page subpage product-detail-page">
            <SubHeader
                className={`product-detail-header${headerScrolled ? ' is-scrolled' : ''}`}
                title={isZh ? '商品详情' : 'Product details'}
                language={language}
                onBack={goBack}
                action={
                    <button
                        type="button"
                        onClick={() => void shareProduct()}
                        aria-label={isZh ? '分享' : 'Share'}
                    >
                        <Share2 />
                    </button>
                }
            />
            <ProductGallery product={product} language={language} />
            <section className="detail-summary">
                <div className="detail-price-line">
                    <div className="detail-price-stack">
                        <p className={`detail-price${activeFlashItem ? ' is-flash-sale' : ''}`}>
                            <strong>
                                {displayedPrice != null
                                    ? formatMoney(displayedPrice, displayedCurrencyCode, locale)
                                    : '--'}
                            </strong>
                            {activeFlashItem ? (
                                <del>
                                    {formatMoney(
                                        activeFlashItem.originalPrice,
                                        activeFlashItem.currencyCode,
                                        locale,
                                    )}
                                </del>
                            ) : null}
                        </p>
                        {couponPrice ? (
                            <button
                                type="button"
                                className="detail-coupon-price"
                                onClick={() => navigateTo({ name: 'coupons' })}
                                aria-label={
                                    isZh
                                        ? `查看优惠券，券后价 ${formatMoney(couponPrice.priceWithTax, displayedCurrencyCode, locale)}`
                                        : `View coupon, price after coupon ${formatMoney(couponPrice.priceWithTax, displayedCurrencyCode, locale)}`
                                }
                            >
                                <span>{isZh ? '券后' : 'With coupon'}</span>
                                <strong>
                                    {formatMoney(couponPrice.priceWithTax, displayedCurrencyCode, locale)}
                                </strong>
                                <ChevronRight aria-hidden="true" />
                            </button>
                        ) : null}
                    </div>
                    <span>{stockLabel}</span>
                </div>
                <div className="detail-tags">
                    <span>
                        {isAutoCard
                            ? isZh
                                ? '虚拟商品 · 自动发卡'
                                : 'Digital · automatic credentials'
                            : isFileDownload
                              ? isZh
                                  ? '数字商品 · 文件下载'
                                  : 'Digital · file download'
                              : isDigital
                                ? isZh
                                    ? '数字商品 · 人工服务'
                                    : 'Digital · manual service'
                                : isZh
                                  ? '现货商品'
                                  : 'Physical'}
                    </span>
                    <span>
                        {isAutoCard
                            ? isZh
                                ? '付款成功后发送到下单邮箱'
                                : 'Emailed automatically after payment'
                            : isFileDownload
                              ? isZh
                                  ? '付款后可在订单中下载'
                                  : 'Download from your order after payment'
                              : isDigital
                                ? isZh
                                    ? `付款后由商家处理，预计${manualSlaText}内发送至邮箱`
                                    : `Merchant processed and emailed within ${manualSlaText}`
                                : isZh
                                  ? '运费结算页计算'
                                  : 'Shipping at checkout'}
                    </span>
                </div>
                <h1>{product.name}</h1>
                <p>{descriptionText || (isZh ? '暂无更多商品说明' : 'No additional description')}</p>
            </section>
            <section className="detail-options">
                <header>
                    <strong>{isZh ? '选择规格' : 'Choose an option'}</strong>
                    <span>
                        {isZh
                            ? `${product.variants.length} 个规格可选`
                            : `${product.variants.length} ${product.variants.length === 1 ? 'option' : 'options'}`}
                    </span>
                </header>
                <div>
                    {product.variants.map(item => (
                        <button
                            type="button"
                            key={item.id}
                            className={item.id === variant?.id ? 'is-active' : undefined}
                            onClick={() => setVariantId(item.id)}
                        >
                            {item.name}
                        </button>
                    ))}
                </div>
                {packaging && (
                    <p className="detail-packaging-note">
                        <strong>
                            1 {packaging.packageLabel} = {packaging.unitsPerPackage} {packaging.unitLabel}
                        </strong>
                        <span>
                            {isPackageVariant
                                ? isZh
                                    ? `当前按${packaging.packageLabel}价结算，库存按${packaging.packageLabel}扣减。`
                                    : `This option uses the package price and deducts package stock.`
                                : isUnitVariant
                                  ? packaging.autoUnpack
                                      ? isZh
                                          ? `当前按${packaging.unitLabel}计价；散件不足时，系统自动拆最少数量的整${packaging.packageLabel}补充库存。`
                                          : `Priced per ${packaging.unitLabel}; when loose stock is short, the minimum number of packages is opened automatically.`
                                      : isZh
                                        ? `当前按${packaging.unitLabel}计价，库存按散件扣减。`
                                        : `Priced per ${packaging.unitLabel} and deducted from loose stock.`
                                  : isZh
                                    ? `包装换算仅适用于“${packaging.unitVariant.name}”和“${packaging.packageVariant.name}”。`
                                    : `Packaging conversion applies to ${packaging.unitVariant.name} and ${packaging.packageVariant.name}.`}
                        </span>
                    </p>
                )}
            </section>
            <section
                className="detail-service-bar"
                aria-label={isZh ? '商品服务说明' : 'Product service details'}
            >
                <span>
                    <CircleCheck aria-hidden="true" />
                    {isAutoCard
                        ? isZh
                            ? '邮箱自动发卡'
                            : 'Automatic email delivery'
                        : isFileDownload
                          ? isZh
                              ? '安全文件下载'
                              : 'Secure file download'
                          : isDigital
                            ? isZh
                                ? '人工数字服务'
                                : 'Manual digital service'
                            : isZh
                              ? '下单信息'
                              : 'Order details'}
                </span>
                <span>
                    <Truck aria-hidden="true" />
                    {isDigital
                        ? isAutoCard
                            ? isZh
                                ? '自动交付'
                                : 'Automatic delivery'
                            : isFileDownload
                              ? isZh
                                  ? '支付后下载'
                                  : 'Download after payment'
                              : isZh
                                ? '商家处理'
                                : 'Merchant processed'
                        : isZh
                          ? '配送可追踪'
                          : 'Tracked delivery'}
                </span>
                <span>
                    <RotateCcw aria-hidden="true" />
                    {refundPolicy === 'NON_REFUNDABLE'
                        ? isZh
                            ? '不支持退款'
                            : 'Non-refundable'
                        : refundPolicy === 'SEVEN_DAY_NO_REASON'
                          ? isZh
                              ? '支持7天无理由'
                              : 'Seven-day no-reason return'
                          : isZh
                            ? '退款需商家审核'
                            : 'Refund subject to review'}
                </span>
            </section>
            <ProductReviewsSection api={api} productId={product.id} market={market} language={language} />
            <section className="detail-block detail-params">
                <header>
                    <strong>{isZh ? '商品参数' : 'Product details'}</strong>
                </header>
                <dl>
                    <div>
                        <dt>{isZh ? '类型' : 'Type'}</dt>
                        <dd>
                            {isAutoCard
                                ? isZh
                                    ? '虚拟自动发卡商品'
                                    : 'Automatic credential product'
                                : isFileDownload
                                  ? isZh
                                      ? '数字文件下载商品'
                                      : 'Digital file download'
                                  : isDigital
                                    ? isZh
                                        ? '人工数字服务'
                                        : 'Manual digital service'
                                    : isZh
                                      ? '普通商品'
                                      : 'Physical'}
                        </dd>
                    </div>
                    <div>
                        <dt>{isZh ? '规格' : 'Variant'}</dt>
                        <dd>{variant?.name ?? '--'}</dd>
                    </div>
                    <div>
                        <dt>{isZh ? '库存' : 'Stock'}</dt>
                        <dd>{stockLabel}</dd>
                    </div>
                    <div>
                        <dt>{isZh ? '交付' : 'Delivery'}</dt>
                        <dd>
                            {isAutoCard
                                ? isZh
                                    ? '付款后邮箱发卡'
                                    : 'Email after payment'
                                : isFileDownload
                                  ? isZh
                                      ? '付款后文件下载'
                                      : 'File download after payment'
                                  : isDigital
                                    ? isZh
                                        ? '商家处理后通知'
                                        : 'Merchant processed with updates'
                                    : isZh
                                      ? '快递配送'
                                      : 'Shipping'}
                        </dd>
                    </div>
                </dl>
            </section>
            <section className="detail-block detail-description">
                <h2>{isZh ? '商品详情' : 'Description'}</h2>
                {descriptionHtml ? (
                    <div className="detail-rich-text" dangerouslySetInnerHTML={{ __html: descriptionHtml }} />
                ) : (
                    <p>
                        {isZh
                            ? '商品详细信息由商家后台维护。'
                            : 'Product information is managed by the merchant.'}
                    </p>
                )}
                {assets[0] && (
                    <SafeImage
                        src={assets[0].preview}
                        alt={isZh ? `${product.name}细节展示` : `${product.name} details`}
                        imageKind="detail"
                        loading="lazy"
                    />
                )}
            </section>
            <ProductSection
                title={isZh ? '相似商品' : 'Similar products'}
                subtitle={isZh ? '继续看看同店好物' : 'More from this store'}
                subtitlePlacement="end"
                products={similarProducts}
                market={market}
                locale={locale}
                language={language}
                onProduct={item => navigateTo({ name: 'product', id: item.id })}
            />
            <div className="detail-action-bar">
                <button
                    className={`detail-favorite-action${favorite ? ' is-active' : ''}`}
                    type="button"
                    aria-pressed={favorite}
                    aria-label={
                        favorite
                            ? isZh
                                ? '取消收藏'
                                : 'Remove from favorites'
                            : isZh
                              ? '收藏商品'
                              : 'Add to favorites'
                    }
                    onClick={() => {
                        onFavorite();
                        onNotify(
                            favorite
                                ? isZh
                                    ? '已取消收藏'
                                    : 'Removed from favorites'
                                : isZh
                                  ? '已收藏'
                                  : 'Added to favorites',
                        );
                    }}
                >
                    <Heart fill={favorite ? 'currentColor' : 'none'} aria-hidden="true" />
                    <span>{favorite ? (isZh ? '已收藏' : 'Saved') : isZh ? '收藏' : 'Save'}</span>
                </button>
                <button type="button" onClick={() => navigateTo({ name: 'cart' })}>
                    <ShoppingCart />
                    <span>{isZh ? '购物车' : 'Cart'}</span>
                    {cartQuantity > 0 && <b>{cartQuantity}</b>}
                </button>
                <button
                    type="button"
                    disabled={unavailable || addingVariantId !== null}
                    onClick={() => variant && onAdd(variant)}
                >
                    {unavailable
                        ? isZh
                            ? '已售罄'
                            : 'Sold out'
                        : addingVariantId === variant?.id
                          ? isZh
                              ? '添加中'
                              : 'Adding'
                          : isZh
                            ? '加入购物车'
                            : 'Add to cart'}
                </button>
                <button
                    type="button"
                    disabled={unavailable || addingVariantId !== null}
                    onClick={() => variant && onBuyNow(variant)}
                >
                    {unavailable
                        ? isZh
                            ? '已售罄'
                            : 'Sold out'
                        : addingVariantId === variant?.id
                          ? isZh
                              ? '准备中'
                              : 'Preparing'
                          : isZh
                            ? '立即购买'
                            : 'Buy now'}
                </button>
            </div>

            {posterOpen && (
                <Suspense
                    fallback={
                        <div className="poster-modal-overlay" role="status" aria-live="polite">
                            <div className="poster-modal-card">
                                <p>{isZh ? '正在加载分享海报…' : 'Loading share poster…'}</p>
                            </div>
                        </div>
                    }
                >
                    <LazySharePosterModal
                        product={product}
                        storefrontName={storefrontName}
                        logoUrl={logoUrl}
                        language={language}
                        formattedPrice={
                            activeFlashItem
                                ? formatMoney(activeFlashItem.salePrice, activeFlashItem.currencyCode, locale)
                                : variant
                                  ? formatMoney(variant.priceWithTax, variant.currencyCode, locale)
                                  : '--'
                        }
                        onClose={() => setPosterOpen(false)}
                        onNotify={onNotify}
                    />
                </Suspense>
            )}
        </main>
    );
}
