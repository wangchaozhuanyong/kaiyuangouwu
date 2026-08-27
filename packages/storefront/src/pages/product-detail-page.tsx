import { useNavigate, useRouter } from '@tanstack/react-router';
import {
    CircleCheck,
    Heart,
    Package,
    RotateCcw,
    Share2,
    ShoppingCart,
    TicketPercent,
    Truck,
} from 'lucide-react';
import { Suspense, useEffect, useState } from 'react';
import type { RouteState } from '../storefront-router';

import { ShopApi } from '../api';
import { LazySharePosterModal } from '../lazy-storefront-pages';
import { ProductReviewsSection } from '../review-pages';
import { productDescriptionText, sanitizeProductDescription } from '../rich-text';
import { routeNavigateOptions } from '../storefront-router';
import { SubHeader } from '../storefront-ui/page-shell';
import {
    formatMoney,
    prefetchStorefrontImage,
    productImage,
    SafeImage,
    scheduleIdleWork,
} from '../storefront-ui/product-display';
import { ProductSection } from '../storefront-ui/product-section';
import { useStorefront } from '../StorefrontContext';
import {
    DigitalDeliveryMode,
    MarketConfig,
    Product,
    ProductVariant,
    StorefrontFlashSaleItem,
    StorefrontLanguage,
} from '../types';

// TODO: Fix internal imports later

