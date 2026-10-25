import { describe, expect, it, vi } from 'vitest';

import { contentTargetHref, interceptContentNavigation, internalContentRoute } from './content-target-href';

describe('managed public navigation destinations', () => {
    it('normalizes relative and same-origin absolute storefront targets only', () => {
        for (const value of [
            '/en/category?collectionId=13&minPrice=20',
            'https://store.test/en/category?collectionId=13&minPrice=20',
        ]) {
            expect(internalContentRoute(value, 'https://store.test')).toMatchObject({
                name: 'category',
                collectionId: '13',
                minPrice: '20',
                publicLanguage: 'en',
            });
        }
        for (const value of [
            'https://other.test/en/category',
            '/assets/catalog.pdf',
            '/two-factor',
            'mailto:help@example.com',
            'tel:123',
            '/payments/redirect',
            '#details',
        ]) {
            expect(internalContentRoute(value, 'https://store.test')).toBeUndefined();
        }
    });

    it('exposes entity and service destinations in each published language without changing private paths', () => {
        expect(contentTargetHref('PRODUCT', 'p-1', 'en')).toBe('/en/product?id=p-1');
        expect(contentTargetHref('CATEGORY', 'c-1', 'zh')).toBe('/zh/category?collectionId=c-1');
        expect(contentTargetHref('PAGE', '/services', 'en')).toBe('/en/services');
        expect(contentTargetHref('PAGE', '/guides/how-to', 'zh')).toBe('/zh/guides/how-to');
        expect(contentTargetHref('PAGE', '/account', 'en')).toBe('/account');
        expect(contentTargetHref('PAGE', '/en/services', 'zh')).toBe('/en/services');
        expect(contentTargetHref('URL', 'services', 'en')).toBe('/en/services');
        expect(contentTargetHref('PAGE', 'https://store.test/en/services', 'zh')).toBe(
            'https://store.test/en/services',
        );
        expect(contentTargetHref('URL', 'https://service.example', 'zh')).toBe('https://service.example');
        expect(contentTargetHref('PAGE', '//service.example/help', 'zh')).toBe('//service.example/help');
        expect(contentTargetHref('URL', 'javascript:alert(1)', 'en')).toBeUndefined();
        expect(contentTargetHref('NONE', '/product?id=p-1', 'zh')).toBeUndefined();
    });

    it('leaves modified clicks to the browser and runs a normal existing action once', () => {
        const action = vi.fn();
        const preventDefault = vi.fn();
        interceptContentNavigation({ button: 0, ctrlKey: true, preventDefault } as never, action);
        expect(action).not.toHaveBeenCalled();
        expect(preventDefault).not.toHaveBeenCalled();
        interceptContentNavigation({ button: 0, preventDefault } as never, action);
        expect(action).toHaveBeenCalledOnce();
        expect(preventDefault).toHaveBeenCalledOnce();
    });
});
