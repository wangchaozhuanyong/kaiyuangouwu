// @vitest-environment jsdom
import { act, useLayoutEffect, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { applyInitialLoadingBrand } from './brand-loading-bootstrap';
import {
    beginStorefrontRecoveryScope,
    setStorefrontRecoveryBrand,
    StorefrontErrorBoundary,
} from './StorefrontErrorBoundary';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const scopeA = { channelCode: 'store-a', currencyCode: 'MYR', languageCode: 'zh_Hans' };
const scopeB = { ...scopeA, channelCode: 'store-b' };
const brandA = { channelCode: 'store-a', name: '甲店', logoUrl: '/store-a.png' };
const brandB = { channelCode: 'store-b', name: '乙店', logoUrl: '/store-b.png' };
let root: Root | undefined;
let host: HTMLDivElement | undefined;

function mountDocumentLoading() {
    document.body.insertAdjacentHTML(
        'beforeend',
        `<main id="storefront-boot-loading" aria-hidden="true">
            <span class="brand-loading">
                <span class="brand-loading-caption"><span class="brand-loading-label"></span></span>
            </span>
        </main><div id="root"></div>`,
    );
    const boot = document.getElementById('storefront-boot-loading');
    if (!boot) throw new Error('Document loading fixture is missing');
    return boot;
}

function failedBoundary(language = 'zh-CN') {
    document.documentElement.lang = language;
    const boundary = new StorefrontErrorBoundary({ children: 'storefront' });
    boundary.state = { failed: true };
    return boundary.render() as ReactElement;
}

function renderFailure(language?: string) {
    if (!root || !host) {
        host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
    }
    const mountedRoot = root;
    act(() => mountedRoot.render(failedBoundary(language)));
    return host;
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    const mountedRoot = root;
    if (mountedRoot) act(() => mountedRoot.unmount());
    host?.remove();
    root = undefined;
    host = undefined;
    beginStorefrontRecoveryScope({ channelCode: '', currencyCode: '', languageCode: '' });
    document.getElementById('storefront-boot-loading')?.remove();
    document.getElementById('root')?.remove();
    sessionStorage.clear();
});

