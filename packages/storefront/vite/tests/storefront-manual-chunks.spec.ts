import { describe, expect, it } from 'vitest';

import { storefrontManualChunks } from '../storefront-manual-chunks.js';

describe('storefrontManualChunks', () => {
    it.each([
        ['/workspace/node_modules/react/jsx-runtime.js', 'vendor-react'],
        ['/workspace/node_modules/react-dom/client.js', 'vendor-react'],
        ['/workspace/node_modules/scheduler/index.js', 'vendor-react'],
        ['/workspace/node_modules/@tanstack/react-query/build/modern/index.js', 'vendor-tanstack'],
        ['/workspace/node_modules/@tanstack/react-router/dist/esm/index.js', 'vendor-tanstack'],
        ['C:\\workspace\\node_modules\\@tanstack\\router-core\\dist\\esm\\router.js', 'vendor-tanstack'],
    ])('maps %s to %s', (id, expected) => {
        expect(storefrontManualChunks(id)).toBe(expected);
    });

    it('keeps application and feature-specific dependencies in automatic chunks', () => {
        expect(storefrontManualChunks('/workspace/packages/storefront/src/main.tsx')).toBeUndefined();
        expect(storefrontManualChunks('/workspace/node_modules/qrcode/lib/index.js')).toBeUndefined();
        expect(
            storefrontManualChunks('/workspace/node_modules/lucide-react/dist/esm/lucide-react.js'),
        ).toBeUndefined();
    });
});
