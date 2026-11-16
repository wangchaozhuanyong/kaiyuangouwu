import type { TaxFreeAddressClaim } from '../../../../storefront-content-plugin/src/tax-free-address-contract';

export const TAX_ADDRESS_HISTORY_EVENT = 'tax-address-history-changed';
export const historyKey = (scope: string) => 'tax-address-history:v1:' + encodeURIComponent(scope);
const pendingKey = (scope: string) => 'tax-address-pending:v1:' + encodeURIComponent(scope);
export interface LocalAddressHistory {
    records: TaxFreeAddressClaim[];
    unavailable: boolean;
}

/** Explicit user-owned history, not a server inventory/cache or cooldown authority. */
export function readAddressHistory(scope: string): LocalAddressHistory {
    try {
        const value: unknown = JSON.parse(localStorage.getItem(historyKey(scope)) ?? '[]');
        if (!Array.isArray(value)) throw new Error('Invalid local history');
        const records = value.filter(
            (row): row is TaxFreeAddressClaim =>
                !!row &&
                typeof row === 'object' &&
                typeof row.requestId === 'string' &&
                typeof row.address?.id === 'string' &&
                ['country', 'line1', 'city', 'state', 'postalCode'].every(
                    key => typeof row.address[key] === 'string' && row.address[key].length <= 160,
                ) &&
                Number.isFinite(Date.parse(row.address.usedAt)) &&
                row.address.status === 'used',
        );
        return { records: records.slice(0, 1000), unavailable: records.length !== value.length };
    } catch {
        return { records: [], unavailable: true };
    }
}
function announce(scope: string) {
    window.dispatchEvent(new CustomEvent(TAX_ADDRESS_HISTORY_EVENT, { detail: scope }));
}
export function saveAddressHistory(scope: string, receipt: TaxFreeAddressClaim): boolean {
    try {
        const rows = readAddressHistory(scope).records.filter(row => row.requestId !== receipt.requestId);
        rows.push(receipt);
        rows.sort((a, b) => Date.parse(b.address.usedAt ?? '') - Date.parse(a.address.usedAt ?? ''));
        localStorage.setItem(historyKey(scope), JSON.stringify(rows.slice(0, 1000)));
        announce(scope);
        return true;
    } catch {
        return false;
    }
}
export function clearAddressHistory(scope: string): boolean {
    try {
        localStorage.removeItem(historyKey(scope));
        announce(scope);
        return true;
    } catch {
        return false;
    }
}
export function pendingAddressRequest(scope: string): string | null {
    try {
        const id = localStorage.getItem(pendingKey(scope));
        return id && /^[a-f0-9-]{36}$/i.test(id) ? id : null;
    } catch {
        return null;
    }
}
export function rememberAddressRequest(scope: string, id: string): void {
    try {
        localStorage.setItem(pendingKey(scope), id);
    } catch {
        /* MutationCache retains the in-flight ID. */
    }
}
export function finishAddressRequest(scope: string, id: string): void {
    try {
        if (localStorage.getItem(pendingKey(scope)) === id) localStorage.removeItem(pendingKey(scope));
    } catch {
        /* The successful receipt is still available in the root MutationCache. */
    }
}
