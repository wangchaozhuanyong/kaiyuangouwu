export const BUSINESS_TIME_ZONE = 'Asia/Shanghai';

export function formatBusinessDate(
    locale: string,
    value: string | Date,
    options?: Intl.DateTimeFormatOptions,
): string {
    return new Intl.DateTimeFormat(locale, {
        ...options,
        timeZone: BUSINESS_TIME_ZONE,
    }).format(new Date(value));
}
