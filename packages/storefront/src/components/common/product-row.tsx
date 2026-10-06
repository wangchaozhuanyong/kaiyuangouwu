import { ChevronRight } from 'lucide-react';

import {
    productWarrantyDuration,
    productWarrantyLabel,
} from '../../../../common/src/product-description-summary';
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
    const warrantyLabel = productWarrantyLabel(
        product.warrantyDuration !== undefined
            ? product.warrantyDuration
            : productWarrantyDuration(product.description),
        language,
    );

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

export function ProductRow({
    product,
    locale,
    language,
    onOpen,
    layout = 'row',
    showDescription = true,
}: {
    product: Product;
    market: MarketConfig;
    locale: string;
    language: StorefrontLanguage;
    onOpen: () => void;
    layout?: 'row' | 'catalog' | 'compact';
    showDescription?: boolean;
}) {
    const isZh = language === 'zh';
    const variant = lowestPricedProductVariant(product);
    const availability = productListingAvailability(product.variants, language);
    const smartInfo = buildProductRowSmartInfo(product, language);
    const subtitle = resolveProductSubtitle(product, 48);
    return (
        <ProductDetailLink
            className={`product-row product-row-detail-link${layout === 'catalog' ? ' product-catalog-card' : ''}${layout === 'compact' ? ' is-compact' : ''}`}
            product={product}
            language={language}
            onOpen={onOpen}
        >
            <div className="product-row-image">
                <ProductImage language={language} product={product} />
            </div>
            <div className="product-row-content">
                <div className="product-row-top">
                    <strong className="product-row-name">{product.name}</strong>
                    {subtitle && showDescription ? (
                        <span className="product-row-desc">{subtitle}</span>
                    ) : null}
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
                        {product.customFields?.pricingMode === 'QUOTE_ONLY' ? (
                            <span>{language === 'zh' ? '联系客服询价' : 'Request a quote'}</span>
                        ) : variant ? (
                            <PriceDisplay
                                value={variant.priceWithTax}
                                currency={variant.currencyCode}
                                locale={locale}
                            />
                        ) : (
                            '--'
                        )}
                    </p>
                    {product.customFields?.pricingMode !== 'QUOTE_ONLY' && (
                        <span className={`product-row-stock${availability.soldOut ? ' is-sold-out' : ''}`}>
                            {availability.label}
                        </span>
                    )}
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
