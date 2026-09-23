import { Heart } from 'lucide-react';

import { productAvailability, productAvailabilityLabel } from '../../product-availability';
import {
    prefetchProductAsset,
    PriceDisplay,
    ProductImage,
    resolveProductSubtitle,
} from '../../storefront-ui/product-display';
import { MarketConfig, Product, StorefrontLanguage } from '../../types';

import '../../styles/product-card.css';
import { buildProductRowSmartInfo } from './product-row';

export function ProductCard({
    product,
    market,
    locale,
    language,
    favorite,
    onOpen,
    onFavorite,
    priority = false,
    imageSizes,
}: {
    product: Product;
    market: MarketConfig;
    locale: string;
    language: StorefrontLanguage;
    favorite?: boolean;
    onOpen: () => void;
    onFavorite?: () => void;
    priority?: boolean;
    imageSizes?: string;
}) {
    const isZh = language === 'zh';
    const variant = product.variants[0];
    const availability = productAvailability(variant);
    const stockLabel = productAvailabilityLabel(availability, isZh ? 'zh' : 'en');
    const subtitle = resolveProductSubtitle(product);
    const smartInfo = buildProductRowSmartInfo(product, language);

    return (
        <article
            className="product-card"
            onPointerEnter={() => prefetchProductAsset(product)}
            onPointerDown={() => prefetchProductAsset(product)}
            onFocus={() => prefetchProductAsset(product)}
        >
            <button
                className="product-card-detail-link"
                type="button"
                onClick={onOpen}
                aria-label={`${isZh ? '查看' : 'View'} ${product.name}`}
                title={[product.name, subtitle].filter(Boolean).join(' · ')}
            />

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

            <div className="product-card-media">
                <ProductImage
                    product={product}
                    loading={priority ? 'eager' : 'lazy'}
                    fetchPriority={priority ? 'high' : 'auto'}
                    sizes={imageSizes}
                />
            </div>

            <strong className="product-card-name">{product.name}</strong>
            {subtitle ? <span className="product-card-subtitle">{subtitle}</span> : null}
            <div className="product-card-meta">
                <span className="product-card-delivery">{smartInfo.primary}</span>
                {smartInfo.secondary ? <span>{smartInfo.secondary}</span> : null}
            </div>

            <footer>
                <div className="product-card-price">
                    <PriceDisplay
                        value={variant ? variant.priceWithTax : 0}
                        currency={variant ? variant.currencyCode : market.currencyCode}
                        locale={locale}
                    />
                </div>
                <small className={`product-card-stock${availability.soldOut ? ' is-sold-out' : ''}`}>
                    {stockLabel}
                </small>
            </footer>
        </article>
    );
}
