import { describe, expect, it } from 'vitest';

import {
    authVisualAccentColor,
    authVisualInput,
    createAuthVisualDraft,
    isAuthVisualValid,
} from './auth-visual-config';

describe('auth visual configuration', () => {
    it('creates complete and independently themed login and registration defaults', () => {
        const login = createAuthVisualDraft('AUTH_LOGIN');
        const register = createAuthVisualDraft('AUTH_REGISTER');

        expect(login).toMatchObject({ code: 'auth-login-visual', type: 'AUTH_LOGIN', enabled: true });
        expect(register).toMatchObject({
            code: 'auth-register-visual',
            type: 'AUTH_REGISTER',
            enabled: true,
        });
        expect(login.items).toHaveLength(3);
        expect(register.items).toHaveLength(3);
        expect(authVisualAccentColor(login)).not.toBe(authVisualAccentColor(register));
        expect(isAuthVisualValid(login)).toBe(true);
        expect(isAuthVisualValid(register)).toBe(true);
    });

    it('preserves managed records while normalizing the fixed visual shape', () => {
        const existing = createAuthVisualDraft('AUTH_LOGIN');
        existing.id = 'visual-1';
        existing.imageAsset = { id: 'asset-1', preview: '/assets/preview/login.webp' } as never;
        existing.items[0].id = 'tag-1';

        const input = authVisualInput(createAuthVisualDraft('AUTH_LOGIN', existing));

        expect(input.imageAssetId).toBe('asset-1');
        expect(input.imageUrl).toBeNull();
        expect(input.items[0]).toMatchObject({ id: 'tag-1', position: 0, targetType: 'NONE' });
        expect(input.translations.map(translation => translation.languageCode)).toEqual(['zh_Hans', 'en']);
    });

    it('requires a complete Chinese campaign before publishing', () => {
        const draft = createAuthVisualDraft('AUTH_REGISTER');
        const chineseCampaign = draft.items[2].translations.find(
            translation => translation.languageCode === 'zh_Hans',
        );
        if (!chineseCampaign) {
            throw new Error('Expected the registration campaign to include a Chinese translation');
        }
        chineseCampaign.label = '';

        expect(isAuthVisualValid(draft)).toBe(false);
    });
});
