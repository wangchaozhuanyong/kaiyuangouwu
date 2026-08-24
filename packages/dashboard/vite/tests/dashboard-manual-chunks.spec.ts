import { describe, expect, it } from 'vitest';

import { dashboardManualChunks } from '../dashboard-manual-chunks.js';

describe('dashboardManualChunks', () => {
    it.each([
        ['/workspace/node_modules/@tanstack/react-query/build/index.js', 'vendor-tanstack'],
        ['/workspace/node_modules/lucide-react/dist/cjs/lucide-react.js', 'vendor-icons'],
        ['/workspace/node_modules/@tiptap/core/dist/index.js', 'vendor-rich-text'],
        ['/workspace/node_modules/date-fns/format.js', 'vendor-date-fns'],
        [
            '/workspace/node_modules/date-fns/locale/zh-CN/_lib/formatDistance.js',
            'vendor-calendar-locale-zh-cn',
        ],
        ['/workspace/node_modules/date-fns/locale/en-US/_lib/formatDistance.js', 'vendor-date-fns'],
        ['/workspace/node_modules/react-day-picker/dist/esm/locale/zh-CN.js', 'vendor-calendar-locale-zh-cn'],
        ['/workspace/node_modules/@vendure-io/ui/src/components/ui/chart.tsx', 'vendor-charts'],
        ['/workspace/node_modules/@vendure-io/ui/src/components/ui/button.tsx', 'vendor-ui'],
        ['/workspace/node_modules/@base-ui/react/dialog/index.js', 'vendor-ui'],
        ['/workspace/node_modules/cmdk/dist/index.mjs', 'vendor-ui'],
        ['/workspace/node_modules/react-hook-form/dist/index.esm.mjs', 'vendor-dashboard-support'],
        ['/workspace/node_modules/@dnd-kit/core/dist/core.esm.js', 'vendor-dashboard-support'],
        ['C:\\workspace\\node_modules\\recharts\\es6\\index.js', 'vendor-charts'],
        ['/workspace/packages/dashboard/src/lib/components/data-table/data-table.tsx', 'dashboard-framework'],
        [
            '/workspace/packages/dashboard/src/lib/framework/form-engine/use-generated-form.tsx',
            'dashboard-framework',
        ],
        [
            '/workspace/packages/dashboard/src/lib/components/shared/rich-text-editor/rich-text-editor.tsx',
            'dashboard-framework',
        ],
    ])('maps %s to %s', (id, expected) => {
        expect(dashboardManualChunks(id)).toBe(expected);
    });

    it('keeps unrelated modules in Rollup automatic chunks', () => {
        expect(dashboardManualChunks('/workspace/packages/dashboard/src/app/main.tsx')).toBeUndefined();
        expect(
            dashboardManualChunks('/workspace/node_modules/date-fns/locale/af/_lib/formatDistance.js'),
        ).toBeUndefined();
    });
});
