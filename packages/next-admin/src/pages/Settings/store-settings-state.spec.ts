import { describe, expect, it } from 'vitest';

import { STORE_SETTINGS_TABS } from './store-settings-state';

describe('store settings tabs', () => {
    it('routes payment and shipping independently while preserving the old combined URL', () => {
        expect(STORE_SETTINGS_TABS.payment).toBe('PAYMENT');
        expect(STORE_SETTINGS_TABS.shipping).toBe('SHIPPING');
        expect(STORE_SETTINGS_TABS['payment-shipping']).toBe('PAYMENT');
    });
});
