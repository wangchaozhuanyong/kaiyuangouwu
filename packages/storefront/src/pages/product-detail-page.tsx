import { useNavigate, useRouter } from '@tanstack/react-router';
import {
    ArrowLeft,
    ChevronRight,
    CircleCheck,
    Heart,
    Minus,
    Plus,
    RotateCcw,
    Share2,
    ShoppingCart,
    Truck,
} from 'lucide-react';
import { Suspense, useEffect, useState } from 'react';

import { ShopApi } from '../api';
import { useDesktopLayout } from '../desktop-layout';
import { LazySharePosterModal } from '../lazy-storefront-pages';
import {
    productAvailability,
    productAvailabilityLabel,
    variantCanIncreaseQuantity,
} from '../product-availability';
import { productGalleryAssets } from '../product-media';
import { lowestPricedProductVariant } from '../product-pricing';
import { ProductReviewsSection } from '../review-pages';
import { productDescriptionText, sanitizeProductDescription } from '../rich-text';
import { preloadStorefrontRouteComponent } from '../route-component-preload';
import { bestProductCouponPrice } from '../storefront-coupons';
import { ProductDetailPageContext } from '../storefront-page-contexts';
import { routeNavigateOptions, type RouteState } from '../storefront-router';
import { SubHeader } from '../storefront-ui/page-shell';
import { formatMoney, SafeImage } from '../storefront-ui/product-display';
import { ProductGallery } from '../storefront-ui/product-gallery';
import { ProductSection } from '../storefront-ui/product-section';
import '../styles/product-detail-surfaces.css';
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
    initialVariantId?: string;
    flashSaleItems: StorefrontFlashSaleItem[];
    couponCampaigns: StorefrontCouponCampaign[];
    customerCoupons: StoreCustomerCoupon[];
    addingVariantId: string | null;
    favorite: boolean;
    onAdd: (variant: ProductVariant, quantity: number) => void;
    onBuyNow: (variant: ProductVariant, quantity: number) => void;
    onFavorite: () => Promise<boolean> | void;
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
        initialVariantId,
        onAdd,
        onBuyNow,
        onFavorite,
        onNotify,
    } = ProductDetailPageContext.useValue();
    const isZh = language === 'zh';
    const initialVariant =
        (initialVariantId && product.variants.find(item => item.id === initialVariantId)) ||
        lowestPricedProductVariant(product);
    const [variantId, setVariantId] = useState(initialVariant?.id ?? '');
    const [quantity, setQuantity] = useState(1);
    const [activeSection, setActiveSection] = useState<'description' | 'reviews' | 'params' | 'after-sales'>(
        'description',
    );
    const [headerScrolled, setHeaderScrolled] = useState(false);
    const [favoritePending, setFavoritePending] = useState(false);

    useEffect(() => {
        setVariantId(initialVariant?.id ?? '');
        setQuantity(1);
        setActiveSection('description');
    }, [initialVariant?.id, product.id]);
    const variant = product.variants.find(item => item.id === variantId) ?? initialVariant;
    const availability = productAvailability(variant);
    const purchaseQuantity = Math.min(quantity, Math.max(1, availability.stock ?? quantity));
    const activeFlashItem = flashSaleItems.find(item => item.productVariantId === variant?.id);
    const displayedPrice = activeFlashItem?.salePrice ?? variant?.priceWithTax ?? null;
    const displayedCurrencyCode =
        activeFlashItem?.currencyCode ?? variant?.currencyCode ?? market.currencyCode;
    const couponPrice =
        variant && displayedPrice != null
            ? bestProductCouponPrice({
                  campaigns: couponCampaigns,
                  customerCoupons,
                  collectionIds: variant.storeCouponCollectionIds ?? [],
                  productVariantId: variant.id,
                  priceWithTax: displayedPrice * purchaseQuantity,
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
    const collectionIds = new Set(product.collections.map(collection => collection.id));
    const similarProducts = products
        .filter(item => item.id !== product.id)
        .sort(
            (a, b) =>
                Number(b.collections.some(collection => collectionIds.has(collection.id))) -
                Number(a.collections.some(collection => collectionIds.has(collection.id))),
        )
        .slice(0, 4);
    const descriptionText = productDescriptionText(product.description);
    const descriptionHtml = sanitizeProductDescription(product.description);
    const [posterOpen, setPosterOpen] = useState(false);
    const shareProduct = () => {
        setPosterOpen(true);
    };

    useEffect(() => {
        let frame = 0;
        const updateHeader = () => {
            frame = 0;
            const next = window.scrollY > 16;
            setHeaderScrolled(current => (current === next ? current : next));
        };
        const scheduleHeaderUpdate = () => {
            if (!frame) frame = window.requestAnimationFrame(updateHeader);
        };
        updateHeader();
        window.addEventListener('scroll', scheduleHeaderUpdate, { passive: true });
        return () => {
            window.removeEventListener('scroll', scheduleHeaderUpdate);
            if (frame) window.cancelAnimationFrame(frame);
        };
    }, []);

    const desktop = useDesktopLayout();
    const couponQuantityLabel = isZh
        ? purchaseQuantity > 1
            ? `${purchaseQuantity}件券后参考合计`
            : '券后价'
        : purchaseQuantity > 1
          ? `estimated total for ${purchaseQuantity} items`
          : 'price after coupon';
    const couponAriaLabel = couponPrice
        ? `${isZh ? '查看优惠券，' : 'View coupon, '}${couponQuantityLabel} ${formatMoney(couponPrice.priceWithTax, displayedCurrencyCode, locale)}`
        : undefined;
    const summary = (
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
                            aria-label={couponAriaLabel}
                        >
                            <span>
                                {isZh
                                    ? purchaseQuantity > 1
                                        ? `${purchaseQuantity}件券后合计`
                                        : '券后'
                                    : purchaseQuantity > 1
                                      ? `${purchaseQuantity} items with coupon`
                                      : 'With coupon'}
                            </span>
                            <strong>
                                {formatMoney(couponPrice.priceWithTax, displayedCurrencyCode, locale)}
                            </strong>
                            <ChevronRight aria-hidden="true" />
                        </button>
                    ) : null}
                    {couponPrice && (
                        <small className="detail-coupon-note">
                            {isZh
                                ? '按本次商品与数量估算，实际优惠以结算页为准'
                                : 'Estimated for these items; checkout confirms the final discount'}
                        </small>
                    )}
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
    );
    const options = (
        <section className="detail-options">
            <header>
                <strong>{isZh ? '选择规格' : 'Choose an option'}</strong>
                <span>
                    {isZh
                        ? `${product.variants.length} 个规格可选`
                        : `${product.variants.length} ${product.variants.length === 1 ? 'option' : 'options'}`}
                </span>
            </header>
            <div className="detail-variant-grid" role="group" aria-label={isZh ? '规格选项' : 'Options'}>
                {product.variants.map(item => {
                    const itemAvailability = productAvailability(item);
                    const sale = flashSaleItems.find(saleItem => saleItem.productVariantId === item.id);
                    const selected = item.id === variant?.id;
                    return (
                        <button
                            type="button"
                            key={item.id}
                            className={`detail-variant-choice${selected ? ' is-active' : ''}${itemAvailability.soldOut ? ' is-sold-out' : ''}`}
                            aria-pressed={selected}
                            onClick={() => {
                                setVariantId(item.id);
                                setQuantity(1);
                            }}
                        >
                            <span className="detail-variant-name">{item.name}</span>
                            <span className="detail-variant-bottom">
                                <strong className="detail-variant-price">
                                    {formatMoney(
                                        sale?.salePrice ?? item.priceWithTax,
                                        sale?.currencyCode ?? item.currencyCode,
                                        locale,
                                    )}
                                </strong>
                                <small>{productAvailabilityLabel(itemAvailability, language)}</small>
                            </span>
                            {selected && (
                                <CircleCheck className="detail-variant-selected" aria-hidden="true" />
                            )}
                        </button>
                    );
                })}
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
    );
    const quantityControl = (
        <section className="detail-quantity" aria-label={isZh ? '购买数量' : 'Purchase quantity'}>
            <strong>{isZh ? '购买数量' : 'Quantity'}</strong>
            <div className="detail-quantity-controls">
                <button
                    type="button"
                    aria-label={isZh ? '减少数量' : 'Decrease quantity'}
                    disabled={unavailable || purchaseQuantity <= 1 || addingVariantId !== null}
                    onClick={() => setQuantity(Math.max(1, purchaseQuantity - 1))}
                >
                    <Minus aria-hidden="true" />
                </button>
                <output aria-live="polite">{purchaseQuantity}</output>
                <button
                    type="button"
                    aria-label={isZh ? '增加数量' : 'Increase quantity'}
                    disabled={
                        unavailable ||
                        !variant ||
                        !variantCanIncreaseQuantity(variant, purchaseQuantity) ||
                        addingVariantId !== null
                    }
                    onClick={() => setQuantity(purchaseQuantity + 1)}
                >
                    <Plus aria-hidden="true" />
                </button>
            </div>
            <span>{stockLabel}</span>
        </section>
    );
    const services = (
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
    );
    const actions = (
        <div className="detail-action-bar page-action-bar">
            <button
                className={`detail-favorite-action${favorite ? ' is-active' : ''}`}
                type="button"
                disabled={favoritePending}
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
                    setFavoritePending(true);
                    void Promise.resolve(onFavorite())
                        .then(ok => {
                            if (ok !== false)
                                onNotify(
                                    favorite
                                        ? isZh
                                            ? '已取消收藏'
                                            : 'Removed from favorites'
                                        : isZh
                                          ? '已收藏'
                                          : 'Added to favorites',
                                );
                        })
                        .catch(() => undefined)
                        .finally(() => setFavoritePending(false));
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
                onClick={() => variant && onAdd(variant, purchaseQuantity)}
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
                onPointerEnter={() => void preloadStorefrontRouteComponent('purchase')}
                onFocus={() => void preloadStorefrontRouteComponent('purchase')}
                onTouchStart={() => void preloadStorefrontRouteComponent('purchase')}
                onClick={() => variant && onBuyNow(variant, purchaseQuantity)}
            >
                {unavailable
                    ? isZh
                        ? '已售罄'
                        : 'Sold out'
                    : addingVariantId === variant?.id
                      ? isZh
                          ? '正在进入结算'
                          : 'Opening checkout'
                      : isZh
                        ? '立即购买'
                        : 'Buy now'}
            </button>
        </div>
    );

    return (
        <main className="page subpage product-detail-page">
            {desktop ? (
                <nav
                    className="desktop-product-toolbar"
                    aria-label={isZh ? '商品详情导航' : 'Product details navigation'}
                >
                    <div className="desktop-product-toolbar-path">
                        <button type="button" onClick={goBack} className="desktop-product-toolbar-back">
                            <ArrowLeft aria-hidden="true" />
                            <span>{isZh ? '返回商品列表' : 'Back to products'}</span>
                        </button>
                        <span className="desktop-product-toolbar-divider" aria-hidden="true" />
                        <span className="desktop-product-toolbar-current" aria-current="page">
                            {isZh ? '商品详情' : 'Product details'}
                        </span>
                    </div>
                    <button
                        type="button"
                        onClick={() => void shareProduct()}
                        className="desktop-product-toolbar-share"
                        aria-label={isZh ? '分享' : 'Share'}
                    >
                        <Share2 aria-hidden="true" />
                        <span>{isZh ? '分享' : 'Share'}</span>
                    </button>
                </nav>
            ) : (
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
            )}
            {desktop ? (
                <div className="desktop-product-purchase">
                    <ProductGallery product={product} language={language} />
                    <div className="desktop-product-buying">
                        {summary}
                        {options}
                        {quantityControl}
                        {services}
                        {actions}
                    </div>
                </div>
            ) : (
                <>
                    <ProductGallery product={product} language={language} />
                    {summary}
                    {options}
                    {quantityControl}
                    {services}
                </>
            )}
            {desktop && (
                <nav className="detail-content-tabs" aria-label={isZh ? '商品信息' : 'Product information'}>
                    {(
                        [
                            ['description', isZh ? '商品详情' : 'Description'],
                            ['reviews', isZh ? '真实评价' : 'Reviews'],
                            ['params', isZh ? '商品参数' : 'Specifications'],
                            ['after-sales', isZh ? '配送与售后' : 'Delivery and returns'],
                        ] as const
                    ).map(([section, label]) => (
                        <button
                            key={section}
                            type="button"
                            className={activeSection === section ? 'is-active' : undefined}
                            aria-pressed={activeSection === section}
                            onClick={() => setActiveSection(section)}
                        >
                            {label}
                        </button>
                    ))}
                </nav>
            )}
            {(!desktop || activeSection === 'reviews') && (
                <ProductReviewsSection api={api} productId={product.id} market={market} language={language} />
            )}
            {(!desktop || activeSection === 'params') && (
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
            )}
            {(!desktop || activeSection === 'description') && (
                <section className="detail-block detail-description">
                    <h2>{isZh ? '商品详情' : 'Description'}</h2>
                    {descriptionHtml ? (
                        <div
                            className="detail-rich-text"
                            dangerouslySetInnerHTML={{ __html: descriptionHtml }}
                        />
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
                            frameClassName="detail-description-media"
                            sizes="(min-width: 1024px) 790px, 100vw"
                            loading="lazy"
                        />
                    )}
                </section>
            )}
            {desktop && activeSection === 'after-sales' && (
                <section className="detail-block detail-after-sales">
                    <h2>{isZh ? '配送与售后说明' : 'Delivery and returns'}</h2>
                    <p>
                        {isDigital
                            ? isAutoCard
                                ? isZh
                                    ? '付款成功后自动发送到下单邮箱。'
                                    : 'Sent to your order email after payment.'
                                : isFileDownload
                                  ? isZh
                                      ? '付款成功后可在订单中下载。'
                                      : 'Download from your order after payment.'
                                  : isZh
                                    ? `付款后由商家处理，预计${manualSlaText}内发送至邮箱。`
                                    : `Merchant processed and emailed within ${manualSlaText}.`
                            : isZh
                              ? '配送方式与运费在结算页按收货地址确认。'
                              : 'Shipping method and fee are confirmed at checkout.'}
                    </p>
                    <p>
                        {refundPolicy === 'NON_REFUNDABLE'
                            ? isZh
                                ? '该商品不支持退款。'
                                : 'This product is non-refundable.'
                            : refundPolicy === 'SEVEN_DAY_NO_REASON'
                              ? isZh
                                  ? '该商品支持 7 天无理由退货，具体条件以订单售后规则为准。'
                                  : 'Seven-day returns apply subject to the order policy.'
                              : isZh
                                ? '退款申请由商家审核，具体结果以售后处理为准。'
                                : 'Refund requests are reviewed by the merchant.'}
                    </p>
                    <button type="button" onClick={() => navigateTo({ name: 'support' })}>
                        {isZh ? '咨询客服' : 'Contact support'}
                        <ChevronRight aria-hidden="true" />
                    </button>
                </section>
            )}
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
            {!desktop && actions}

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
