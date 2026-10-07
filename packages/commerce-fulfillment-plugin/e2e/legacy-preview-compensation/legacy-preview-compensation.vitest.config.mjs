import config from '../order-closure.vitest.config.mjs';

export default {
    ...config,
    test: {
        ...config.test,
        include: [
            'packages/commerce-fulfillment-plugin/e2e/legacy-preview-compensation/legacy-preview-compensation.e2e-spec.ts',
        ],
        hookTimeout: 300000,
    },
};
