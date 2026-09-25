// @vitest-environment jsdom

import { print } from 'graphql';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FeatureHelpProvider } from '../../components/FeatureHelp';
import { STOREFRONT_CONTENT_QUERY } from '../../graphql/storefront.graphql';
import { BlockPreview, HeroBlockPreview } from './storefront-block-preview';
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
    state.data.storefrontVisualPreset.presetId = 'modern-oriental';
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
        await act(async () =>
            root.render(
                <FeatureHelpProvider>
                    <BlockPreview block={block} language={language} />
                </FeatureHelpProvider>,
            ),
        );
        return new DOMParser().parseFromString(container.querySelector('iframe')!.srcdoc, 'text/html');
    };
    cleanups.push(() => root.unmount());
    return { block, container, render };
}

describe('carousel draft preview', () => {
    it('uses the same on-image scene in the saved homepage structure preview', async () => {
        const container = document.createElement('div');
        const root = createRoot(container);
        cleanups.push(() => root.unmount());
        const block = newContentBlock('HERO', 0, '首页横幅');
        block.imageAsset = {
            id: 'hero-1',
            name: '首页横幅',
            preview: '/assets/hero-preview.png',
            source: '/assets/hero-source.png',
            width: 1600,
            height: 520,
        };
        for (const viewport of ['desktop', 'mobile'] as const) {
            await act(async () =>
                root.render(
                    <FeatureHelpProvider>
                        <HeroBlockPreview block={block} language="zh_Hans" fixedViewport={viewport} compact />
                    </FeatureHelpProvider>,
                ),
            );
            const iframe = container.querySelector('iframe')!;
            const doc = new DOMParser().parseFromString(iframe.srcdoc, 'text/html');
            expect(container.querySelector('[aria-label="首页横幅预览"]')).not.toBeNull();
            expect(container.querySelector('button')).toBeNull();
            expect(doc.querySelector('.hero-image-overlay') !== null).toBe(viewport === 'desktop');
            expect(doc.querySelector('img')?.getAttribute('width')).toBe('1600');
            expect(doc.querySelector('img')?.getAttribute('height')).toBe('520');
            expect(iframe.width).toBe(viewport === 'desktop' ? '874' : '390');
        }
    });

    it('keeps the complete image unobscured while draft copy changes', async () => {
        const { block, container, render } = await preview();
        block.imageAsset = {
            id: 'uploaded-hero',
            name: '横幅原图',
            preview: '/assets/preview/hero.png',
            source: '/assets/source/hero.png',
            width: 1600,
            height: 520,
        };
        let doc = await render();
        expect(doc.querySelector('.hero-rich-overlay-shade')).toBeNull();
        expect(doc.querySelector('.hero-rich-copy-surface')).not.toBeNull();
        expect(doc.querySelector('.hero-rich-title')?.textContent).toBe('未保存的标题');
        expect(doc.querySelector('img')?.getAttribute('srcset')).toContain('storefront-hero-fit-960');
        expect(doc.querySelector('img')?.getAttribute('sizes')).toBe(
            '(min-width: 1024px) 850px, calc(100vw - 20px)',
        );
        expect(doc.querySelector('img')?.getAttribute('width')).toBe('1600');
        expect(doc.querySelector('img')?.getAttribute('height')).toBe('520');
        block.settings = { ...block.settings, themePreset: 'bright' };
        doc = await render();
        expect(doc.querySelector('.hero-rich-overlay-shade')).toBeNull();
        expect(doc.querySelector('.hero-rich-title')?.textContent).toBe('未保存的标题');
        expect(print(STOREFRONT_CONTENT_QUERY)).toMatch(/imageAsset\s*\{[^}]*width\s+height/s);
        await act(async () =>
            Array.from(container.querySelectorAll('button'))
                .find(button => button.textContent === '电脑')!
                .click(),
        );
        const desktopDoc = new DOMParser().parseFromString(
            container.querySelector('iframe')!.srcdoc,
            'text/html',
        );
        expect(
            Number(
                desktopDoc
                    .querySelector('.hero')
                    ?.getAttribute('style')
                    ?.match(/aspect-ratio:\s*([\d.]+)/)?.[1],
            ),
        ).toBeCloseTo(1600 / 520);
        expect(container.querySelector('iframe')?.height).toBe(String(Math.ceil(850 / (1600 / 520)) + 24));
    });

    it('updates copy colors and locale while keeping buttons inert', async () => {
        const { block, container, render } = await preview();
        const previous = (await render()).querySelector('.hero-scene-wrapper')!.getAttribute('style');
        block.backgroundColor = '#312E81';
        block.textColor = '#FFFFFF';
        const doc = await render('en');
        expect(doc.querySelector('.hero-scene-wrapper')!.getAttribute('style')).not.toBe(previous);
        expect(doc.querySelector('.hero-scene-wrapper')!.getAttribute('style')).toContain(
            '--hero-copy-background:#312E81',
        );
        expect(doc.querySelector('.hero-rich-title')?.textContent).toBe('Draft title');
        expect(doc.body.style.getPropertyValue('--store-background')).toBeTruthy();
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
        const desktopDoc = new DOMParser().parseFromString(
            container.querySelector('iframe')!.srcdoc,
            'text/html',
        );
        expect(desktopDoc.querySelector('.hero.hero-editor-desktop.hero-image-overlay')).not.toBeNull();
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
        expect(doc.body.style.getPropertyValue('--store-background')).not.toBe('#FFF7F5');
        expect(doc.querySelector('script')).toBeNull();
        expect(doc.querySelector('.hero-rich-title')?.textContent).toBe('<script>alert(1)</script>');
        expect(doc.querySelector('.hero-stat-badge')).toBeNull();
    });

    it('uses the classic palette and saved brand color when that skin is selected', async () => {
        const { render } = await preview();
        state.data.storefrontVisualPreset.presetId = 'classic';
        const doc = await render();
        expect(doc.body.style.getPropertyValue('--store-background')).toBe('#f1f5f9');
        expect(doc.body.style.getPropertyValue('--store-primary')).toBe('#dc2626');
        expect(doc.documentElement.dataset.storefrontPreset).toBe('classic');
    });
});

