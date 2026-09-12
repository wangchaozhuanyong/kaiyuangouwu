export function calculateDefaultExpiryDate(manufacturedAt: string, shelfLifeDays: number | null): string {
    if (!manufacturedAt || shelfLifeDays == null || !Number.isInteger(shelfLifeDays) || shelfLifeDays < 0) {
        return '';
    }
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(manufacturedAt);
    if (!match) return '';
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== manufacturedAt) return '';
    date.setUTCDate(date.getUTCDate() + shelfLifeDays);
    return date.toISOString().slice(0, 10);
}
