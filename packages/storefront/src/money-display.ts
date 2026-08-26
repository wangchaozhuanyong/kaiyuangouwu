export interface MoneyDisplayConfiguration {
    displayCurrencyCode: string;
    cnyPerUsdtRate: number | null;
    myrPerUsdtRate: number | null;
    usdtMarkupPercent: number;
}

const defaultConfiguration: MoneyDisplayConfiguration = {
    displayCurrencyCode: 'CNY',
    cnyPerUsdtRate: null,
    myrPerUsdtRate: null,
    usdtMarkupPercent: 0,
};

let activeConfiguration = defaultConfiguration;

export function configureMoneyDisplay(configuration: MoneyDisplayConfiguration): void {
    activeConfiguration = { ...configuration };
}

export function resetMoneyDisplay(): void {
    activeConfiguration = defaultConfiguration;
}

export function convertMinorPriceToUsdt(
    value: number,
    sourceCurrencyCode: string,
    configuration: MoneyDisplayConfiguration = activeConfiguration,
): number | null {
    const fiatPerUsdt =
        sourceCurrencyCode === 'CNY'
            ? configuration.cnyPerUsdtRate
            : sourceCurrencyCode === 'MYR'
              ? configuration.myrPerUsdtRate
              : null;
    if (!fiatPerUsdt || !Number.isFinite(fiatPerUsdt) || fiatPerUsdt <= 0) return null;
    const markupFactor = 1 + Math.max(0, configuration.usdtMarkupPercent) / 100;
    return (value / 100 / fiatPerUsdt) * markupFactor;
}

export function formatDisplayMoney(value: number, sourceCurrencyCode: string, locale: string): string {
    if (activeConfiguration.displayCurrencyCode === 'USDT') {
        const usdtAmount = convertMinorPriceToUsdt(value, sourceCurrencyCode);
        if (usdtAmount !== null) {
            const maximumFractionDigits = usdtAmount < 1 ? 4 : 2;
            return `≈₮${new Intl.NumberFormat(locale, {
                minimumFractionDigits: 2,
                maximumFractionDigits,
            }).format(usdtAmount)}`;
        }
    }
    return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: sourceCurrencyCode,
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
    }).format(value / 100);
}
