import { describe, expect, it } from 'vitest';

import type { StorefrontContentBlock } from '../../graphql/storefront.graphql';
import {
    businessServicesLinkIsValid,
    businessServicesLinkValue,
    updateBusinessServicesLink,
} from './business-services-link';

function block(): StorefrontContentBlock {
    return {
        code: 'storefront-client-plugins',
        internalName: '客户端插件配置',
        type: 'CLIENT_PLUGINS',
        layoutVariant: 'CUSTOM',
        enabled: true,
        position: 10_001,
        startsAt: null,
        endsAt: null,
        imageAsset: null,
        imageAssetId: null,
        imageUrl: null,
        backgroundColor: null,
        textColor: null,
        targetType: 'NONE',
        targetValue: null,
        settings: null,
        translations: [],
        items: [],
    };
}

describe('business services link', () => {
    it('accepts optional internal and HTTP(S) links and rejects unsafe protocols', () => {
        expect(businessServicesLinkIsValid('')).toBe(true);
        expect(businessServicesLinkIsValid('/promotions')).toBe(true);
        expect(businessServicesLinkIsValid('#/support')).toBe(true);
        expect(businessServicesLinkIsValid('https://example.com/services')).toBe(true);
        expect(businessServicesLinkIsValid('javascript:alert(1)')).toBe(false);
        expect(businessServicesLinkIsValid('//example.com/services')).toBe(false);
    });

    it('stores a configured link as a URL target and clears it when empty', () => {
        const linked = updateBusinessServicesLink(block(), ' https://example.com/services ');

        expect(linked.targetType).toBe('URL');
        expect(businessServicesLinkValue(linked)).toBe(' https://example.com/services ');

        const cleared = updateBusinessServicesLink(linked, '  ');
        expect(cleared.targetType).toBe('NONE');
        expect(cleared.targetValue).toBeNull();
        expect(businessServicesLinkValue(cleared)).toBe('');
    });
});
