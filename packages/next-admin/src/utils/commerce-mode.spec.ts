import { describe, expect, it } from 'vitest';
import {
    collectionHierarchySummary,
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

    it('separates product collections into first-level and second-level category summaries', () => {
        const root = { id: 'root', name: '__root_collection__' };
        const tobacco = { id: 'tobacco', name: '正品烟草' };
        const cigarettes = { id: 'cigarettes', name: '香烟' };
        const cigars = { id: 'cigars', name: '雪茄' };

        expect(
            collectionHierarchySummary([
                { ...tobacco, parent: root },
                { ...cigarettes, parent: tobacco },
                { ...cigars, parent: tobacco },
            ]),
        ).toEqual({
            topLevel: { primary: '正品烟草', extraCount: 0 },
            secondLevel: { primary: '香烟', extraCount: 1 },
        });
    });

    it('uses the parent relationship when only a child collection is assigned', () => {
        expect(
            collectionHierarchySummary([
                {
                    id: 'cigarettes',
                    name: '香烟',
                    parent: { id: 'tobacco', name: '正品烟草' },
                },
            ]),
        ).toEqual({
            topLevel: { primary: '正品烟草', extraCount: 0 },
            secondLevel: { primary: '香烟', extraCount: 0 },
        });
    });
});