interface ProductDetailPageProps {
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
    addingVariantId: string | null;
    favorite: boolean;
    onAdd: (variant: ProductVariant) => void;
    onBuyNow: (variant: ProductVariant) => void;
    onFavorite: () => void;
    onNotify: (message: string) => void;
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
        addingVariantId,
        favorite,
        onAdd,
        onBuyNow,
        onFavorite,
        onNotify,
    } = useStorefront<ProductDetailPageProps>();
    const isZh = language === 'zh';
    const [variantId, setVariantId] = useState(product.variants[0]?.id ?? '');
    const [activeImage, setActiveImage] = useState(0);
    const [headerScrolled, setHeaderScrolled] = useState(false);
    const variant = product.variants.find(item => item.id === variantId) ?? product.variants[0];
    const activeFlashItem = flashSaleItems.find(item => item.productVariantId === variant?.id);
    const assets = product.assets.length
        ? product.assets
        : product.featuredAsset
          ? [product.featuredAsset]
          : [];
    const isDigital = variant?.customFields.fulfillmentType === 'digital';
    const digitalDeliveryMode: DigitalDeliveryMode =
        variant?.customFields.digitalDeliveryMode ?? 'manual_service';
    const isAutoCard = isDigital && digitalDeliveryMode === 'auto_card';
    const isFileDownload = isDigital && digitalDeliveryMode === 'file_download';
    const unavailable =
        !variant ||
        (variant.customFields.fulfillmentType === 'physical' && variant.stockLevel === 'OUT_OF_STOCK') ||
        (isAutoCard && (variant.autoCardAvailableStock ?? 0) < 1);
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

    const prefetchAdjacentGalleryImages = () => {
        scheduleIdleWork(() => {
            for (const index of [activeImage - 1, activeImage + 1]) {
                const asset = assets[index];
                if (asset) prefetchStorefrontImage(asset.preview, 'detail');
            }
        });
    };

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
            <section className="detail-gallery">
                {assets[activeImage] ? (
                    <SafeImage
                        src={assets[activeImage].preview}
                        alt={`${product.name} ${activeImage + 1}`}
                        imageKind="detail"
                        placeholderSrc={productImage(product) ?? undefined}
                        loading="eager"
                        fetchPriority="high"
                        onLoad={prefetchAdjacentGalleryImages}
                    />
                ) : (
                    <div className="image-placeholder" aria-hidden="true">
                        <Package />
                    </div>
                )}
                {assets.length > 1 && (
                    <div className="gallery-dots">
                        {assets.map((asset, index) => (
                            <button
                                type="button"
                                key={asset.id}
                                className={index === activeImage ? 'is-active' : undefined}
                                onClick={() => setActiveImage(index)}
                                aria-label={
                                    isZh ? `查看第${index + 1}张商品图` : `View product image ${index + 1}`
                                }
                                aria-current={index === activeImage}
                            />
                        ))}
                    </div>
                )}
                {!!assets.length && (
                    <span className="gallery-count">
                        {activeImage + 1} / {assets.length}
                    </span>
                )}
            </section>
            <section className="detail-summary">
                <div className="detail-price-line">
                    <p className={`detail-price${activeFlashItem ? ' is-flash-sale' : ''}`}>
                        <strong>
                            {activeFlashItem
                                ? formatMoney(activeFlashItem.salePrice, activeFlashItem.currencyCode, locale)
                                : variant
                                  ? formatMoney(variant.priceWithTax, variant.currencyCode, locale)
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
                    <span>
                        {unavailable
                            ? isZh
                                ? '暂时无法购买'
                                : 'Unavailable'
                            : isAutoCard
                              ? isZh
                                  ? `可用 ${variant?.autoCardAvailableStock ?? 0} 份`
                                  : `${variant?.autoCardAvailableStock ?? 0} available`
                              : isDigital
                                ? isZh
                                    ? '可在线购买'
                                    : 'Available online'
                                : isZh
                                  ? '库存充足'
                                  : 'In stock'}
                    </span>
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
                                    ? '付款后由商家处理并通知'
                                    : 'Processed and updated by the merchant after payment'
                                : isZh
                                  ? '运费结算页计算'
                                  : 'Shipping at checkout'}
                    </span>
                </div>
                <h1>{product.name}</h1>
                <p>{descriptionText || (isZh ? '暂无更多商品说明' : 'No additional description')}</p>
            </section>
            <section className="detail-promotions">
                <div>
                    <span>{isZh ? '优惠' : 'Offers'}</span>
                    <strong>
                        <TicketPercent />
                        {isZh ? '可用优惠将在结算时自动抵扣' : 'Eligible offers apply automatically'}
                    </strong>
                </div>
                <div>
                    <span>{isZh ? '活动' : 'Activity'}</span>
                    <strong>
                        {activeFlashItem
                            ? isZh
                                ? '限时秒杀价已生效，结算时自动核对'
                                : 'Flash-sale price is active and verified at checkout'
                            : isZh
                              ? '店铺活动以结算页展示为准'
                              : 'Store promotions are confirmed at checkout'}
                    </strong>
                </div>
            </section>
            <section className="detail-options">
                <header>
                    <strong>{isZh ? '选择规格' : 'Choose an option'}</strong>
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
            </section>
            <div className="detail-info-row">
                <span>{isDigital ? (isZh ? '获取方式' : 'Access') : isZh ? '送至' : 'Deliver to'}</span>
                <strong>
                    {isAutoCard
                        ? isZh
                            ? '付款后系统按号池顺序发送到下单邮箱'
                            : 'Credentials are assigned in sequence and emailed after payment'
                        : isFileDownload
                          ? isZh
                              ? '付款后在订单中获取文件下载入口'
                              : 'Get the file download from your order after payment'
                          : isDigital
                            ? isZh
                                ? '付款后由商家处理，进度与结果通过订单和邮箱通知'
                                : 'The merchant processes it after payment and sends order and email updates'
                            : isZh
                              ? '结算页选择收货地址并确认时效'
                              : 'Choose an address and confirm timing at checkout'}
                </strong>
            </div>
            <section className={`detail-service-bar${isZh ? '' : ' has-long-copy'}`}>
                <span>
                    <CircleCheck />
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
                    <Truck />
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
                    <RotateCcw />
                    {isAutoCard
                        ? isZh
                            ? '发卡后不支持退款'
                            : 'Non-refundable after delivery'
                        : isZh
                          ? '售后支持'
                          : 'Returns support'}
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
                        <dd>
                            {unavailable
                                ? isZh
                                    ? '暂时缺货'
                                    : 'Unavailable'
                                : isZh
                                  ? '库存充足'
                                  : 'In stock'}
                        </dd>
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
                products={similarProducts}
                market={market}
                locale={locale}
                addingVariantId={addingVariantId}
                onProduct={item => navigateTo({ name: 'product', id: item.id })}
                onAdd={item => onAdd(item)}
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
                    {addingVariantId === variant?.id
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
                            ? '暂时缺货'
                            : 'Unavailable'
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
