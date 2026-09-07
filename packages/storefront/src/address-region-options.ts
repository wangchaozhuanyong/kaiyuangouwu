import type { StorefrontProvince } from './types';

export function provincesForCountry(
    provinces: readonly StorefrontProvince[],
    countryCode: string,
): StorefrontProvince[] {
    const normalizedCountry = countryCode.trim().toUpperCase();
    return provinces.filter(province => province.countryCode.toUpperCase() === normalizedCountry);
}

export function provinceCodeForValue(
    provinces: readonly StorefrontProvince[],
    countryCode: string,
    value: string,
): string {
    const normalizedValue = value.trim().toLocaleLowerCase();
    const match = provincesForCountry(provinces, countryCode).find(
        province =>
            province.code.toLocaleLowerCase() === normalizedValue ||
            province.name.toLocaleLowerCase() === normalizedValue,
    );
    return match?.code ?? value;
}

export function provinceDisplayName(
    provinces: readonly StorefrontProvince[],
    countryCode: string,
    value?: string | null,
): string {
    if (!value) return '';
    const normalizedValue = value.trim().toLocaleLowerCase();
    return (
        provincesForCountry(provinces, countryCode).find(
            province =>
                province.code.toLocaleLowerCase() === normalizedValue ||
                province.name.toLocaleLowerCase() === normalizedValue,
        )?.name ?? value
    );
}
