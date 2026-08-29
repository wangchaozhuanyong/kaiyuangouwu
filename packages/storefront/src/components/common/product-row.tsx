import { productAvailability, productAvailabilityLabel } from '../../product-availability';
import {
    prefetchProductAsset,
    PriceDisplay,
    ProductImage,
    trimText,
} from '../../storefront-ui/product-display';
import { MarketConfig, Product, StorefrontLanguage } from '../../types';

// TODO: Fix internal imports later

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
                </div>
                <div className="product-row-bottom">
                    <p className="product-row-price">
                        <PriceDisplay
                            value={variant ? variant.priceWithTax : 0}
                            currency={variant ? variant.currencyCode : market.currencyCode}
                            locale={locale}
                        />
                    </p>
                    <span
                        className={`product-row-stock${availability.soldOut ? ' is-sold-out' : ''}`}
                    >
                        {productAvailabilityLabel(availability, language)}
                    </span>
                </div>
            </div>
        </article>
    );
}
