import config from '../order-closure.vitest.config.mjs';

export default {
    ...config,
    test: {
        ...config.test,
        include: [
            'packages/commerce-fulfillment-plugin/e2e/order37-digital-closeout/order37-digital-closeout.e2e-spec.ts',
        ],
        hookTimeout: 300000,
    },
};
