import { describe, expect, it } from 'vitest';
import type { ContentBlock } from './storefront-content.graphql';

import {
    fixedHomepageModuleTypes,
    homepageLayoutEntries,
    isFixedHomepageModuleType,
    movedHomepageBlockIds,
    reorderedHomepageBlockIds,
} from './homepage-module-registry';

function block(input: Partial<ContentBlock> & Pick<ContentBlock, 'type' | 'code'>): ContentBlock {
    return {
        enabled: true,
        position: 0,
        internalName: input.code,
        layoutVariant: 'AUTO',
        startsAt: null,
        endsAt: null,
        imageAsset: null,
        imageUrl: null,
        backgroundColor: null,
        textColor: null,
        targetType: 'NONE',
        targetValue: null,
        settings: null,
        translations: [],
        items: [],
        ...input,
    };
}

describe('homepage module registry', () => {
    it('treats every built-in homepage module as fixed and leaves custom content addable', () => {
        expect(fixedHomepageModuleTypes.every(isFixedHomepageModuleType)).toBe(true);
        expect(isFixedHomepageModuleType('CUSTOM')).toBe(false);
        expect(isFixedHomepageModuleType('LEGAL')).toBe(false);
        expect(isFixedHomepageModuleType('SUPPORT')).toBe(false);
        expect(isFixedHomepageModuleType('AUTH_LOGIN')).toBe(false);
        expect(isFixedHomepageModuleType('AUTH_REGISTER')).toBe(false);
    });

    it('returns every fixed module even before a channel has saved its configuration', () => {
        const entries = homepageLayoutEntries([]);

        expect(entries.filter(entry => entry.fixed)).toHaveLength(fixedHomepageModuleTypes.length);
        expect(entries.find(entry => entry.type === 'COUPONS')).toMatchObject({ enabled: true });
        expect(entries.find(entry => entry.type === 'STORY')).toMatchObject({ enabled: false });
    });

    it('keeps multiple hero slides in one module and reports duplicate singleton records', () => {
        const entries = homepageLayoutEntries([
            block({ id: 'hero-1', code: 'hero-1', type: 'HERO', position: 1 }),
            block({ id: 'hero-2', code: 'hero-2', type: 'HERO', position: 2 }),
            block({ id: 'coupon-1', code: 'coupon-1', type: 'COUPONS', position: 3 }),
            block({ id: 'coupon-2', code: 'coupon-2', type: 'COUPONS', position: 4 }),
        ]);

        expect(entries.find(entry => entry.type === 'HERO')).toMatchObject({ duplicateCount: 0 });
        expect(entries.find(entry => entry.type === 'HERO')?.blocks).toHaveLength(2);
        expect(entries.find(entry => entry.type === 'COUPONS')).toMatchObject({ duplicateCount: 1 });
    });

    it('reorders whole fixed groups without losing custom or hidden block IDs', () => {
        const entries = homepageLayoutEntries([
            block({ id: 'notice', code: 'notice', type: 'NOTICE', position: 1 }),
            block({ id: 'hero-1', code: 'hero-1', type: 'HERO', position: 2 }),
            block({ id: 'hero-2', code: 'hero-2', type: 'HERO', position: 3 }),
            block({ id: 'custom', code: 'custom', type: 'CUSTOM', position: 4 }),
        ]);
        const heroIndex = entries.findIndex(entry => entry.type === 'HERO');
        const direction = heroIndex > 0 ? -1 : 1;

        expect(reorderedHomepageBlockIds(entries, 'fixed:HERO', direction)).toEqual(
            expect.arrayContaining(['notice', 'hero-1', 'hero-2', 'custom']),
        );
        const ids = reorderedHomepageBlockIds(entries, 'fixed:HERO', direction);
        expect(Math.abs(ids.indexOf('hero-1') - ids.indexOf('hero-2'))).toBe(1);
    });

    it('keeps global legal and support records in their slots in the complete reorder payload', () => {
        const blocks = [
            block({ id: 'notice', code: 'notice', type: 'NOTICE', position: 1 }),
            block({ id: 'legal', code: 'legal', type: 'LEGAL', position: 2 }),
            block({ id: 'custom', code: 'custom', type: 'CUSTOM', position: 3 }),
        ];
        const entries = homepageLayoutEntries(blocks);

        expect(movedHomepageBlockIds(entries, 'custom:custom', 'fixed:NOTICE', blocks)).toEqual([
            'custom',
            'legal',
            'notice',
        ]);
    });

    it('keeps authentication visuals out of the homepage editor while retaining their reorder IDs', () => {
        const blocks = [
            block({ id: 'notice', code: 'notice', type: 'NOTICE', position: 1 }),
            block({ id: 'auth-login', code: 'auth-login-visual', type: 'AUTH_LOGIN', position: 2 }),
            block({ id: 'auth-register', code: 'auth-register-visual', type: 'AUTH_REGISTER', position: 3 }),
            block({ id: 'custom', code: 'custom', type: 'CUSTOM', position: 4 }),
        ];
        const entries = homepageLayoutEntries(blocks);

        expect(entries.some(entry => entry.block?.id === 'auth-login')).toBe(false);
        expect(entries.some(entry => entry.block?.id === 'auth-register')).toBe(false);
        expect(movedHomepageBlockIds(entries, 'custom:custom', 'fixed:NOTICE', blocks)).toEqual([
            'custom',
            'auth-login',
            'auth-register',
            'notice',
        ]);
    });
});
