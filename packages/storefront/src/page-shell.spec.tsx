import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { AsyncRouteStatePage, SubHeader, Subpage } from './storefront-ui/page-shell';
import { readStorefrontStylesheet } from './test-stylesheet';

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

    it('lets the desktop account rail replace duplicate subpage titles without hiding real actions', () => {
        const stylesheet = readStorefrontStylesheet();

        expect(stylesheet).toMatch(
            /\.desktop-account-layout \.page\.subpage > \.subpage-header:not\(\[data-desktop-actions\]\)\s*\{[^}]*display:\s*none;/u,
        );
        expect(stylesheet).toMatch(
            /\.desktop-account-layout \.subpage-header > :is\(button:first-child, strong\)\s*\{[^}]*display:\s*none;/u,
        );
        expect(stylesheet).toMatch(
            /\.desktop-account-layout \.subpage-header-actions\s*\{[^}]*margin-left:\s*auto;/u,
        );
    });
});

describe('SubHeader action visibility', () => {
    it('marks real desktop actions so the account rail can retain them', () => {
        const markup = renderToStaticMarkup(
            <SubHeader
                title="选择收货地址"
                language="zh"
                onBack={vi.fn()}
                action={<button>新增地址</button>}
            />,
        );
        expect(markup).toContain('data-desktop-actions="true"');
        expect(markup).toContain('新增地址');
    });
    it('does not reserve a desktop row for an absent action or a mobile toolbar', () => {
        for (const action of [undefined, <button key="add">新增地址</button>]) {
            const markup = renderToStaticMarkup(
                <SubHeader
                    title="收货地址"
                    language="zh"
                    onBack={vi.fn()}
                    action={action}
                    actionVisibility="mobile"
                />,
            );
            expect(markup).not.toContain('data-desktop-actions');
            expect(markup).toContain('data-action-visibility="mobile"');
            expect(markup).toContain('收货地址');
            expect(markup).toContain('aria-label="返回"');
        }
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
        expect(accountMarkup).not.toContain('lg:pt-[72px]');
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
