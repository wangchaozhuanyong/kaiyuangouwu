const DAY = 86400000;
export const localDay = (now = new Date()) =>
    new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10);
export function dayStart(day: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(day)) throw new Error('请使用 YYYY-MM-DD 日期');
    const date = new Date(`${day}T00:00:00+08:00`);
    if (!Number.isFinite(date.getTime()) || localDay(date) !== day) throw new Error('日期无效');
    return date;
}
export function historyDays(start: string, end: string, now = new Date()) {
    const from = dayStart(start);
    const to = dayStart(end);
    const today = dayStart(localDay(now));
    const size = Math.round((to.getTime() - from.getTime()) / DAY) + 1;
    if (size < 1 || size > 31 || to >= today) throw new Error('历史补采最多 31 天，结束日期必须在今天之前');
    return Array.from({ length: size }, (_, index) => localDay(new Date(from.getTime() + index * DAY)));
}
export function previousMonth(now = new Date()) {
    const today = dayStart(localDay(now));
    const local = new Date(today.getTime() + 8 * 3600000);
    const previousLast = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 0));
    const from = new Date(
        Date.UTC(
            previousLast.getUTCFullYear(),
            previousLast.getUTCMonth(),
            Math.min(local.getUTCDate(), previousLast.getUTCDate()),
        ),
    );
    return { start: from.toISOString().slice(0, 10), end: localDay(new Date(today.getTime() - DAY)) };
}
