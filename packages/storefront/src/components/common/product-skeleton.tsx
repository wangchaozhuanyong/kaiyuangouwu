export function ProductCardSkeleton({ appearance = 'card' }: { appearance?: 'card' | 'plain' }) {
    return (
        <div
            className={`product-card product-card-skeleton${appearance === 'plain' ? ' is-plain' : ''}`}
            aria-hidden="true"
        >
            <div className="product-card-detail-link">
                <div className="product-card-media" />
                <div className="product-card-content">
                    <strong className="product-card-name">&nbsp;</strong>
                    {appearance !== 'plain' && <span className="product-card-subtitle">&nbsp;</span>}
                    <div className="product-card-meta">
                        <span className="product-card-delivery">&nbsp;</span>
                    </div>
                    <footer>
                        <div className="product-card-price">
                            <span className="price-lockup">
                                <span className="price-symbol">&nbsp;</span>
                                <span className="price-integer">&nbsp;</span>
                            </span>
                        </div>
                        <small className="product-card-stock">&nbsp;</small>
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
    showDescription = true,
}: {
    count: number;
    layout?: 'rows' | 'products' | 'compact';
    appearance?: 'card' | 'plain';
    showDescription?: boolean;
}) {
    return Array.from({ length: count }, (_, index) =>
        layout === 'products' ? (
            <ProductCardSkeleton key={index} appearance={appearance} />
        ) : (
            <ProductRowSkeleton
                key={index}
                layout={layout === 'compact' ? 'compact' : 'row'}
                showDescription={showDescription}
            />
        ),
    );
}
