// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BlockPreview } from './storefront-block-preview';
import { newContentBlock } from './storefront-content-utils';
import { contentPublicationLabels, contentPublicationStatus } from './storefront-publication';

vi.stubGlobal(
    'ResizeObserver',
    class {
        observe() {}
        disconnect() {}
    },
);

const state = vi.hoisted(() => ({
    data: {
        activeChannel: { id: 'preview-store', token: 'fixture-token' },
        storefrontVisualPreset: { presetId: 'modern-oriental' },
        storefrontPreviewBranding: {
            channelId: 'preview-store',
            backgroundColor: '#FFF7F5',
            primaryColor: '#DC2626',
        },
    },
}));
vi.mock('@apollo/client/react', () => ({ useQuery: () => ({ data: state.data }) }));
vi.mock('../../apollo', () => ({ getActiveChannelToken: () => 'fixture-token' }));

const cleanups: Array<() => void> = [];
afterEach(async () => {
    await act(async () => cleanups.splice(0).forEach(cleanup => cleanup()));
    state.data.storefrontPreviewBranding.channelId = 'preview-store';
});

async function preview() {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement('div');
    const root = createRoot(container);
    const block = newContentBlock('HERO', 0, '测试轮播');
    block.imageUrl = '/assets/preview/hero.png';
    block.settings = { themePreset: 'standard', contrastMode: 'high' };
    block.translations = [
        { languageCode: 'zh_Hans', title: '  未保存的标题  ', subtitle: '测试', body: '', ctaLabel: '' },
        { languageCode: 'en', title: 'Draft title', subtitle: 'Preview', body: '', ctaLabel: '' },
    ];
    const render = async (language: 'zh_Hans' | 'en' = 'zh_Hans') => {
        await act(async () => root.render(<BlockPreview block={block} language={language} />));
        return new DOMParser().parseFromString(container.querySelector('iframe')!.srcdoc, 'text/html');
    };
    cleanups.push(() => root.unmount());
    return { block, container, render };
}

describe('carousel draft preview', () => {
    it('shows the saved overlay and removes it immediately when an unsaved draft changes to bright', async () => {
        const { block, render } = await preview();
        let doc = await render();
        expect(doc.querySelector('.hero-rich-overlay-shade')).not.toBeNull();
        expect(doc.querySelector('.hero-rich-title')?.textContent).toBe('未保存的标题');
        expect(doc.querySelector('img')?.getAttribute('srcset')).toContain('storefront-hero-960');
        expect(doc.querySelector('img')?.getAttribute('sizes')).toBe(
            '(min-width: 1024px) 850px, calc(100vw - 20px)',
        );
        block.settings = { ...block.settings, themePreset: 'bright' };
        doc = await render();
        expect(doc.querySelector('.hero-rich-overlay-shade')).toBeNull();
        expect(doc.querySelector('.hero-rich-title')?.textContent).toBe('未保存的标题');
    });

    it('updates contrast, inherited colors, and locale while keeping buttons inert', async () => {
        const { block, container, render } = await preview();
        const high = (await render()).querySelector('.hero')!.getAttribute('style');
        block.settings = { ...block.settings, contrastMode: 'standard' };
        const doc = await render('en');
        expect(doc.querySelector('.hero')!.getAttribute('style')).not.toBe(high);
        expect(doc.querySelector('.hero-rich-title')?.textContent).toBe('Draft title');
        expect(doc.body.style.getPropertyValue('--store-background')).toBe('#FFF7F5');
        expect(doc.body.style.getPropertyValue('--store-foreground')).toBeTruthy();
        expect(doc.documentElement.dataset.storefrontPreset).toBe('modern-oriental');
        expect(container.querySelector('iframe')?.getAttribute('sandbox')).toBe('');
        expect(doc.querySelectorAll('script,a')).toHaveLength(0);
        await act(async () =>
            Array.from(container.querySelectorAll('button'))
                .find(b => b.textContent === '电脑')!
                .click(),
        );
        expect(container.querySelector('iframe')?.width).toBe('1024');
    });

    it('does not inherit another channel palette, inject copy, or render disabled items', async () => {
        const { block, render } = await preview();
        state.data.storefrontPreviewBranding.channelId = 'other-store';
        block.translations[0].title = '<script>alert(1)</script>';
        block.items = [
            {
                id: 'disabled',
                enabled: false,
                position: 0,
                imageAsset: null,
                imageUrl: null,
                targetType: 'NONE',
                targetValue: null,
                settings: {},
                translations: [{ languageCode: 'zh_Hans', label: '不应显示', description: '' }],
            },
        ];
        const doc = await render();
        expect(doc.body.style.getPropertyValue('--store-background')).toBe('');
        expect(doc.querySelector('script')).toBeNull();
        expect(doc.querySelector('.hero-rich-title')?.textContent).toBe('<script>alert(1)</script>');
        expect(doc.querySelector('.hero-stat-badge')).toBeNull();
    });
});

it('calls content publication published without promising product-dependent floor visibility', () => {
    const block = newContentBlock('BEST_SELLERS', 0, '热门商品');
    block.enabled = true;
    block.translations = [
        { languageCode: 'zh_Hans', title: '热门商品', subtitle: '', body: '', ctaLabel: '' },
        { languageCode: 'en', title: 'Popular products', subtitle: '', body: '', ctaLabel: '' },
    ];
    expect(contentPublicationLabels[contentPublicationStatus(block)]).toBe('已发布');
});
