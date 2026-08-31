import { Plus } from 'lucide-react';

import {
    prefetchProductAsset,
    PriceDisplay,
    ProductImage,
    trimText,
} from '../../storefront-ui/product-display';
import { DigitalDeliveryMode, MarketConfig, Product, StorefrontLanguage } from '../../types';

// TODO: Fix internal imports later

export interface ProductRowSmartInfo {
    primary: string;
    secondary: string | null;
}

export function buildProductRowSmartInfo(
    product: Product,
    language: StorefrontLanguage,
): ProductRowSmartInfo {
    const isZh = language === 'zh';
    const variant = product.variants[0];
    const fulfillmentType = variant?.customFields.fulfillmentType;
    const deliveryMode = variant?.customFields.digitalDeliveryMode ?? 'manual_service';
    const isDigital = fulfillmentType === 'digital';
    const deliveryLabel = isDigital
        ? deliveryMode === 'auto_card'
            ? isZh
                ? '邮箱自动发货'
                : 'Email delivery'
            : deliveryMode === 'file_download'
              ? isZh
                  ? '付款后下载'
                  : 'Download after payment'
              : isZh
                ? '商家人工处理'
                : 'Merchant-processed'
        : isZh
          ? '需要配送'
          : 'Physical delivery';
    const warrantyLabel = extractWarrantyLabel(product.description, language);

    return {
        primary:
            [
                fulfillmentType
                    ? isDigital
                        ? isZh
                            ? '数字商品'
                            : 'Digital'
                        : isZh
                          ? '实物商品'
                          : 'Physical'
                    : null,
                variant ? deliveryLabel : null,
            ]
                .filter(Boolean)
                .join(' · ') || (isZh ? '商品信息' : 'Product information'),
        secondary: warrantyLabel,
    };
}

function extractWarrantyLabel(description: string, language: StorefrontLanguage): string | null {
    const plainText = description
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (!plainText) return null;

    const chineseMatch = plainText.match(
        /(?:质保|保修|保障)\s*[:：]?\s*([0-9一二三四五六七八九十百]+(?:天|日|个月|月|年))/i,
    );
    if (chineseMatch?.[1]) {
        return language === 'zh' ? `质保${chineseMatch[1]}` : `Warranty ${chineseMatch[1]}`;
    }

    const englishMatch = plainText.match(
        /(?:warranty|guarantee)\s*(?:of|for|:)?\s*(\d+\s*(?:days?|months?|years?))/i,
    );
    if (englishMatch?.[1]) {
        return language === 'zh' ? `质保${englishMatch[1]}` : `Warranty ${englishMatch[1]}`;
    }

    return null;
}

function productRowAvailabilityLabel(
    variant: Product['variants'][number] | undefined,
    isAutoCard: boolean,
    isOutOfStock: boolean,
    language: StorefrontLanguage,
): string {
    const isZh = language === 'zh';
    if (!variant) return isZh ? '暂不可购买' : 'Unavailable';
    if (isOutOfStock) return isZh ? '已售罄' : 'Sold out';
    if (isAutoCard && typeof variant.autoCardAvailableStock === 'number') {
        return isZh ? `库存 ${variant.autoCardAvailableStock}` : `${variant.autoCardAvailableStock} in stock`;
    }
    return variant.customFields.fulfillmentType === 'physical'
        ? isZh
            ? '现货在售'
            : 'In stock'
        : isZh
          ? '可购买'
          : 'Available';
}

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
    const isOutOfStock =
        (variant?.customFields.fulfillmentType === 'physical' && variant.stockLevel === 'OUT_OF_STOCK') ||
        (isAutoCard && (variant.autoCardAvailableStock ?? 0) < 1);
    const smartInfo = buildProductRowSmartInfo(product, language);
    const availabilityLabel = productRowAvailabilityLabel(variant, isAutoCard, isOutOfStock, language);
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
                    <span className="product-row-badge product-row-smart-line">{smartInfo.primary}</span>
                    {smartInfo.secondary ? (
                        <span className="product-row-smart-line product-row-warranty">
                            {smartInfo.secondary}
                        </span>
                    ) : null}
                </div>
                <div className="product-row-bottom">
                    <p className="product-row-price">
                        <PriceDisplay
                            value={variant ? variant.priceWithTax : 0}
                            currency={variant ? variant.currencyCode : market.currencyCode}
                            locale={locale}
                        />
                    </p>
                    <span className={`product-row-stock${isOutOfStock ? ' is-sold-out' : ''}`}>
                        {availabilityLabel}
                    </span>
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
