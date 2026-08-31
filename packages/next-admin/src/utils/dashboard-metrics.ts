export type MetricPeriod = 'TODAY' | '7D' | '30D';
export type MetricComparison = { label: string; tone: 'positive' | 'negative' | 'neutral' };

export const getMetricRange = (period: MetricPeriod, endTimestamp: number) => {
  const end = new Date(endTimestamp);
  const start = new Date(end);
  if (period === 'TODAY') {
    start.setHours(0, 0, 0, 0);
  } else {
    start.setDate(start.getDate() - (period === '7D' ? 6 : 29));
    start.setHours(0, 0, 0, 0);
  }
  return { startDate: start.toISOString(), endDate: end.toISOString() };
};

export const getPreviousMetricRange = ({
  startDate,
  endDate,
}: {
  startDate: string;
  endDate: string;
}) => {
  const startTimestamp = Date.parse(startDate);
  const endTimestamp = Date.parse(endDate);
  const duration = Math.max(endTimestamp - startTimestamp, 1);
  const previousEndTimestamp = startTimestamp - 1;
  return {
    startDate: new Date(previousEndTimestamp - duration).toISOString(),
    endDate: new Date(previousEndTimestamp).toISOString(),
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
