import { describe, expect, it } from 'vitest';

import { compareMetric, getMetricRange, getPreviousMetricRange } from './dashboard-metrics';

describe('dashboard metric helpers', () => {
  it('builds a current range and a non-overlapping previous range of equal duration', () => {
    const current = getMetricRange('7D', Date.parse('2026-08-31T12:00:00.000Z'));
    const previous = getPreviousMetricRange(current);
    const currentDuration = Date.parse(current.endDate) - Date.parse(current.startDate);
    const previousDuration = Date.parse(previous.endDate) - Date.parse(previous.startDate);

    expect(previousDuration).toBe(currentDuration);
    expect(Date.parse(previous.endDate)).toBeLessThan(Date.parse(current.startDate));
  });

  it('formats increases, decreases and zero baselines clearly', () => {
    expect(compareMetric(120, 100)).toEqual({ label: '+20.0%', tone: 'positive' });
    expect(compareMetric(80, 100)).toEqual({ label: '-20.0%', tone: 'negative' });
    expect(compareMetric(0, 0)).toEqual({ label: '与上期持平', tone: 'neutral' });
    expect(compareMetric(10, 0)).toEqual({ label: '上期为 0', tone: 'positive' });
  });
});
