import type { CSSProperties } from 'react';

import { ProductCard } from '../components/common/product-card';
import { MarketConfig, Product, StorefrontLanguage } from '../types';

import { SectionHeader, type SectionKind } from './page-shell';

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
    selection,
    kind,
}: {
    title?: string;
    kind?: SectionKind;
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
    selection?: { ids: string[]; onToggle: (id: string) => void };
}) {
    if (!products.length) return null;
    return (
        <section
            className={`content-section product-section${className ? ` ${className}` : ''}`}
            style={style}
        >
            {title || subtitle || centerLabel || action ? (
                <SectionHeader
                    kind={kind}
                    title={title}
                    subtitle={subtitle}
                    centerLabel={centerLabel}
                    action={action}
                    onAction={onAction}
                    subtitlePlacement={subtitlePlacement}
                />
            ) : null}
            <div className="product-grid">
                {products.map((product, index) => {
                    const card = (
                        <ProductCard
                            key={product.id}
                            product={product}
                            market={market}
                            locale={locale}
                            language={language}
                            priority={index === 0}
                            imageSizes="(min-width: 1280px) 220px, (min-width: 1024px) 20vw, calc(50vw - 24px)"
                            favorite={favoriteProductIds?.includes(product.id)}
                            onOpen={() => onProduct(product)}
                            onFavorite={onFavorite ? () => onFavorite(product) : undefined}
                        />
                    );
                    return selection ? (
                        <div key={product.id} className="favorite-selection-card">
                            {card}
                            <label className="favorite-select-control">
                                <input
                                    type="checkbox"
                                    checked={selection.ids.includes(product.id)}
                                    onChange={() => selection.onToggle(product.id)}
                                    aria-label={`${language === 'zh' ? '选择' : 'Select'} ${product.name}`}
                                />
                            </label>
                        </div>
                    ) : (
                        card
                    );
                })}
            </div>
        </section>
    );
}
