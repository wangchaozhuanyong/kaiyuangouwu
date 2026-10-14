// @vitest-environment jsdom
import { existsSync, readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { publicPageRequestKey } from '../../storefront-content-plugin/src/shared/public-page-data';

import { applyInitialLoadingBrand, initialLoadingBrandForSnapshot } from './brand-loading-bootstrap';

const repositoryIndex = resolvePath(process.cwd(), 'packages/storefront/index.html');
const indexHtml = readFileSync(
    existsSync(repositoryIndex) ? repositoryIndex : resolvePath(process.cwd(), 'index.html'),
    'utf8',
);
const originalDecode = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'decode');
const request = { kind: 'home' } as const;
const scope = { host: 'store.test', request, now: 20_000 };
const brand = {
    language: 'zh_Hans' as const,
    storefrontName: '当前店铺',
    secondaryName: 'Current store',
    logoUrl: '/assets/preview/current-store.png',
};

function snapshot() {
    return {
        schemaVersion: 1,
        generatedAt: 10_000,
        requestKey: publicPageRequestKey(request),
        scope: {
            host: 'store.test',
            channelCode: 'store-a',
            languageCode: 'zh_Hans',
            currencyCode: 'MYR',
            priceContext: 'public',
        },
        config: {
            code: 'store-a',
            accessMode: 'LIVE',
            logoUrl: brand.logoUrl,
            customFields: { storefrontNameZh: brand.storefrontName, storefrontNameEn: 'Current store' },
            availableCountries: [],
        },
        media: [],
        failures: [],
    };
}

beforeEach(() => {
    Object.defineProperty(HTMLImageElement.prototype, 'decode', {
        configurable: true,
        writable: true,
        value: () => Promise.resolve(),
    });
    const parsed = new DOMParser().parseFromString(indexHtml, 'text/html');
    const root = parsed.getElementById('root');
    const boot = parsed.getElementById('storefront-boot-loading');
    if (!root || !boot) throw new Error('Initial storefront loader is missing');
    document.body.replaceChildren(
        ...(!root.contains(boot) ? [document.importNode(boot, true)] : []),
        document.importNode(root, true),
    );
});
afterEach(() => {
    vi.restoreAllMocks();
    if (originalDecode) Object.defineProperty(HTMLImageElement.prototype, 'decode', originalDecode);
    else Reflect.deleteProperty(HTMLImageElement.prototype, 'decode');
    document.body.replaceChildren();
});

