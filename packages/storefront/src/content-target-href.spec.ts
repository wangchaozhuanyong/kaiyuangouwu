import { describe, expect, it, vi } from 'vitest';

import { contentTargetHref, interceptContentNavigation } from './content-target-href';

describe('managed public navigation destinations', () => {
    it('exposes entity and service destinations in each published language without changing private paths', () => {
        expect(contentTargetHref('PRODUCT', 'p-1', 'en')).toBe('/en/product?id=p-1');
        expect(contentTargetHref('CATEGORY', 'c-1', 'zh')).toBe('/zh/category?collectionId=c-1');
        expect(contentTargetHref('PAGE', '/services', 'en')).toBe('/en/services');
        expect(contentTargetHref('PAGE', '/guides/how-to', 'zh')).toBe('/zh/guides/how-to');
        expect(contentTargetHref('PAGE', '/account', 'en')).toBe('/account');
        expect(contentTargetHref('URL', 'https://service.example', 'zh')).toBe('https://service.example');
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
