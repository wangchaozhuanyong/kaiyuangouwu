import { describe, expect, it } from 'vitest';
import { adminCapabilityForPath } from '../../../common/src/admin-capabilities';
import { CORE_ADMIN_NAV_ITEMS, STANDALONE_ADMIN_PAGES } from './admin-navigation';

describe('one classification for every advertised entry', () => {
    it.each([...CORE_ADMIN_NAV_ITEMS, ...STANDALONE_ADMIN_PAGES])(
        'classifies $path before it can mount',
        item => {
            expect(adminCapabilityForPath(item.path), item.path).toBeDefined();
        },
    );
});
