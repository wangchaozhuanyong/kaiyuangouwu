import type { Channel, ShippingMethod } from '@vendure/core';

/** The same enabled-region and active-template rule is used by settings, capability and launch checks. */
export function hasReadyShippingMethod(channel: Channel, methods: ShippingMethod[]): boolean {
    return Boolean(
        channel.defaultShippingZone?.members?.some(country => country.enabled) &&
        methods.some(method => {
            const managed = method.checker?.code === 'store-shipping-zone-eligibility-checker';
            const legacy =
                channel.defaultShippingZone?.name === `Store ${channel.code} shipping` &&
                method.calculator?.code === 'physical-subtotal-shipping-calculator' &&
                method.checker?.code === 'supported-destination-eligibility-checker';
            return managed || legacy;
        }),
    );
}
