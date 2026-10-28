// @vitest-environment jsdom
import { act } from 'react';
import { hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { StorefrontPageFrame } from './storefront-page-frame';
import { type RouteName } from './storefront-router';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe('public header ownership', () => {
    let root: Root | undefined;
    let host: HTMLDivElement | undefined;
    afterEach(() => {
        if (root) act(() => root?.unmount());
        host?.remove();
        root = undefined;
    });

    it.each(['home', 'category', 'product', 'search'] as const)(
        'retains the %s header and page when viewport subscription enables interactive controls',
        async routeName => {
            const click = vi.fn();
            const frame = (desktop: boolean, route: RouteName = routeName) => (
                <StorefrontPageFrame
                    routeName={route}
                    language="zh"
                    desktop={desktop}
                    storefrontName="Fixture storefront"
                    logoUrl={null}
                    displayCurrencyCode="CNY"
                    header={desktop ? <button onClick={click}>Interactive control</button> : undefined}
                >
                    <main>Existing public content</main>
                </StorefrontPageFrame>
            );
            const element = document.createElement('div');
            host = element;
            host.innerHTML = renderToString(frame(false));
            document.body.append(host);
            const header = host.querySelector('header');
            const content = host.querySelector('main');
            const error = vi.fn();
            await act(async () => {
                root = hydrateRoot(element, frame(false), { onRecoverableError: error });
                await Promise.resolve();
            });
            act(() => root?.render(frame(true)));
            expect(error).not.toHaveBeenCalled();
            expect(host.querySelector('header')).toBe(header);
            expect(host.querySelector('main')).toBe(content);
            expect(host.querySelectorAll('header')).toHaveLength(1);
            expect(header?.classList.contains('responsive-home-header-placeholder')).toBe(false);
            expect(header?.classList.contains('is-search-page')).toBe(routeName === 'search');
            act(() => host?.querySelector('button')?.click());
            expect(click).toHaveBeenCalledOnce();
            act(() => root?.render(frame(false)));
            expect(host.querySelector('header')).toBe(header);
            expect(header?.classList.contains('responsive-home-header-placeholder')).toBe(true);
            expect(host.querySelector('main')).toBe(content);
        },
    );
});
