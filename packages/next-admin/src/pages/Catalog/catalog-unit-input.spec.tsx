import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { CatalogUnitInput } from './catalog-unit-input';
import { CATALOG_UNIT_PRESETS } from './catalog-unit-presets';

describe('CatalogUnitInput', () => {
    it('provides common retail sale and purchase units', () => {
        expect(CATALOG_UNIT_PRESETS).toContain('瓶');
        expect(CATALOG_UNIT_PRESETS).toContain('箱');
        expect(CATALOG_UNIT_PRESETS).toContain('盒');
        expect(CATALOG_UNIT_PRESETS).toContain('千克');
        expect(new Set(CATALOG_UNIT_PRESETS).size).toBe(CATALOG_UNIT_PRESETS.length);
    });

    it('selects a preset unit without showing the custom input', () => {
        const html = renderToStaticMarkup(<CatalogUnitInput value="瓶" onChange={vi.fn()} />);

        expect(html).toContain('<option value="瓶" selected="">瓶</option>');
        expect(html).not.toContain('单位自定义值');
    });

    it('keeps a previously saved custom unit editable', () => {
        const html = renderToStaticMarkup(<CatalogUnitInput value="扎" onChange={vi.fn()} />);

        expect(html).toContain('<option value="__custom_unit__" selected="">自定义单位…</option>');
        expect(html).toContain('aria-label="单位自定义值"');
        expect(html).toContain('value="扎"');
    });
});
