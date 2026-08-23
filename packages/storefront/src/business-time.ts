export const BUSINESS_TIME_ZONE = 'Asia/Shanghai';

export function formatBusinessDate(
    locale: string,
    value: string | Date,
    options?: Intl.DateTimeFormatOptions,
): string {
    try {
        return new Intl.DateTimeFormat(locale || 'zh-CN', {
            ...options,
            timeZone: BUSINESS_TIME_ZONE,
        }).format(new Date(value));
    } catch {
        return new Intl.DateTimeFormat('zh-CN', {
            ...options,
            timeZone: BUSINESS_TIME_ZONE,
        }).format(new Date(value));
    }
}
