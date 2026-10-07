import type { Channel, ShippingMethod } from '@vendure/core';

import { convertChannelAmount } from './store-currency-price-selection-strategy';

/** The same enabled-region and active-template rule is used by settings, capability and launch checks. */
export function hasReadyShippingMethod(channel: Channel, methods: ShippingMethod[]): boolean {
    const countryCodes = new Set(
        channel.defaultShippingZone?.members
            ?.filter(country => country.enabled)
            .map(country => (country.code ?? '').trim().toUpperCase())
            .filter(Boolean),
    );
    if (!countryCodes.size) return false;
    return methods.some(method => {
        const managed = method.checker?.code === 'store-shipping-zone-eligibility-checker';
        const legacy =
            channel.defaultShippingZone?.name === `Store ${channel.code} shipping` &&
            method.calculator?.code === 'physical-subtotal-shipping-calculator' &&
            method.checker?.code === 'supported-destination-eligibility-checker';
        if (!managed && !legacy) return false;
        let allowed =
            method.checker.args?.find(argument => argument.name === 'allowedCountryCodes')?.value ?? '';
        try {
            const decoded: unknown = JSON.parse(allowed);
            if (typeof decoded === 'string') allowed = decoded;
        } catch {
            // Configurable-operation strings may be raw text or JSON-encoded by Admin.
        }
        const allowedCountries = allowed
            .split(/[\s,;]+/u)
            .map(code => code.trim().toUpperCase())
            .filter(Boolean);
        const hasDestination =
            !allowedCountries.length || allowedCountries.some(code => countryCodes.has(code));
        return hasDestination && hasUsableFixedShippingAmounts(channel, method);
    });
}

function hasUsableFixedShippingAmounts(channel: Channel, method: ShippingMethod): boolean {
    // Public free shipping and other calculators retain their existing readiness rule.
    if (method.calculator?.code !== 'physical-subtotal-shipping-calculator') return true;

    const argument = (name: string) =>
        method.calculator.args?.find(configArgument => configArgument.name === name)?.value;
    const sourceCurrency = (argument('sourceCurrencyCode') ||
        argument('currencyCode') ||
        channel.defaultCurrencyCode) as Channel['defaultCurrencyCode'];

    return ['baseRate', 'freeAbove'].every(name => {
        // Match the calculator's integer argument coercion; absent or invalid amounts cannot quote.
        const amount = Number.parseInt(argument(name) ?? '', 10);
        if (!Number.isSafeInteger(amount) || amount < 0) return false;
        const converted = convertChannelAmount(
            { channel },
            amount,
            sourceCurrency,
            channel.defaultCurrencyCode,
        );
        return converted != null && Number.isSafeInteger(converted) && converted >= 0;
    });
}
