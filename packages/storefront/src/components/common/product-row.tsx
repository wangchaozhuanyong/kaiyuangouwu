import { Plus } from 'lucide-react';

import {
    prefetchProductAsset,
    PriceDisplay,
    ProductImage,
    trimText,
} from '../../storefront-ui/product-display';
import { DigitalDeliveryMode, MarketConfig, Product, StorefrontLanguage } from '../../types';

// TODO: Fix internal imports later

export function ProductRow({
    product,
    market,
    locale,
    language,
    adding,
    onOpen,
    onAdd,
}: {
    product: Product;
    market: MarketConfig;
    locale: string;
    language: StorefrontLanguage;
    adding: boolean;
    onOpen: () => void;
    onAdd: () => void;
}) {
    const isZh = language === 'zh';
    const variant = product.variants[0];
    const digitalDeliveryMode: DigitalDeliveryMode =
        variant?.customFields.digitalDeliveryMode ?? 'manual_service';
    const isAutoCard =
        variant?.customFields.fulfillmentType === 'digital' && digitalDeliveryMode === 'auto_card';
    const isFileDownload =
        variant?.customFields.fulfillmentType === 'digital' && digitalDeliveryMode === 'file_download';
    const isOutOfStock =
        (variant?.customFields.fulfillmentType === 'physical' && variant.stockLevel === 'OUT_OF_STOCK') ||
        (isAutoCard && (variant.autoCardAvailableStock ?? 0) < 1);
    return (
        <article
            className="product-row"
            onPointerEnter={() => prefetchProductAsset(product)}
            onPointerDown={() => prefetchProductAsset(product)}
            onFocus={() => prefetchProductAsset(product)}
        >
            <button
                type="button"
                className="product-row-detail-link"
                onClick={onOpen}
                aria-label={`${isZh ? '查看' : 'View'} ${product.name}`}
            />
            <div className="product-row-image">
                <ProductImage product={product} />
            </div>
            <div className="product-row-content">
                <div className="product-row-top">
                    <strong className="product-row-name">{product.name}</strong>
                    <span className="product-row-desc">{trimText(product.description, 32)}</span>
                    <span className="product-row-badge">
                        {isAutoCard
                            ? isZh
                                ? '⚡ 付款后邮箱自动发卡'
                                : 'Automatic email delivery'
                            : isFileDownload
                              ? isZh
                                  ? '付款后可下载数字文件'
                                  : 'File download after payment'
                              : variant?.customFields.fulfillmentType === 'digital'
                                ? isZh
                                    ? '付款后由商家处理'
                                    : 'Processed by the merchant after payment'
                                : variant?.stockLevel === 'OUT_OF_STOCK'
                                  ? isZh
                                      ? '暂时缺货'
                                      : 'Out of stock'
                                  : isZh
                                    ? '现货在售'
                                    : 'In stock'}
                    </span>
                </div>
                <div className="product-row-bottom">
                    <p className="product-row-price">
                        <PriceDisplay
                            value={variant ? variant.priceWithTax : 0}
                            currency={variant ? variant.currencyCode : market.currencyCode}
                            locale={locale}
                        />
                    </p>
                    <button
                        className="row-add"
                        type="button"
                        onClick={onAdd}
                        disabled={!variant || adding || isOutOfStock}
                        aria-label={`${isZh ? '加入购物车' : 'Add to cart'} ${product.name}`}
                    >
                        <Plus />
                    </button>
                </div>
            </div>
        </article>
    );
}
