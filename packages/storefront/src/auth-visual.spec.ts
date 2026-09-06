import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
    authOriginalImageUrl,
    AuthVisual,
    authVisualStyle,
} from '../../storefront-content-plugin/src/shared/auth-visual';

import {
    authVisualAccentColor,
    authVisualOverlayColor,
    findAuthVisualContent,
    resolveAuthVisualMessage,
} from './auth-visual';
import { StorefrontContentBlock, StorefrontContentBlockType } from './types';

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
            benefits: [
                { title: '卖点1', description: '' },
                { title: '卖点2', description: '' },
                { title: '卖点3', description: '' },
            ],
            serviceTypes: [],
        });
        expect(authVisualAccentColor(content, 'login')).toBe('#abcdef');
    });

    it('falls back safely when no managed content has been published', () => {
        expect(resolveAuthVisualMessage(undefined, 'register', 'zh')).toMatchObject({
            title: '创建账号',
        });
        expect(authVisualAccentColor(undefined, 'register')).toBe('#8B5CF6');
        expect(authVisualOverlayColor(undefined)).toBe('#070B14');
    });

    it('preserves intentionally empty fields and every configured item', () => {
        const content: StorefrontContentBlock = {
            ...block('AUTH_LOGIN'),
            subtitle: '',
            ctaLabel: '',
            items: [],
        };
        expect(resolveAuthVisualMessage(content, 'login', 'zh')).toMatchObject({
            eyebrow: '',
            description: '',
            tags: [],
            benefits: [],
            serviceTypes: [],
        });
        content.items = Array.from({ length: 6 }, (_, i) => ({
            ...block('AUTH_LOGIN').items[0],
            id: String(i),
            label: String(i),
        }));
        expect(resolveAuthVisualMessage(content, 'login', 'en').benefits).toHaveLength(6);
    });

    it('keeps managed colors authoritative after a media publish', () => {
        const content = block('AUTH_REGISTER');
        content.imageUrl = '/assets/preview/08/auth-register-ai-campaign-v2__preview.jpg';
        content.backgroundColor = '#16051f';
        content.settings = { accentColor: '#fdba74' };

        expect(authVisualAccentColor(content, 'register')).toBe('#fdba74');
        expect(authVisualOverlayColor(content)).toBe('#16051f');
    });
});

describe('shared auth presentation', () => {
    it('replaces a cropping preset with the existing proportional preset', () => {
        const url = new URL(
            authOriginalImageUrl(
                'https://example.test/assets/preview/banner.jpg?preset=storefront-hero-960&format=jpg&q=75',
            ),
        );
        expect(url.searchParams.get('preset')).toBe('storefront-original-preview');
        expect(url.searchParams.get('q')).toBe('90');
        expect(authOriginalImageUrl('/assets/source/brand.svg')).toBe('/assets/source/brand.svg');
        expect(authOriginalImageUrl('https://example.test/banner.jpg')).toBe(
            'https://example.test/banner.jpg',
        );
    });
    it('uses configured colors and inherits only unset fields without restoring deleted copy', () => {
        const content = { ...block('AUTH_LOGIN'), title: '', subtitle: '', ctaLabel: '', items: [] };
        const markup = renderToStaticMarkup(createElement(AuthVisual, { content, language: 'zh' }));
        expect(markup).not.toContain('<h2');
        expect(markup).not.toContain('<p');
        expect(markup).not.toContain('MOYAO');
        expect(authVisualStyle(content)).toMatchObject({
            '--auth-visual-background': '#010203',
            '--auth-visual-foreground': '#fefefe',
            '--auth-accent': '#abcdef',
        });
        expect(
            authVisualStyle({ ...content, backgroundColor: null, textColor: null, settings: {} }),
        ).toMatchObject({
            '--auth-visual-background': 'var(--auth-store-background, var(--skin-background, #f1f5f9))',
            '--auth-accent': 'var(--accent, #635bff)',
        });
    });
});
