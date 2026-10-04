import { defaultConfig, defaultOrderProcess, getConfigurationFunction, mergeConfig } from '@vendure/core';
import { StorefrontCartPlugin } from '@vendure/storefront-cart-plugin';
import { createRequire } from 'node:module';
import { expect, it } from 'vitest';

const { CommerceFulfillmentPlugin } = createRequire(import.meta.url)(
    '../dist/commerce-fulfillment.plugin.js',
);

it('retains the registered cart guard through actual plugin configuration after bootstrap cloning', async () => {
    const cartConfiguration = getConfigurationFunction(StorefrontCartPlugin);
    const commerceConfiguration = getConfigurationFunction(CommerceFulfillmentPlugin);
    if (!cartConfiguration || !commerceConfiguration) throw new Error('Missing plugin configuration');
    const config = mergeConfig(defaultConfig, {});
    const copiedDefault = config.orderOptions.process?.[0];
    await cartConfiguration(config);
    const cartGuard = config.orderOptions.process?.at(-1);
    await commerceConfiguration(config);
    expect(config.orderOptions.process).toContain(cartGuard);
    expect(config.orderOptions.process).not.toContain(copiedDefault);
    expect(
        config.orderOptions.process?.some(
            process => process.onTransitionStart === defaultOrderProcess.onTransitionStart,
        ),
    ).toBe(false);
});
