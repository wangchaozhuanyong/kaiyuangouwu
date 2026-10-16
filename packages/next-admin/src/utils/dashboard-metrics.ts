export type MetricPeriod = 'TODAY' | '7D' | '30D';
export type MetricComparison = { label: string; tone: 'positive' | 'negative' | 'neutral' };

// Sales, traffic and referral reports use the same Beijing calendar, independently of the browser.
const DAY_MS = 24 * 60 * 60 * 1000;
const BUSINESS_OFFSET_MS = 8 * 60 * 60 * 1000;
const businessDay = (timestamp: number) => Math.floor((timestamp + BUSINESS_OFFSET_MS) / DAY_MS);

export const getMetricRange = (period: MetricPeriod, endTimestamp: number) => {
    const days = period === 'TODAY' ? 1 : period === '7D' ? 7 : 30;
    const startTimestamp = (businessDay(endTimestamp) - days + 1) * DAY_MS - BUSINESS_OFFSET_MS;
    return {
        startDate: new Date(startTimestamp).toISOString(),
        endDate: new Date(endTimestamp).toISOString(),
    };
};

export const getPreviousMetricRange = ({ startDate, endDate }: { startDate: string; endDate: string }) => {
    const startTimestamp = Date.parse(startDate);
    const endTimestamp = Date.parse(endDate);
    // Compare with the previous calendar period at the same time of day, rather than last night.
    const periodDays = Math.max(businessDay(endTimestamp) - businessDay(startTimestamp) + 1, 1);
    const offset = periodDays * DAY_MS;
    return {
        startDate: new Date(startTimestamp - offset).toISOString(),
        endDate: new Date(endTimestamp - offset).toISOString(),
    };
};

export const compareMetric = (current: number, previous: number): MetricComparison => {
    if (previous === 0) {
        return current === 0
            ? { label: '与上期持平', tone: 'neutral' }
            : { label: '上期为 0', tone: 'positive' };
    }
    const change = ((current - previous) / previous) * 100;
    if (Math.abs(change) < 0.05) return { label: '与上期持平', tone: 'neutral' };
    return {
        label: `${change > 0 ? '+' : ''}${change.toFixed(1)}%`,
        tone: change > 0 ? 'positive' : 'negative',
    };
};
