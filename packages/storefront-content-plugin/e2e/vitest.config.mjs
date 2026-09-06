import { defineConfig } from 'vitest/config';

import unitConfig from '../vitest.config.mjs';
export default defineConfig({
    ...unitConfig,
    test: {
        ...unitConfig.test,
        include: ['e2e/storefront-unification.e2e-spec.ts'],
        hookTimeout: 120000,
        testTimeout: 30000,
        maxWorkers: 1,
    },
});
