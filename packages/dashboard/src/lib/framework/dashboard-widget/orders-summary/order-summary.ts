interface MetricSummary {
    type: string;
    entries: ReadonlyArray<{ value: number }>;
}

export function metricSummaryTotal(
    summaries: ReadonlyArray<MetricSummary> | null | undefined,
    type: 'OrderCount' | 'OrderTotal',
): number {
    return (
        summaries
            ?.find(summary => summary.type === type)
            ?.entries.reduce((total, entry) => total + entry.value, 0) ?? 0
    );
}
