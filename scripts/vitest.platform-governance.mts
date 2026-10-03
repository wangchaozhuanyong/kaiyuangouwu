import path from 'node:path';
import { fileURLToPath } from 'node:url';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

import { nestTestAliases } from '../vitest.shared.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const plugins = [
    'catalog-management-plugin',
    'store-management-plugin',
    'commerce-fulfillment-plugin',
    'storefront-cart-plugin',
    'storefront-catalog-plugin',
    'content-translation-plugin',
    'operations-dashboard-plugin',
    'storefront-content-plugin',
    'store-domain-plugin',
];
export default defineConfig({
    root,
    resolve: {
        alias: [
            {
                find: '@vendure/store-management-plugin/currency-conversion',
                replacement: path.join(
                    root,
                    'packages/store-management-plugin/src/store-currency-price-selection-strategy.ts',
                ),
            },
            ...plugins.map(p => ({
                find: new RegExp(`^@vendure/${p}$`),
                replacement: path.join(root, `packages/${p}/src/index.ts`),
            })),
            ...Object.entries(nestTestAliases).map(([find, replacement]) => ({ find, replacement })),
        ],
        dedupe: ['react', 'react-dom'],
    },
    test: {
        include: [
            'packages/**/*.spec.ts',
            'packages/**/*.spec.tsx',
            'packages/**/platform-governance.e2e-spec.ts',
        ],
        exclude: ['**/node_modules/**', '**/dist/**', '**/artifacts/**'],
        maxWorkers: 1,
        testTimeout: 30000,
        hookTimeout: 120000,
    },
    plugins: [
        swc.vite({ jsc: { transform: { useDefineForClassFields: false, react: { runtime: 'automatic' } } } }),
    ],
});
