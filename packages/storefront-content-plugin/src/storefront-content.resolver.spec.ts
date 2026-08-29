import 'reflect-metadata';

import { ForbiddenError } from '@vendure/core';
import { describe, expect, it, vi } from 'vitest';

import { StorefrontContentAdminResolver } from './storefront-content.resolver';

describe('StorefrontContentAdminResolver composite permissions', () => {
    it('requires create permission when a batch creates content blocks', () => {
        const storefrontContentService = { applyChanges: vi.fn() };
        const resolver = new StorefrontContentAdminResolver(storefrontContentService as any);
        const ctx = {
            userHasPermissions: vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(false),
        };

        expect(() =>
            resolver.applyStorefrontContentChanges(
                ctx as any,
                {
                    expectedBlocks: [],
                    creates: [{ code: 'hero', type: 'hero' }],
                    updates: [],
                    orderedCodes: ['hero'],
                } as any,
            ),
        ).toThrow(ForbiddenError);
        expect(storefrontContentService.applyChanges).not.toHaveBeenCalled();
    });

    it('allows an update-only batch without create permission', () => {
        const storefrontContentService = { applyChanges: vi.fn().mockReturnValue([]) };
        const resolver = new StorefrontContentAdminResolver(storefrontContentService as any);
        const ctx = {
            userHasPermissions: vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(false),
        };
        const input = {
            expectedBlocks: [],
            creates: [],
            updates: [],
            orderedCodes: [],
        };

        expect(resolver.applyStorefrontContentChanges(ctx as any, input)).toEqual([]);
        expect(storefrontContentService.applyChanges).toHaveBeenCalledWith(ctx, input);
    });
});
