import config from '../../commerce-fulfillment-plugin/e2e/order-closure.vitest.config.mjs';

export default {
    ...config,
    test: {
        ...config.test,
        include: ['packages/store-management-plugin/e2e/usdt-preview-receipt.e2e-spec.ts'],
    },
};
