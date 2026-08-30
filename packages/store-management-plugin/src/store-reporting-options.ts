import { UserInputError } from '@vendure/core';

export interface StoreReportListOptions {
    from?: Date | string | null;
    to?: Date | string | null;
    skip?: number | null;
    take?: number | null;
}

export interface NormalizedStoreReportListOptions {
    from: Date | null;
    to: Date | null;
    skip: number;
    take: number;
}

export function normalizeStoreReportOptions(
    options: StoreReportListOptions | null | undefined,
    defaultTake: number,
    maximumTake: number,
): NormalizedStoreReportListOptions {
    const from = normalizeDate(options?.from, '开始时间');
    const to = normalizeDate(options?.to, '结束时间');
    if (from && to && from > to) throw new UserInputError('开始时间不能晚于结束时间');

    const skip = options?.skip == null ? 0 : Number(options.skip);
    if (!Number.isSafeInteger(skip) || skip < 0) throw new UserInputError('分页起始位置必须为非负整数');
    const requestedTake = options?.take == null ? defaultTake : Number(options.take);
    if (!Number.isSafeInteger(requestedTake) || requestedTake <= 0) {
        throw new UserInputError('每页数量必须为正整数');
    }
    return {
        from,
        to,
        skip,
        take: Math.min(maximumTake, requestedTake),
    };
}

function normalizeDate(value: Date | string | null | undefined, label: string): Date | null {
    if (value == null) return null;
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    if (!Number.isFinite(date.getTime())) throw new UserInputError(`${label}格式不正确`);
    return date;
}
