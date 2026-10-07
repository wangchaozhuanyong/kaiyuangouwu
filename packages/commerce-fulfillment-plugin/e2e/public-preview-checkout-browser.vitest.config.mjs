import config from './public-preview-simulation.vitest.config.mjs';

export default {
    ...config,
    test: {
        ...config.test,
        include: ['packages/commerce-fulfillment-plugin/e2e/public-preview-checkout-browser.e2e-spec.ts'],
    },
};
