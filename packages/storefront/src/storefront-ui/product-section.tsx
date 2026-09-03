import type { CSSProperties } from 'react';

import { ProductCard } from '../components/common/product-card';
import { MarketConfig, Product, StorefrontLanguage } from '../types';

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
    language,
    favoriteProductIds,
    onProduct,
    onFavorite,
    subtitlePlacement,
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
    language: StorefrontLanguage;
    favoriteProductIds?: string[];
    onProduct: (product: Product) => void;
    onFavorite?: (product: Product) => void;
    subtitlePlacement?: 'below' | 'end';
}) {
    if (!products.length) return null;
    return (
        <section
            className={`content-section product-section${className ? ` ${className}` : ''}`}
            style={style}
        >
            {title || subtitle || centerLabel || action ? (
                <SectionHeader
                    title={title}
                    subtitle={subtitle}
                    centerLabel={centerLabel}
                    action={action}
                    onAction={onAction}
                    subtitlePlacement={subtitlePlacement}
                />
            ) : null}
            <div className="product-grid">
                {products.map(product => (
                    <ProductCard
                        key={product.id}
                        product={product}
                        market={market}
                        locale={locale}
                        language={language}
                        favorite={favoriteProductIds?.includes(product.id)}
                        onOpen={() => onProduct(product)}
                        onFavorite={onFavorite ? () => onFavorite(product) : undefined}
                    />
                ))}
            </div>
        </section>
    );
}