describe('StorefrontErrorBoundary', () => {
    it('contains an optional feature failure without declaring the whole page failed', () => {
        host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
        const mountedRoot = root;
        const pageError = vi.fn();
        const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        document.addEventListener('storefront:page-error', pageError);
        function BrokenFeature(): never {
            throw new Error('Optional resource unavailable');
        }
        try {
            act(() =>
                mountedRoot.render(
                    <>
                        <main>Existing content</main>
                        <StorefrontErrorBoundary fallback={<button>Retry this feature</button>}>
                            <BrokenFeature />
                        </StorefrontErrorBoundary>
                    </>,
                ),
            );
            expect(host.querySelector('main')?.textContent).toBe('Existing content');
            expect(host.querySelector('button')?.textContent).toBe('Retry this feature');
            expect(host.querySelector('.fatal-error-page')).toBeNull();
            expect(pageError).not.toHaveBeenCalled();
            expect(diagnostic).toHaveBeenCalled();
        } finally {
            document.removeEventListener('storefront:page-error', pageError);
        }
    });
    it('preserves the confirmed parser logo through its first owner commit without showing hidden loading', () => {
        const boot = mountDocumentLoading();
        applyInitialLoadingBrand({
            language: 'zh_Hans',
            storefrontName: brandA.name,
            logoUrl: brandA.logoUrl,
            secondaryName: 'Store A',
        });
        const image = boot.querySelector('img');
        const owner = beginStorefrontRecoveryScope(scopeA);
        expect(boot.querySelector('img')).toBe(image);
        setStorefrontRecoveryBrand(owner, { ...brandA, secondaryName: 'Store A' });
        expect(boot.querySelector('img')).toBe(image);
        expect(boot.querySelector('.brand-loading-subtitle')?.textContent).toBe('Store A');
        expect(boot.getAttribute('aria-hidden')).toBe('true');
        expect(document.documentElement.hasAttribute('data-storefront-boot-pending')).toBe(false);
    });

    it('keeps retained document branding scoped across language changes and rejects previous owners', () => {
        const boot = mountDocumentLoading();
        const original = beginStorefrontRecoveryScope(scopeA);
        setStorefrontRecoveryBrand(original, brandA);
        const english = beginStorefrontRecoveryScope({ ...scopeA, languageCode: 'en' });
        expect(boot.querySelector('.brand-loading-name')?.textContent).toBe('');
        expect(boot.querySelector('img')).toBeNull();
        setStorefrontRecoveryBrand(original, brandA);
        expect(boot.querySelector('.brand-loading-name')?.textContent).toBe('');
        setStorefrontRecoveryBrand(english, { ...brandA, name: 'Store A' });
        expect(boot.querySelector('.brand-loading-name')?.textContent).toBe('Store A');
        expect(boot.querySelector('.brand-loading-label')?.textContent).toBe('Loading');
        const next = beginStorefrontRecoveryScope(scopeB);
        expect(boot.querySelector('.brand-loading-name')?.textContent).toBe('');
        setStorefrontRecoveryBrand(next, brandB);
        expect(boot.querySelector('.brand-loading-name')?.textContent).toBe('乙店');
        setStorefrontRecoveryBrand(english, brandA);
        expect(boot.querySelector('.brand-loading-name')?.textContent).toBe('乙店');
        setStorefrontRecoveryBrand(next, null);
        expect(boot.querySelector('.brand-loading-name')?.textContent).toBe('');
        expect(boot.querySelector('img')).toBeNull();
    });

    it('renders the storefront while no render error has occurred', () => {
        const boundary = new StorefrontErrorBoundary({ children: 'storefront' });

        expect(boundary.render()).toBe('storefront');
    });

    it.each([
        ['zh-CN', '页面暂时无法显示', '重新加载'],
        ['en-US', 'This page could not be displayed', 'Reload'],
        ['en-MY', 'This page could not be displayed', 'Reload'],
    ])('renders a localized recovery action for %s', (language, title, action) => {
        const page = renderFailure(language);
        expect(page.querySelector('h1')?.textContent).toBe(title);
        expect(page.querySelector('button')?.textContent).toBe(action);
        expect(page.querySelector('[role="alert"]')).not.toBeNull();
    });

    it('ignores an unscoped persisted logo when the current store is unknown', () => {
        sessionStorage.setItem('__storefront_logo_url__', '/previous-store.png');
        const page = renderFailure();
        expect(page.querySelector('img')).toBeNull();
        expect(page.querySelector('.brand-loading')).toBeNull();
        expect(page.textContent).not.toContain('◇');
    });

    it('retains the committed name and logo across an ordinary same-scope render failure', () => {
        const owner = beginStorefrontRecoveryScope(scopeA);
        setStorefrontRecoveryBrand(owner, brandA);
        expect(beginStorefrontRecoveryScope({ ...scopeA })).toBe(owner);
        const page = renderFailure();
        expect(page.querySelector('.brand-loading-name')?.textContent).toBe('甲店');
        expect(page.querySelector('img')?.getAttribute('src')).toBe('/store-a.png');
        expect(page.querySelector('.brand-loading-dots, .brand-loading-bar')).toBeNull();
    });

    it('clears the old brand as soon as another scope begins, before that scope commits', () => {
        const ownerA = beginStorefrontRecoveryScope(scopeA);
        setStorefrontRecoveryBrand(ownerA, brandA);
        const ownerB = beginStorefrontRecoveryScope(scopeB);
        setStorefrontRecoveryBrand(ownerA, brandA);
        expect(renderFailure().querySelector('.brand-loading')).toBeNull();
        setStorefrontRecoveryBrand(ownerB, brandB);
        expect(renderFailure().querySelector('.brand-loading-name')?.textContent).toBe('乙店');
    });

    it('rejects a stale commit after A to B to A and never accepts a different channel', () => {
        const originalOwnerA = beginStorefrontRecoveryScope(scopeA);
        setStorefrontRecoveryBrand(originalOwnerA, brandA);
        beginStorefrontRecoveryScope(scopeB);
        const currentOwnerA = beginStorefrontRecoveryScope(scopeA);
        expect(currentOwnerA).not.toBe(originalOwnerA);
        setStorefrontRecoveryBrand(originalOwnerA, brandA);
        expect(renderFailure().querySelector('.brand-loading')).toBeNull();
        setStorefrontRecoveryBrand(currentOwnerA, brandB);
        expect(renderFailure().querySelector('.brand-loading')).toBeNull();
        setStorefrontRecoveryBrand(currentOwnerA, brandA);
        setStorefrontRecoveryBrand(originalOwnerA, null);
        expect(renderFailure().querySelector('.brand-loading-name')?.textContent).toBe('甲店');
    });

    it('clears a known brand immediately when identity is unresolved or unavailable', () => {
        const owner = beginStorefrontRecoveryScope(scopeA);
        setStorefrontRecoveryBrand(owner, brandA);
        setStorefrontRecoveryBrand(owner, null);
        expect(renderFailure().querySelector('.brand-loading')).toBeNull();
    });

    it('never commits a different brand from a render that crashes during the store switch', () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        function Crash() {
            throw new Error('Simulated route render failure');
            return null;
        }
        function Store({ brand, crash = false }: { brand: typeof brandA; crash?: boolean }) {
            const owner = beginStorefrontRecoveryScope({ ...scopeA, channelCode: brand.channelCode });
            useLayoutEffect(() => setStorefrontRecoveryBrand(owner, brand), [owner, brand]);
            return crash ? <Crash /> : <div>{brand.name}</div>;
        }
        host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
        const mountedRoot = root;
        act(() =>
            mountedRoot.render(
                <StorefrontErrorBoundary>
                    <Store brand={brandA} />
                </StorefrontErrorBoundary>,
            ),
        );
        expect(host.textContent).toBe('甲店');
        act(() =>
            mountedRoot.render(
                <StorefrontErrorBoundary>
                    <Store brand={brandB} crash />
                </StorefrontErrorBoundary>,
            ),
        );
        expect(host.querySelector('[role="alert"]')).not.toBeNull();
        expect(host.querySelector('.brand-loading')).toBeNull();
        expect(host.textContent).not.toContain('甲店');
        expect(host.textContent).not.toContain('乙店');
    });

    it.each([
        { ...scopeA, currencyCode: 'CNY' },
        { ...scopeA, languageCode: 'en' },
    ])('does not reuse a name from a different display scope: %j', nextScope => {
        const owner = beginStorefrontRecoveryScope(scopeA);
        setStorefrontRecoveryBrand(owner, brandA);
        beginStorefrontRecoveryScope(nextScope);
        expect(renderFailure().querySelector('.brand-loading')).toBeNull();
    });

    it('discards branding owned by another origin or document', () => {
        const owner = beginStorefrontRecoveryScope(scopeA);
        setStorefrontRecoveryBrand(owner, brandA);
        vi.stubGlobal('window', { location: { origin: 'https://another-store.example' } });
        const foreignOrigin = failedBoundary() as ReactElement<{ children: unknown[] }>;
        expect(foreignOrigin.props.children[0]).toBeNull();
        vi.unstubAllGlobals();

        const newOwner = beginStorefrontRecoveryScope(scopeA);
        setStorefrontRecoveryBrand(newOwner, brandA);
        vi.stubGlobal('document', document.implementation.createHTMLDocument('Other document'));
        const foreignDocument = failedBoundary() as ReactElement<{ children: unknown[] }>;
        expect(foreignDocument.props.children[0]).toBeNull();
    });

    it('keeps the confirmed name when no logo is configured', () => {
        const owner = beginStorefrontRecoveryScope(scopeA);
        setStorefrontRecoveryBrand(owner, { ...brandA, logoUrl: null });
        const page = renderFailure();
        expect(page.querySelector('img')).toBeNull();
        expect(page.querySelector('.brand-loading-name')?.textContent).toBe('甲店');
    });

    it('retries the original merchant image once, then keeps only the current store name', () => {
        const owner = beginStorefrontRecoveryScope(scopeA);
        const source = '/assets/preview/6e/store-icon__preview.webp';
        setStorefrontRecoveryBrand(owner, { ...brandA, logoUrl: source });
        const page = renderFailure();
        const image = page.querySelector('img');
        if (!image) throw new Error('Expected the current store image');
        expect(image.getAttribute('src')).not.toBe(source);
        act(() => {
            image.dispatchEvent(new Event('error'));
        });
        expect(page.querySelector('img')?.getAttribute('src')).toBe(source);
        const fallbackImage = page.querySelector('img');
        if (!fallbackImage) throw new Error('Expected the original store image fallback');
        act(() => {
            fallbackImage.dispatchEvent(new Event('error'));
        });
        expect(page.querySelector('img')).toBeNull();
        expect(page.querySelector('.brand-loading-name')?.textContent).toBe('甲店');
    });
});
