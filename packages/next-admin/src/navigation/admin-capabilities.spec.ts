import { describe, expect, it } from 'vitest';
import { adminCapabilityForPath } from '../../../common/src/admin-capabilities';
import { CORE_ADMIN_NAV_ITEMS, STANDALONE_ADMIN_PAGES } from './admin-navigation';

describe('one classification for every advertised entry', () => {
    it('preserves native permissions for attached SEO routes', () => {
        expect(adminCapabilityForPath('/catalog/products/42/seo')?.readPermissions).toEqual([
            'ReadProduct',
            'ReadCatalog',
        ]);
        expect(adminCapabilityForPath('/catalog/collections/42/seo')?.writePermissions).toEqual([
            'UpdateCollection',
            'UpdateCatalog',
        ]);
        expect(adminCapabilityForPath('/storefront/seo/platforms')?.readPermissions).toEqual([
            'ReadStorefrontContent',
        ]);
    });
    it.each([...CORE_ADMIN_NAV_ITEMS, ...STANDALONE_ADMIN_PAGES])(
        'classifies $path before it can mount',
        item => {
            expect(adminCapabilityForPath(item.path), item.path).toBeDefined();
        },
    );
});