it('previews the support header image and only FAQs that the Shop can publish', async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement('div');
    const root = createRoot(container);
    cleanups.push(() => root.unmount());
    const block = newContentBlock('SUPPORT', 0, '客服中心');
    block.imageAsset = {
        id: 'support-image',
        name: '客服页首配图',
        preview: '/assets/preview/support.png',
        source: '/assets/source/support.png',
    };
    block.settings = {
        ...block.settings,
        supportFaqs: [
            {
                id: 'delivery',
                enabled: true,
                questionZh: '何时发货？',
                answerZh: '按结算页时效发货。',
                questionEn: 'When will it ship?',
                answerEn: 'See the checkout estimate.',
            },
            {
                id: 'draft',
                enabled: false,
                questionZh: '草稿问题',
                answerZh: '草稿答案',
                questionEn: '',
                answerEn: '',
            },
        ],
    };
    const render = async (language: 'zh_Hans' | 'en') =>
        act(async () =>
            root.render(
                <FeatureHelpProvider>
                    <BlockPreview block={block} language={language} />
                </FeatureHelpProvider>,
            ),
        );
    await render('zh_Hans');
    const image = container.querySelector<HTMLImageElement>('img[alt="客服页首配图预览"]');
    expect(image?.getAttribute('src')).toBe('/assets/preview/support.png');
    expect(image?.className).toContain('object-contain');
    expect(container.querySelector('[aria-label="常见问题预览"]')?.textContent).toContain('何时发货？');
    expect(container.textContent).not.toContain('草稿问题');
    await render('en');
    expect(container.querySelector('[aria-label="FAQ preview"]')?.textContent).toContain(
        'When will it ship?',
    );
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
