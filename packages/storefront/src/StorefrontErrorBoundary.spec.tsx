import { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { StorefrontErrorBoundary } from './StorefrontErrorBoundary';

function failedBoundary(language: string) {
    vi.stubGlobal('document', { documentElement: { lang: language } });
    const boundary = new StorefrontErrorBoundary({ children: 'storefront' });
    boundary.state = { failed: true };
    return boundary.render() as ReactElement<{
        children: Array<ReactElement<{ children: string }>>;
    }>;
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('StorefrontErrorBoundary', () => {
    it('renders the storefront while no render error has occurred', () => {
        const boundary = new StorefrontErrorBoundary({ children: 'storefront' });

        expect(boundary.render()).toBe('storefront');
    });

    it('renders a localized recovery action after a render error', () => {
        const chineseFallback = failedBoundary('zh-CN');
        const englishFallback = failedBoundary('en');

        expect(chineseFallback.props.children[1].props.children).toBe('页面暂时无法显示');
        expect(chineseFallback.props.children[3].props.children).toBe('重新加载');
        expect(englishFallback.props.children[1].props.children).toBe('This page could not be displayed');
        expect(englishFallback.props.children[3].props.children).toBe('Reload');
    });
});
