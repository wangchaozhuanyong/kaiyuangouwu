import { Permission } from '@vendure/core';
import { describe, expect, it, vi } from 'vitest';

import { StoreProfileAdminResolver } from './store-profile.resolver';

describe('StoreProfileAdminResolver', () => {
    const resolver = new StoreProfileAdminResolver({} as any);

    it('returns internal notes only to SuperAdmins', () => {
        const profile = { internalNote: '平台审核记录' };

        expect(
            resolver.internalNote({ userHasPermissions: vi.fn().mockReturnValue(true) } as any, profile),
        ).toBe('平台审核记录');
        expect(
            resolver.internalNote({ userHasPermissions: vi.fn().mockReturnValue(false) } as any, profile),
        ).toBeNull();
    });

    it('checks the SuperAdmin permission explicitly', () => {
        const userHasPermissions = vi.fn().mockReturnValue(false);

        resolver.internalNote({ userHasPermissions } as any, { internalNote: 'secret' });

        expect(userHasPermissions).toHaveBeenCalledWith([Permission.SuperAdmin]);
    });
});
