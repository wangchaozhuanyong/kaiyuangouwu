/** Shared wire/copy contract. Values stay English regardless of interface language. */
export interface TaxFreeAddress {
    id: string;
    country: string;
    line1: string;
    city: string;
    state: string;
    postalCode: string;
    status: 'unused' | 'used';
    createdAt: string;
    usedAt: string | null;
}

export interface TaxFreeAddressStatus {
    serverNow: string;
    nextAllowedAt: string | null;
}

export interface TaxFreeAddressClaim extends TaxFreeAddressStatus {
    requestId: string;
    address: TaxFreeAddress;
}

export const taxFreeAddressFields = `id country line1 city state postalCode status createdAt usedAt`;

export function formatTaxFreeAddress(
    address: Pick<TaxFreeAddress, 'country' | 'line1' | 'city' | 'state' | 'postalCode'>,
): string {
    return [
        `国家（英语）：${address.country}`,
        `地址（英语）：${address.line1}`,
        `城市（英语）：${address.city}`,
        `州（英语）：${address.state}`,
        `邮编（英语）：${address.postalCode}`,
    ].join('\n');
}

/** Geographic state names are address content, not workflow status; preserve English as requested. */
export function formatTaxFreeAddressSummary(
    address: Pick<TaxFreeAddress, 'line1' | 'city' | 'state'>,
): string {
    return address.line1 + ' · ' + address.city + ', ' + address.state;
}
