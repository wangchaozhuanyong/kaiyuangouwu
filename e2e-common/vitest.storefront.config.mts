import { fileURLToPath } from 'node:url';

import base from './vitest.config.mts';

// These suites import plugin services from source. Their transitive plugin
// imports must share that identity, rather than registering source and dist twice.
export default {
    ...base,
    resolve: {
        alias: ['catalog-management-plugin', 'storefront-catalog-plugin', 'store-management-plugin'].map(
            name => ({
                find: new RegExp(`^@vendure/${name}$`),
                replacement: fileURLToPath(new URL(`../packages/${name}/src/index.ts`, import.meta.url)),
            }),
        ),
    },
};
