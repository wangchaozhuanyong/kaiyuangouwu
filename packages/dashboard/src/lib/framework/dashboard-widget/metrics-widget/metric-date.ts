const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/u;

export function metricLabelDate(label: string): Date {
    const match = CALENDAR_DATE.exec(label);
    if (!match) {
        return new Date(label);
    }
    const [, year, month, day] = match;
    // Construct a local calendar date so a business-day label does not shift
    // when the dashboard browser uses a different timezone from the server.
    return new Date(Number(year), Number(month) - 1, Number(day), 12, 0, 0);
}
