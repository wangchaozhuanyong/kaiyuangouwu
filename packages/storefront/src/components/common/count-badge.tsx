function hasCount(count?: number): count is number {
    return count != null && Number.isFinite(count) && count > 0;
}

/** Visual count; the owning control includes the full count in its accessible name. */
export function CountBadge({ count, overlay }: { count?: number; overlay?: boolean }) {
    if (!hasCount(count)) return null;
    return (
        <b className={`count-badge${overlay ? ' is-overlay' : ''}`} title={String(count)}>
            {count > 99 ? '99+' : count}
        </b>
    );
}

export function countBadgeLabel(label: string, count?: number): string {
    return hasCount(count) ? `${label} ${count}` : label;
}
