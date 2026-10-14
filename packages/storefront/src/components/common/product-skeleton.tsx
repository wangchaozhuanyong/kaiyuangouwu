import { type ReactNode } from 'react';

export function ProductCardSkeleton({
    appearance = 'card',
    responsiveRow = false,
    children,
}: {
    appearance?: 'card' | 'plain' | 'mosaic' | 'gallery';
    responsiveRow?: boolean;
    children?: ReactNode;
}) {
    return (
        <div
            className={`product-card product-card-skeleton${appearance !== 'card' ? ` is-${appearance}` : ''}${responsiveRow ? ' is-responsive-row' : ''}`}
            aria-hidden={children ? undefined : true}
        >
            <div className="product-card-detail-link">
                <div className="product-card-media">{children}</div>
                <div className="product-card-content" aria-hidden={children ? true : undefined}>
                    <strong className="product-card-name">&nbsp;</strong>
                    {appearance === 'card' && <span className="product-card-subtitle">&nbsp;</span>}
                    {appearance !== 'mosaic' && appearance !== 'gallery' && (
                        <div className="product-card-meta">
                            <span className="product-card-delivery">&nbsp;</span>
                        </div>
                    )}
                    <footer>
                        <div className="product-card-price">
                            <span className="price-lockup">
                                <span className="price-symbol">&nbsp;</span>
                                <span className="price-integer">&nbsp;</span>
                            </span>
                        </div>
                        {appearance !== 'mosaic' && appearance !== 'gallery' && (
                            <small className="product-card-stock">&nbsp;</small>
                        )}
                    </footer>
                </div>
            </div>
        </div>
    );
}

/** Shares the real row's media, typography and price layout; never invents a product or action. */
export function ProductRowSkeleton({
    layout = 'row',
    showDescription = true,
}: {
    layout?: 'row' | 'compact';
    showDescription?: boolean;
}) {
    return (
        <div
            className={`product-row product-row-skeleton${layout === 'compact' ? ' is-compact' : ''}`}
            aria-hidden="true"
        >
            <div className="product-row-image" />
            <div className="product-row-content">
                <div className="product-row-top">
                    <strong className="product-row-name">&nbsp;</strong>
                    {showDescription && <span className="product-row-desc">&nbsp;</span>}
                    <div className="product-row-meta">
                        <span className="product-row-badge product-row-smart-line">&nbsp;</span>
                    </div>
                </div>
                <div className="product-row-bottom">
                    <p className="product-row-price">
                        <span className="price-lockup">
                            <span className="price-symbol">&nbsp;</span>
                            <span className="price-integer">&nbsp;</span>
                        </span>
                    </p>
                    <span className="product-row-stock">&nbsp;</span>
                </div>
            </div>
        </div>
    );
}

export function ProductSkeletonItems({
    count,
    layout = 'rows',
    appearance,
    responsiveRow = false,
    showDescription = true,
}: {
    count: number;
    layout?: 'rows' | 'products' | 'compact';
    appearance?: 'card' | 'plain';
    responsiveRow?: boolean;
    showDescription?: boolean;
}) {
    return Array.from({ length: count }, (_, index) =>
        layout === 'products' ? (
            <ProductCardSkeleton key={index} appearance={appearance} responsiveRow={responsiveRow} />
        ) : (
            <ProductRowSkeleton
                key={index}
                layout={layout === 'compact' ? 'compact' : 'row'}
                showDescription={showDescription}
            />
        ),
    );
}
