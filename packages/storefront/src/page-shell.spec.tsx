import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { AsyncRouteStatePage, Subpage } from './storefront-ui/page-shell';

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

describe('AsyncRouteStatePage layout', () => {
    it('uses headerless route skeletons for root pages rendered with the desktop navigation', () => {
        const accountMarkup = renderToStaticMarkup(
            <AsyncRouteStatePage
                routeName="account"
                state="loading"
                error=""
                language="en"
                onBack={vi.fn()}
                onRetry={vi.fn()}
            />,
        );
        const cartMarkup = renderToStaticMarkup(
            <AsyncRouteStatePage
                routeName="cart"
                state="loading"
                error=""
                language="en"
                onBack={vi.fn()}
                onRetry={vi.fn()}
            />,
        );

        expect(accountMarkup).toContain('route-state-page');
        expect(accountMarkup).toContain('lg:pt-[72px]');
        expect(accountMarkup).toContain('page-skeleton--account');
        expect(accountMarkup).not.toContain('subpage-header');
        expect(cartMarkup).toContain('page-skeleton--checkout');
        expect(cartMarkup).not.toContain('subpage-header');
    });

    it('keeps the subpage header for non-root route states', () => {
        const markup = renderToStaticMarkup(
            <AsyncRouteStatePage
                routeName="orders"
                state="loading"
                error=""
                language="en"
                onBack={vi.fn()}
                onRetry={vi.fn()}
            />,
        );

        expect(markup).toContain('subpage-header');
        expect(markup).toContain('My orders');
    });
});
