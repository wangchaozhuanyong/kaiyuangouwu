import { ChevronRight } from 'lucide-react';

import { productListingAvailability } from '../../product-availability';
import { lowestPricedProductVariant } from '../../product-pricing';
import { PriceDisplay, ProductImage, resolveProductSubtitle } from '../../storefront-ui/product-display';
import { MarketConfig, Product, StorefrontLanguage } from '../../types';

import { ProductDetailLink } from './product-detail-link';

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
    locale,
    language,
    onOpen,
    layout = 'row',
}: {
    product: Product;
    market: MarketConfig;
    locale: string;
    language: StorefrontLanguage;
    onOpen: () => void;
    layout?: 'row' | 'catalog';
}) {
    const isZh = language === 'zh';
    const variant = lowestPricedProductVariant(product);
    const availability = productListingAvailability(product.variants, language);
    const smartInfo = buildProductRowSmartInfo(product, language);
    const subtitle = resolveProductSubtitle(product, 48);
    return (
        <ProductDetailLink
            className={`product-row product-row-detail-link${layout === 'catalog' ? ' product-catalog-card' : ''}`}
            product={product}
            language={language}
            onOpen={onOpen}
        >
            <div className="product-row-image">
                <ProductImage product={product} />
            </div>
            <div className="product-row-content">
                <div className="product-row-top">
                    <strong className="product-row-name">{product.name}</strong>
                    {subtitle ? <span className="product-row-desc">{subtitle}</span> : null}
                    <div className="product-row-meta">
                        <span className="product-row-badge product-row-smart-line">{smartInfo.primary}</span>
                        {smartInfo.secondary ? (
                            <span className="product-row-smart-line product-row-warranty">
                                {smartInfo.secondary}
                            </span>
                        ) : null}
                    </div>
                </div>
                <div className="product-row-bottom">
                    <p className="product-row-price">
                        {variant ? (
                            <PriceDisplay
                                value={variant.priceWithTax}
                                currency={variant.currencyCode}
                                locale={locale}
                            />
                        ) : (
                            '--'
                        )}
                    </p>
                    <span className={`product-row-stock${availability.soldOut ? ' is-sold-out' : ''}`}>
                        {availability.label}
                    </span>
                </div>
            </div>
            {layout === 'catalog' ? (
                <span className="product-catalog-action">
                    {isZh ? '查看详情' : 'View details'}
                    <ChevronRight aria-hidden="true" />
                </span>
            ) : null}
        </ProductDetailLink>
    );
}
