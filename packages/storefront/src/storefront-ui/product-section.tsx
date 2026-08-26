import type { CSSProperties } from 'react';

import { ProductCard } from '../components/common/product-card';
import { MarketConfig, Product, ProductVariant } from '../types';

import { SectionHeader } from './page-shell';

export function ProductSection({
    title,
    subtitle,
    centerLabel,
    action,
    onAction,
    className,
    style,
    products,
    market,
    locale,
    addingVariantId,
    favoriteProductIds,
    onProduct,
    onFavorite,
    onAdd,
}: {
    title?: string;
    subtitle?: string;
    centerLabel?: string;
    action?: string;
    onAction?: () => void;
    className?: string;
    style?: CSSProperties;
    products: Product[];
    market: MarketConfig;
    locale: string;
    addingVariantId: string | null;
    favoriteProductIds?: string[];
    onProduct: (product: Product) => void;
    onFavorite?: (product: Product) => void;
    onAdd: (variant: ProductVariant) => void;
}) {
    if (!products.length) return null;
    return (
        <section
            className={`content-section product-section${className ? ` ${className}` : ''}`}
            style={style}
        >
            <SectionHeader
                title={title}
                subtitle={subtitle}
                centerLabel={centerLabel}
                action={action}
                onAction={onAction}
            />
            <div className="product-grid">
                {products.map(product => (
                    <ProductCard
                        key={product.id}
                        product={product}
                        market={market}
                        locale={locale}
                        adding={product.variants.some(variant => variant.id === addingVariantId)}
                        favorite={favoriteProductIds?.includes(product.id)}
                        onOpen={() => onProduct(product)}
                        onFavorite={onFavorite ? () => onFavorite(product) : undefined}
                        onAdd={() => product.variants[0] && onAdd(product.variants[0])}
                    />
                ))}
            </div>
        </section>
    );
}
