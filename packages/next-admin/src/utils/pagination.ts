export const DEFAULT_PAGE_SIZE = 20;
export const PAGE_SIZE_OPTIONS = [20, 50, 100] as const;

export function normalizePageSize(value: unknown): number {
    const size = Number(value);
    return PAGE_SIZE_OPTIONS.some(option => option === size) ? size : DEFAULT_PAGE_SIZE;
}
