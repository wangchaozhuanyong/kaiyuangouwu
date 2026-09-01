import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('browser translation compatibility', () => {
    it('keeps the storefront document translatable by browser tools', () => {
        const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

        expect(html).toMatch(/<html\s+lang="zh-CN"\s+translate="yes">/u);
        expect(html).not.toMatch(/<meta[^>]+name=["']google["'][^>]+notranslate/iu);
        expect(html).not.toContain('class="notranslate"');
        expect(html).not.toContain('translate="no"');
    });
});
