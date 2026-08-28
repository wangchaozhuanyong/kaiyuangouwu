interface CurrencyPrice {
    currencyCode: string;
}

export function getEditableDefaultCurrencyPrices<T extends CurrencyPrice>(
    prices: readonly T[],
    defaultCurrencyCode: string,
    fallback: T,
): [T] {
    return [prices.find(price => price.currencyCode === defaultCurrencyCode) ?? fallback];
}
