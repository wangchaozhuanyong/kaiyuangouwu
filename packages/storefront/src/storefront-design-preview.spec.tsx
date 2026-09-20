import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { StorefrontDesignPreview } from './storefront-design-preview';
import { storefrontRouteNames } from './storefront-router';

describe('storefront design preview', () => {
    it('offers all routes, skins, viewport boundaries and review states', () => {
        const markup = renderToStaticMarkup(<StorefrontDesignPreview />);
        for (const route of storefrontRouteNames) expect(markup).toContain(`value="${route}"`);
        expect(markup).toContain('value="classic"');
        expect(markup).toContain('value="modern-oriental"');
        expect(markup).toContain('value="neo-minimalist"');
        expect(markup).toContain('value="1023"');
        expect(markup).toContain('value="1024"');
        expect(markup).toContain('value="dialog"');
        expect(markup).toContain('value="guest"');
        expect(markup).toContain('value="authenticated"');
    });
});
