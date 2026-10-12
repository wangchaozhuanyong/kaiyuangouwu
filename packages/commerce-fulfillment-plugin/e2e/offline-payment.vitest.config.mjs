import { defineConfig } from 'vitest/config';

import base from './order-closure.vitest.config.mjs';
export default defineConfig({
    ...base,
    test: { ...base.test, include: ['packages/commerce-fulfillment-plugin/e2e/offline-payment.e2e-spec.ts'] },
});
