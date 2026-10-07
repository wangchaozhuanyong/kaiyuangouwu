import config from './order-closure.vitest.config.mjs';

export default {
    ...config,
    test: {
        ...config.test,
        include: ['packages/commerce-fulfillment-plugin/e2e/public-preview-simulation.e2e-spec.ts'],
    },
};
