import { Heart } from 'lucide-react';

import { productListingAvailability } from '../../product-availability';
import { lowestPricedProductVariant } from '../../product-pricing';
import { PriceDisplay, ProductImage, resolveProductSubtitle } from '../../storefront-ui/product-display';
import { MarketConfig, Product, StorefrontLanguage } from '../../types';

import '../../styles/product-card.css';
import { ProductDetailLink } from './product-detail-link';
import { buildProductRowSmartInfo } from './product-row';

export function ProductCard({
    product,
    locale,
    language,
    favorite,
    onOpen,
    onFavorite,
    priority = false,
    eager = priority,
    imageSizes,
    appearance = 'card',
    responsiveRow = false,
}: {
    product: Product;
    market: MarketConfig;
    locale: string;
    language: StorefrontLanguage;
    favorite?: boolean;
    onOpen: () => void;
    onFavorite?: () => void;
    priority?: boolean;
    eager?: boolean;
    imageSizes?: string;
    appearance?: 'card' | 'plain' | 'gallery' | 'mosaic';
    responsiveRow?: boolean;
}) {
    const isZh = language === 'zh';
    const gallery = appearance === 'gallery' || appearance === 'mosaic';
    const variant = lowestPricedProductVariant(product);
    const availability = productListingAvailability(product.variants, language);
    const stockLabel = availability.label;
    const subtitle = resolveProductSubtitle(product, responsiveRow ? 48 : 26, !responsiveRow);
    const smartInfo = buildProductRowSmartInfo(product, language);

    return (
        <article
            className={`product-card${appearance !== 'card' ? ` is-${appearance}` : ''}${responsiveRow ? ' is-responsive-row' : ''}`}
        >
            <ProductDetailLink
                className="product-card-detail-link"
                product={product}
                language={language}
                onOpen={onOpen}
                title={[product.name, subtitle].filter(Boolean).join(' · ')}
            >
                <div className="product-card-media">
                    <ProductImage
                        language={language}
                        product={product}
                        loading={eager ? 'eager' : 'lazy'}
                        fetchPriority={priority ? 'high' : 'auto'}
                        sizes={imageSizes}
                    />
                </div>

                <div className="product-card-content">
                    <strong className="product-card-name">{product.name}</strong>
                    {subtitle && appearance === 'card' ? (
                        <span className="product-card-subtitle">{subtitle}</span>
                    ) : null}
                    {!gallery && (
                        <div className="product-card-meta">
                            <span className="product-card-delivery">{smartInfo.primary}</span>
                            {smartInfo.secondary ? <span>{smartInfo.secondary}</span> : null}
                        </div>
                    )}

                    <footer>
                        <div className="product-card-price">
                            {product.customFields?.pricingMode === 'QUOTE_ONLY' ? (
                                <span>{isZh ? '联系客服询价' : 'Request a quote'}</span>
                            ) : variant ? (
                                <PriceDisplay
                                    value={variant.priceWithTax}
                                    currency={variant.currencyCode}
                                    locale={locale}
                                />
                            ) : (
                                '--'
                            )}
                        </div>
                        {product.customFields?.pricingMode !== 'QUOTE_ONLY' &&
                            (!gallery || availability.soldOut) && (
                                <small
                                    className={`product-card-stock${availability.soldOut ? ' is-sold-out' : ''}`}
                                >
                                    {stockLabel}
                                </small>
                            )}
                    </footer>
                </div>
            </ProductDetailLink>

            {onFavorite && (
                <button
                    className={`product-card-favorite${favorite ? ' is-favorite' : ''}`}
                    type="button"
                    onClick={onFavorite}
                    aria-pressed={favorite}
                    aria-label={
                        favorite
                            ? isZh
                                ? `取消收藏 ${product.name}`
                                : `Remove ${product.name} from favorites`
                            : isZh
                              ? `收藏 ${product.name}`
                              : `Add ${product.name} to favorites`
                    }
                >
                    <Heart fill={favorite ? 'currentColor' : 'none'} aria-hidden="true" />
                </button>
            )}
        </article>
    );
}

export { ProductCardSkeleton } from './product-skeleton';
