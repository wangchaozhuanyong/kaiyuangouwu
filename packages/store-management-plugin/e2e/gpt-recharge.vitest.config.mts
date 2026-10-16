import { defineConfig } from 'vitest/config';
export default defineConfig({
    test: {
        include: ['e2e/gpt-recharge-http.e2e-spec.ts'],
        testTimeout: 20000,
        hookTimeout: 20000,
        fileParallelism: false,
    },
});
