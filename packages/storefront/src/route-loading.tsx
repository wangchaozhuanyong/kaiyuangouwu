export function PageSkeleton({ label = 'Loading' }: { label?: string }) {
    return (
        <div className="page-skeleton" role="status" aria-label={label}>
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
