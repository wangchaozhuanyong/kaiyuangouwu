import { scopedStorageKey } from './storefront-storage';

const VISIT_TIMES_KEY = 'storefront-guest-product-visit-times';
export type ProductVisitTimes = Record<string, number>;

export function readProductVisitTimes(storefrontCode: string, productIds: string[]): ProductVisitTimes {
    try {
        const stored: unknown = JSON.parse(
            localStorage.getItem(scopedStorageKey(VISIT_TIMES_KEY, storefrontCode)) ?? '{}',
        );
        if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {};
        return Object.fromEntries(
            productIds.flatMap(id => {
                const value = (stored as Record<string, unknown>)[id];
                return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= Date.now()
                    ? [[id, value]]
                    : [];
            }),
        );
    } catch {
        return {};
    }
}

export function recordProductVisit(
    storefrontCode: string,
    productId: string,
    recentIds: string[],
    limit: number,
) {
    const ids = [productId, ...recentIds.filter(id => id !== productId)].slice(0, limit);
    const times = readProductVisitTimes(storefrontCode, ids);
    times[productId] = Date.now();
    try {
        localStorage.setItem(scopedStorageKey(VISIT_TIMES_KEY, storefrontCode), JSON.stringify(times));
    } catch {
        // Browsing remains available when browser storage is unavailable.
    }
}

export function clearProductVisitTimes(storefrontCode: string) {
    try {
        localStorage.removeItem(scopedStorageKey(VISIT_TIMES_KEY, storefrontCode));
    } catch {
        // Clearing the in-memory history still works in restricted browsers.
    }
}

export function groupProductsByVisitDate<T extends { id: string }>(products: T[], times: ProductVisitTimes) {
    const groups = new Map<string, { date: Date | null; products: T[] }>();
    for (const product of products) {
        const timestamp = times[product.id];
        const date = timestamp ? new Date(timestamp) : null;
        const key = date ? `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}` : 'unknown';
        const group = groups.get(key) ?? { date, products: [] };
        group.products.push(product);
        groups.set(key, group);
    }
    return [...groups.values()].sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0));
}

export type VisitPeriod = 'all' | 'today' | 'yesterday' | 'two-days-ago' | 'earlier';

/** Calendar days, not elapsed 24-hour windows; old records without dates remain accessible. */
export function filterProductsByVisitDate<T extends { id: string }>(
    products: T[],
    times: ProductVisitTimes,
    period: VisitPeriod,
    now = new Date(),
): T[] {
    const calendarDay = (date: Date) =>
        Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000;
    const today = calendarDay(now);
    const timestamp = (id: string) => {
        const value = times[id];
        return Number.isFinite(value) && value > 0 && value <= now.getTime() ? value : 0;
    };
    return products
        .filter(product => {
            if (period === 'all') return true;
            const visited = timestamp(product.id);
            if (!visited) return period === 'earlier';
            const age = today - calendarDay(new Date(visited));
            return period === 'today'
                ? age === 0
                : period === 'yesterday'
                  ? age === 1
                  : period === 'two-days-ago'
                    ? age === 2
                    : age > 2;
        })
        .sort((a, b) => timestamp(b.id) - timestamp(a.id));
}
