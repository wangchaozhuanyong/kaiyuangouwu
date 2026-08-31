import { productAvailability, productAvailabilityLabel } from '../../product-availability';
import {
    prefetchProductAsset,
    PriceDisplay,
    ProductImage,
    trimText,
} from '../../storefront-ui/product-display';
import { MarketConfig, Product, StorefrontLanguage } from '../../types';

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

export function ProductRow({
    product,
    market,
    locale,
    language,
    onOpen,
}: {
    product: Product;
    market: MarketConfig;
    locale: string;
    language: StorefrontLanguage;
    onOpen: () => void;
}) {
    const isZh = language === 'zh';
    const variant = product.variants[0];
    const availability = productAvailability(variant);
    const smartInfo = buildProductRowSmartInfo(product, language);
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
                    <span className={`product-row-stock${availability.soldOut ? ' is-sold-out' : ''}`}>
                        {productAvailabilityLabel(availability, language)}
                    </span>
                </div>
            </div>
        </article>
    );
}
