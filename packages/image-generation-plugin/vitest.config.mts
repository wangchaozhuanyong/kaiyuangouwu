import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    resolve: {
        alias: {
            '@vendure/store-management-plugin/currency-conversion': path.resolve(
                __dirname,
                '../store-management-plugin/src/store-currency-price-selection-strategy.ts',
            ),
        },
    },
});