describe('parser-time storefront loading', () => {
    it('provides a viewport pending state before JavaScript without an invented store brand', () => {
        const pending = document.querySelector('main[role="status"]');
        expect(pending?.getAttribute('aria-label')).toBe('正在加载页面');
        expect(pending?.getAttribute('aria-busy')).toBe('true');
        expect(pending?.classList.contains('page-skeleton--viewport')).toBe(true);
        expect(pending?.querySelectorAll('.brand-loading-bar > i')).toHaveLength(1);
        expect(pending?.querySelector('img, svg')).toBeNull();
        expect(pending?.querySelector('.brand-loading-name')?.textContent).toBe('');
        expect(pending?.querySelector('.route-transition-mark')).not.toBeNull();
        expect(pending?.querySelector('.brand-loading-subtitle')?.textContent).toBe('');
    });

    it('uses only a live, current public host and request scope for its brand', () => {
        const current = snapshot();
        expect(initialLoadingBrandForSnapshot(current, scope)).toEqual(brand);
        for (const invalid of [
            null,
            { ...current, schemaVersion: 2 },
            { ...current, generatedAt: -10_001 },
            { ...current, generatedAt: 25_001 },
            { ...current, generatedAt: Number.NaN },
            { ...current, requestKey: 'another-route' },
            { ...current, scope: { ...current.scope, host: 'other.test' } },
            { ...current, scope: { ...current.scope, priceContext: 'customer' } },
            { ...current, scope: { ...current.scope, languageCode: 'unsupported' } },
            { ...current, config: { ...current.config, code: 'another-store' } },
            { ...current, config: { ...current.config, accessMode: 'PREVIEW' } },
            { ...current, config: { ...current.config, accessMode: 'CLOSED' } },
        ]) {
            expect(initialLoadingBrandForSnapshot(invalid, scope)).toBeUndefined();
        }
        expect(initialLoadingBrandForSnapshot(current, { ...scope, languageCode: 'en' })).toBeUndefined();
        expect(initialLoadingBrandForSnapshot(current, { ...scope, currencyCode: 'CNY' })).toBeUndefined();
        const english = { ...current, scope: { ...current.scope, languageCode: 'en' } };
        expect(initialLoadingBrandForSnapshot(english, scope)?.storefrontName).toBe('Current store');
    });

    it('inserts the saved name as text and keeps unknown branding neutral', () => {
        applyInitialLoadingBrand({ ...brand, logoUrl: '', storefrontName: '' });
        expect(document.querySelector('.brand-loading-name')?.textContent).toBe('');
        expect(document.querySelector('.route-transition-mark')).not.toBeNull();
        expect(document.querySelector('img')).toBeNull();
        applyInitialLoadingBrand({ ...brand, logoUrl: '', storefrontName: '<img src="injected">' });
        expect(document.querySelector('.brand-loading-name')?.textContent).toBe('<img src="injected">');
        expect(document.querySelector('img')).toBeNull();
        expect(document.querySelector('.brand-loading-bar')).not.toBeNull();
    });

    it('waits for the body when the early head script runs before the loader has been parsed', () => {
        vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading');
        const initialNodes = Array.from(document.body.childNodes);
        document.body.replaceChildren();
        applyInitialLoadingBrand({ ...brand, logoUrl: '' });
        document.body.append(...initialNodes);
        expect(document.querySelector('.brand-loading-name')?.textContent).toBe('');
        document.dispatchEvent(new Event('DOMContentLoaded'));
        expect(document.querySelector('.brand-loading-name')?.textContent).toBe(brand.storefrontName);
    });

    it('brands the document stage beside an already rendered public root without changing its content', () => {
        const root = document.getElementById('root');
        const boot = document.getElementById('storefront-boot-loading');
        if (!root || !boot) throw new Error('Initial storefront loader is missing');
        root.before(boot);
        root.dataset.publicRendered = '1';
        root.innerHTML = '<p>Published content</p>';
        applyInitialLoadingBrand({ ...brand, logoUrl: '' });
        expect(boot.querySelector('.brand-loading-name')?.textContent).toBe(brand.storefrontName);
        expect(root.innerHTML).toBe('<p>Published content</p>');
    });

    it('retains support for a client-only loader inside its root', () => {
        const root = document.getElementById('root');
        const boot = document.getElementById('storefront-boot-loading');
        if (!root || !boot) throw new Error('Initial storefront loader is missing');
        root.replaceChildren(boot);
        applyInitialLoadingBrand({ ...brand, logoUrl: '' });
        expect(boot.querySelector('.brand-loading-name')?.textContent).toBe(brand.storefrontName);
    });

    it('does not claim a similarly named loader outside the document startup position', () => {
        const root = document.getElementById('root');
        const boot = document.getElementById('storefront-boot-loading');
        if (!root || !boot) throw new Error('Initial storefront loader is missing');
        root.after(boot);
        applyInitialLoadingBrand({ ...brand, logoUrl: '' });
        expect(boot.querySelector('.brand-loading-name')?.textContent).toBe('');
    });

    it('reveals the real image only after decoding completes', async () => {
        let decoded!: () => void;
        vi.spyOn(HTMLImageElement.prototype, 'decode').mockImplementation(
            () => new Promise<void>(resolve => (decoded = resolve)),
        );
        applyInitialLoadingBrand(brand);
        const image = document.querySelector('img');
        if (!image) throw new Error('Initial storefront image is missing');
        Object.defineProperty(image, 'naturalWidth', { value: 160 });
        image.dispatchEvent(new Event('load'));
        expect(document.querySelector('.is-logo-ready')).toBeNull();
        decoded();
        await Promise.resolve();
        expect(document.querySelector('.is-logo-ready')).not.toBeNull();
    });

    it('retains the same logo and its in-flight decode when React confirms the early brand', async () => {
        let decoded!: () => void;
        const decode = vi
            .spyOn(HTMLImageElement.prototype, 'decode')
            .mockImplementation(() => new Promise<void>(resolve => (decoded = resolve)));
        applyInitialLoadingBrand(brand);
        const image = document.querySelector('img');
        if (!image) throw new Error('Initial storefront image is missing');
        Object.defineProperty(image, 'naturalWidth', { value: 160 });
        image.dispatchEvent(new Event('load'));
        applyInitialLoadingBrand({ ...brand });
        expect(document.querySelector('img')).toBe(image);
        expect(decode).toHaveBeenCalledOnce();
        decoded();
        await Promise.resolve();
        expect(document.querySelector('.is-logo-ready')).not.toBeNull();
        applyInitialLoadingBrand({ ...brand });
        expect(document.querySelector('img')).toBe(image);
        expect(document.querySelector('.is-logo-ready')).not.toBeNull();
    });

    it('does not change React-owned markup when an old image finishes decoding', async () => {
        let decoded!: () => void;
        vi.spyOn(HTMLImageElement.prototype, 'decode').mockImplementation(
            () => new Promise<void>(resolve => (decoded = resolve)),
        );
        applyInitialLoadingBrand(brand);
        const image = document.querySelector('img');
        if (!image) throw new Error('Initial storefront image is missing');
        const mark = image.parentElement;
        if (!mark) throw new Error('Initial storefront image container is missing');
        Object.defineProperty(image, 'naturalWidth', { value: 160 });
        image.dispatchEvent(new Event('load'));
        const app = document.createElement('div');
        app.textContent = 'React page';
        const root = document.getElementById('root');
        if (!root) throw new Error('Initial storefront root is missing');
        document.getElementById('storefront-boot-loading')?.remove();
        root.replaceChildren(app);
        decoded();
        await Promise.resolve();
        expect(mark.classList.contains('is-logo-ready')).toBe(false);
        expect(document.getElementById('root')?.textContent).toBe('React page');
        applyInitialLoadingBrand(brand);
        expect(document.querySelector('.brand-loading')).toBeNull();
    });

    it('preserves the store name when both image candidates fail', () => {
        applyInitialLoadingBrand(brand);
        const image = document.querySelector('img');
        if (!image) throw new Error('Initial storefront image is missing');
        const transformed = image.getAttribute('src');
        expect(transformed).not.toBe(brand.logoUrl);
        image.dispatchEvent(new Event('error'));
        expect(image.getAttribute('src')).toBe(brand.logoUrl);
        image.dispatchEvent(new Event('error'));
        expect(document.querySelector('.route-transition-mark')).not.toBeNull();
        expect(document.querySelector('img')).toBeNull();
        expect(document.querySelector('.brand-loading-name')?.textContent).toBe(brand.storefrontName);
        expect(document.querySelector('.brand-loading-bar')).not.toBeNull();
    });

    it('replaces the whole brand and rejects a previous image decode on the same bootstrap node', async () => {
        let decoded!: () => void;
        vi.spyOn(HTMLImageElement.prototype, 'decode').mockImplementation(
            () => new Promise<void>(resolve => (decoded = resolve)),
        );
        applyInitialLoadingBrand(brand);
        const previousImage = document.querySelector('img');
        const previousMark = previousImage?.parentElement;
        if (!previousImage || !previousMark) throw new Error('Expected the original brand image and mark');
        Object.defineProperty(previousImage, 'naturalWidth', { value: 160 });
        previousImage.dispatchEvent(new Event('load'));
        applyInitialLoadingBrand({ language: 'en', storefrontName: 'Next store', logoUrl: '' });
        decoded();
        await Promise.resolve();
        expect(document.querySelectorAll('.brand-loading-name')).toHaveLength(1);
        expect(document.querySelector('.brand-loading-name')?.textContent).toBe('Next store');
        expect(document.querySelector('.brand-loading-subtitle')?.textContent).toBe('');
        expect(document.querySelector('.route-transition-mark')).not.toBeNull();
        expect(document.querySelector('img')).toBeNull();
        expect(document.querySelector('.brand-loading-label')?.textContent).toBe('Loading');
        expect(previousMark.classList.contains('is-logo-ready')).toBe(false);
        expect(document.body.textContent).not.toContain(brand.storefrontName);
    });

    it('retries decoding with the original image once and keeps the identity geometry after failure', async () => {
        vi.spyOn(HTMLImageElement.prototype, 'decode').mockRejectedValue(new Error('decode failed'));
        applyInitialLoadingBrand(brand);
        const image = document.querySelector('img');
        const mark = image?.parentElement;
        if (!image || !mark) throw new Error('Expected brand logo');
        Object.defineProperty(image, 'naturalWidth', { value: 160 });
        image.dispatchEvent(new Event('load'));
        await Promise.resolve();
        expect(image.getAttribute('src')).toBe(brand.logoUrl);
        image.dispatchEvent(new Event('load'));
        await Promise.resolve();
        expect(document.querySelector('img')).toBeNull();
        expect(document.querySelector('.route-transition-mark')).toBe(mark);
        expect(document.querySelector('.is-logo-ready')).toBeNull();
        expect(document.querySelector('.brand-loading-name')?.textContent).toBe(brand.storefrontName);
    });
});
