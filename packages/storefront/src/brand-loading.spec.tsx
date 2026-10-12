// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';

import { BrandLoadingIndicator } from './brand-loading';
import { PageSkeleton } from './route-loading';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('renders a usable pending region on the first commit without a second visual-module wait', () => {
    const host = document.createElement('div');
    const root = createRoot(host);
    try {
        act(() => root.render(<PageSkeleton language="zh" root />));
        expect(host.querySelector('main[role="status"]')?.getAttribute('aria-label')).toBe('正在加载页面');
        expect(host.querySelector('[data-page-pending="data"]')).not.toBeNull();
        expect(host.querySelector('.brand-loading-bar')).not.toBeNull();
        expect(host.querySelector('[role="alert"]')).toBeNull();
    } finally {
        act(() => root.unmount());
    }
});

it('keeps the current brand in a local route wait and stops animation for a static error identity', () => {
    const host = document.createElement('div');
    const root = createRoot(host);
    try {
        act(() =>
            root.render(
                <BrandLoadingIndicator
                    local
                    language="en"
                    logoUrl="/brand.png"
                    storefrontName="Example"
                    label="Loading page"
                />,
            ),
        );
        expect(host.querySelector('.page-loading-indicator img')).not.toBeNull();
        expect(host.textContent).toContain('Loading page');
        expect(host.querySelector('.brand-loading-dots')).not.toBeNull();
        act(() =>
            root.render(
                <BrandLoadingIndicator
                    language="en"
                    logoUrl="/brand.png"
                    storefrontName="Example"
                    pending={false}
                />,
            ),
        );
        expect(host.textContent).toContain('Example');
        expect(host.querySelector('.brand-loading-bar')).toBeNull();
        expect(host.querySelector('.brand-loading-dots')).toBeNull();
    } finally {
        act(() => root.unmount());
    }
});
