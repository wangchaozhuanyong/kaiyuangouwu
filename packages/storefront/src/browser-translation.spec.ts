import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('browser translation compatibility', () => {
    it('keeps the storefront document translatable by browser tools', () => {
        const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

        const rootTag = html.match(/<html\b[^>]*>/u)?.[0];
        expect(rootTag).toContain('lang="zh-CN"');
        expect(rootTag).toContain('translate="yes"');
        expect(html).not.toMatch(/<meta[^>]+name=["']google["'][^>]+notranslate/iu);
        expect(html).not.toContain('class="notranslate"');
        expect(html).not.toContain('translate="no"');
    });
});
