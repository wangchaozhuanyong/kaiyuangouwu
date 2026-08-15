import { describe, expect, it } from 'vitest';

import { localeFor, marketCodeForChannel, markets } from './i18n';

describe('storefront market configuration', () => {
    it('uses the active regional Channel as the client market', () => {
        expect(marketCodeForChannel('cn-mainland')).toBe('cn-mainland');
        expect(marketCodeForChannel('my-malaysia')).toBe('my-malaysia');
    });

    it('does not apply regional defaults to an unknown Channel', () => {
        expect(marketCodeForChannel('merchant-custom-channel')).toBeNull();
    });

    it('formats English with the active market locale', () => {
        expect(localeFor('en', markets['cn-mainland'])).toBe('en-US');
        expect(localeFor('en', markets['my-malaysia'])).toBe('en-MY');
    });
});
