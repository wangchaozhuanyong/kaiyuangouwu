export function dateInputToUtcDateTime(value: string): string | null {
    if (!value) return null;
    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
