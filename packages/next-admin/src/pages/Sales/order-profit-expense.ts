export function expenseMicrounitsToInput(value?: number | null): string {
    if (value == null) return '';
    return (value / 1_000).toFixed(3).replace(/\.?0+$/u, '');
}

export function expenseInputToMicrounits(value: string, label: string): number | null {
    const normalized = value.trim().replace(/,/gu, '');
    if (!normalized) return null;
    if (!/^\d+(?:\.\d{1,3})?$/u.test(normalized)) {
        throw new Error(`${label}必须是非负且最多 3 位小数的金额`);
    }
    const microunits = Math.round(Number(normalized) * 1_000);
    if (!Number.isSafeInteger(microunits)) throw new Error(`${label}超出可支持范围`);
    return microunits;
}
