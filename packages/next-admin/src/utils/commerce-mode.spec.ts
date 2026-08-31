import { describe, expect, it } from 'vitest';
import {
    collectionSummary,
    commerceModeAllowsPath,
    fulfillmentTypeForMode,
    stockPolicyForDeliveryMode,
    trackInventoryForDigitalVariant,
} from './commerce-mode';

describe('commerce mode rules', () => {
    it('fixes the product type in single-mode stores', () => {
        expect(fulfillmentTypeForMode('DIGITAL_ONLY')).toBe('digital');
        expect(fulfillmentTypeForMode('PHYSICAL_ONLY')).toBe('physical');
        expect(fulfillmentTypeForMode('HYBRID')).toBeNull();
    });

    it('hides incompatible catalog modules', () => {
        expect(commerceModeAllowsPath('DIGITAL_ONLY', '/catalog/inventory')).toBe(false);
        expect(commerceModeAllowsPath('PHYSICAL_ONLY', '/catalog/card-pool')).toBe(false);
        expect(commerceModeAllowsPath('HYBRID', '/catalog/inventory')).toBe(true);
    });

    it('derives digital stock semantics from the delivery mode', () => {
        expect(stockPolicyForDeliveryMode('auto_card')).toBe('pool_derived');
        expect(stockPolicyForDeliveryMode('manual_service', 'unlimited')).toBe('limited');
        expect(stockPolicyForDeliveryMode('file_download', 'unlimited')).toBe('unlimited');
        expect(trackInventoryForDigitalVariant('auto_card', 'pool_derived')).toBe('FALSE');
        expect(trackInventoryForDigitalVariant('file_download', 'limited')).toBe('TRUE');
    });

    it('formats the category ownership summary', () => {
        expect(collectionSummary([])).toEqual({ primary: '未分类', extraCount: 0 });
        expect(collectionSummary([{ name: '软件' }, { name: '新品' }])).toEqual({
            primary: '软件',
            extraCount: 1,
        });
    });
});
