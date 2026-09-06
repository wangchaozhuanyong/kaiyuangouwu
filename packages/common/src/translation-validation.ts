export function containsHanContent(value: string): boolean {
    return /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u.test(value);
}

export function isUsableEnglishTranslation(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0 && !containsHanContent(value);
}
