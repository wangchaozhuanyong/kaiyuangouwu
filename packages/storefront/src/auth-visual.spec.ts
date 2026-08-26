import { describe, expect, it } from 'vitest';
import type { StorefrontContentBlock, StorefrontContentBlockType } from './types';

import { authVisualAccentColor, findAuthVisualContent, resolveAuthVisualMessage } from './auth-visual';

function block(type: StorefrontContentBlockType): StorefrontContentBlock {
    return {
        id: type,
        code: type.toLowerCase(),
        type,
        enabled: true,
        position: 1,
        startsAt: null,
        endsAt: null,
        imageUrl: '/assets/preview/auth.webp',
        backgroundColor: '#010203',
        textColor: '#fefefe',
        targetType: 'NONE',
        targetValue: null,
        settings: { accentColor: '#abcdef' },
        title: '后台主标题',
        subtitle: '后台说明',
        body: '',
        ctaLabel: '后台短句',
        items: [0, 1, 2].map(position => ({
            id: `tag-${position}`,
            enabled: true,
            position,
            imageUrl: null,
            targetType: 'NONE',
            targetValue: null,
            label: `卖点${position + 1}`,
            description: '',
        })),
    };
}

describe('managed auth visuals', () => {
    it('keeps login and registration records independent', () => {
        const login = block('AUTH_LOGIN');
        const register = block('AUTH_REGISTER');

        expect(findAuthVisualContent([register, login], 'login')).toBe(login);
        expect(findAuthVisualContent([register, login], 'register')).toBe(register);
    });

    it('uses managed copy, tags and accent color when configured', () => {
        const content = block('AUTH_LOGIN');

        expect(resolveAuthVisualMessage(content, 'login', 'zh')).toEqual({
            eyebrow: '后台短句',
            title: '后台主标题',
            description: '后台说明',
            tags: ['卖点1', '卖点2', '卖点3'],
        });
        expect(authVisualAccentColor(content, 'login')).toBe('#abcdef');
    });

    it('falls back safely when no managed content has been published', () => {
        expect(resolveAuthVisualMessage(undefined, 'register', 'zh')).toMatchObject({
            title: '从今天起，让 AI 成为你的增长引擎',
        });
        expect(authVisualAccentColor(undefined, 'register')).toBe('#fdba74');
    });
});
