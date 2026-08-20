export function PageSkeleton() {
    return (
        <div className="page-skeleton" role="status" aria-label="Loading">
            <span className="skeleton-hero" />
            <span className="skeleton-line" />
            <div>
                <span />
                <span />
                <span />
                <span />
            </div>
            <span className="skeleton-block" />
            <span className="skeleton-block" />
        </div>
    );
}
