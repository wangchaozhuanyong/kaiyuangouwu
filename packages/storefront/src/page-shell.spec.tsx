import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { Subpage } from './storefront-ui/page-shell';

describe('Subpage surface', () => {
    it('applies a configured page surface color to the entire subpage', () => {
        const markup = renderToStaticMarkup(
            <Subpage title="客服中心" language="zh" onBack={vi.fn()} surfaceColor="  #fff7ed  ">
                <p>客服内容</p>
            </Subpage>,
        );

        expect(markup).toContain('style="--page-surface:#fff7ed"');
    });

    it('keeps the default page surface when no color is configured', () => {
        const markup = renderToStaticMarkup(
            <Subpage title="客服中心" language="zh" onBack={vi.fn()}>
                <p>客服内容</p>
            </Subpage>,
        );

        expect(markup).not.toContain('--page-surface');
    });
});
