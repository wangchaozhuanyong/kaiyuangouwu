import { describe, expect, it } from 'vitest';

import { dashboardManualChunks } from '../dashboard-manual-chunks.js';

describe('dashboardManualChunks', () => {
    it.each([
        ['/workspace/node_modules/@tanstack/react-query/build/index.js', 'vendor-tanstack'],
        ['/workspace/node_modules/lucide-react/dist/cjs/lucide-react.js', 'vendor-icons'],
        ['/workspace/node_modules/@tiptap/core/dist/index.js', 'vendor-rich-text'],
        ['/workspace/node_modules/date-fns/format.js', 'vendor-date-fns'],
        ['/workspace/node_modules/@vendure-io/ui/src/components/ui/chart.tsx', 'vendor-charts'],
        ['/workspace/node_modules/@vendure-io/ui/src/components/ui/button.tsx', 'vendor-ui'],
        ['/workspace/node_modules/@base-ui/react/dialog/index.js', 'vendor-ui'],
        ['/workspace/node_modules/cmdk/dist/index.mjs', 'vendor-ui'],
        ['C:\\workspace\\node_modules\\recharts\\es6\\index.js', 'vendor-charts'],
    ])('maps %s to %s', (id, expected) => {
        expect(dashboardManualChunks(id)).toBe(expected);
    });

    it('keeps unrelated modules in Rollup automatic chunks', () => {
        expect(dashboardManualChunks('/workspace/packages/dashboard/src/app/main.tsx')).toBeUndefined();
    });
});
