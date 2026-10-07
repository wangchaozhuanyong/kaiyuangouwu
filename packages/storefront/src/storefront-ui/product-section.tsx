import type { CSSProperties } from 'react';

import { ProductCard, ProductCardSkeleton } from '../components/common/product-card';
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
    desktopRail = false,
    prioritizeFirstImage = true,
    appearance,
    loading = false,
    skeletonCount = 4,
}: {
    loading?: boolean;
    skeletonCount?: number;
    desktopRail?: boolean;
    prioritizeFirstImage?: boolean;
    title?: string;
    kind?: SectionKind;
    appearance?: 'card' | 'plain';
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
    if (!loading && !products.length) return null;
    return (
        <section
            className={`content-section product-section${className ? ` ${className}` : ''}`}
            style={style}
            aria-busy={loading || undefined}
            data-page-pending={loading ? 'data' : undefined}
        >
            {title || subtitle || centerLabel || action ? (
                <SectionHeader
                    icon={appearance === 'plain' ? false : undefined}
                    kind={kind}
                    title={title}
                    subtitle={subtitle}
                    centerLabel={centerLabel}
                    action={action}
                    onAction={onAction}
                    subtitlePlacement={subtitlePlacement}
                />
            ) : null}
            <div className={`product-grid${desktopRail ? ' desktop-product-rail is-four-column' : ''}`}>
                {loading
                    ? Array.from({ length: skeletonCount }, (_, index) => (
                          <ProductCardSkeleton key={index} appearance={appearance} />
                      ))
                    : products.map((product, index) => {
                          const card = (
                              <ProductCard
                                  key={product.id}
                                  product={product}
                                  market={market}
                                  locale={locale}
                                  language={language}
                                  appearance={appearance}
                                  priority={prioritizeFirstImage && index === 0}
                                  eager={prioritizeFirstImage && index < 2}
                                  imageSizes="(min-width: 1024px) 200px, calc(50vw - 24px)"
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
            {loading && (
                <span className="visually-hidden" role="status">
                    {language === 'zh' ? '正在加载商品' : 'Loading products'}
                </span>
            )}
        </section>
    );
}
