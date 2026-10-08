// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { storefrontClientPluginCatalog } from '../../../../storefront-content-plugin/src/client-plugin-manifest';
import { ClientPluginsModule } from '../Plugins/ClientPluginsModule';
import { BusinessServicesCopyModule } from './BusinessServicesCopyModule';
import { newContentBlock, newContentItem } from './storefront-content-utils';

const mocks = vi.hoisted(() => ({
    data: {} as Record<string, unknown>,
    mutate: vi.fn(),
    refetch: vi.fn(),
}));
vi.mock('@apollo/client/react', () => ({
    useQuery: () => ({ data: mocks.data, loading: false, refetch: mocks.refetch }),
    useMutation: () => [mocks.mutate, { loading: false }],
}));
vi.mock('../../components/FeatureHelp', () => ({ FeatureHelpButton: () => null }));
vi.mock('../../hooks/use-admin-permissions', () => ({
    useAdminPermissions: () => ({ hasAnyPermission: () => true }),
}));
vi.mock('../../hooks/use-unsaved-changes-warning', () => ({ useUnsavedChangesWarning: () => {} }));
vi.mock('../../apollo', () => ({
    getActiveChannelToken: () => 'local-fixture',
    channelRequestContext: () => ({}),
}));
vi.mock('./storefront-asset-picker', () => ({ AssetPicker: () => null }));

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.clearAllMocks();
    mocks.mutate.mockRejectedValue(new Error('Local fixture: no remote writes'));
    mocks.data = {
        activeChannel: { id: 'local', token: 'local-fixture', code: 'local' },
        storefrontVisualPreset: { channelId: 'local', presetId: 'classic', revision: 'fixture' },
        storefrontPreviewBranding: { channelId: 'local', name: 'Local fixture' },
        storefrontContentBlocks: [],
        collections: { items: [{ id: 'category-1', name: '测试分类', parentId: null }], totalItems: 1 },
        selectedCollections: { items: [], totalItems: 0 },
    };
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
});
afterEach(() => {
    act(() => root.unmount());
    host.remove();
});
async function fill(input: HTMLInputElement, value: string) {
    await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
}
async function select(input: HTMLSelectElement, value: string) {
    await act(async () => {
        input.value = value;
        input.dispatchEvent(new Event('change', { bubbles: true }));
    });
}

describe('compact editors retain drafts', () => {
    it('opts into shared overlay without changing the image, link, or installed items', async () => {
        const block = newContentBlock('CLIENT_PLUGINS', 10_001, 'Existing services');
        block.id = 'services';
        block.code = 'storefront-client-plugins';
        block.updatedAt = '2026-10-09T00:00:00Z';
        block.imageAssetId = 'retained-image';
        block.imageAsset = {
            id: 'retained-image',
            preview: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>',
            source: '',
            name: 'Existing image',
            mimeType: 'image/svg+xml',
        };
        block.targetType = 'URL';
        block.targetValue = 'https://example.com/services';
        block.settings = { businessServicesCopyVersion: 1, preservedSetting: true };
        block.translations = [
            { languageCode: 'zh_Hans', title: '服务标题', subtitle: '', body: '服务说明', ctaLabel: '' },
        ];
        block.items = [newContentItem(0)];
        mocks.data.storefrontContentBlocks = [block];
        await act(async () => root.render(<BusinessServicesCopyModule />));
        const layout = host.querySelector<HTMLSelectElement>('[aria-label="页首图文布局"]')!;
        const preview = host.querySelector('[data-services-hero-layout]')!;
        const originalImage = preview.querySelector('img')!.getAttribute('src');
        expect(layout.value).toBe('stacked');
        expect(preview.getAttribute('data-services-hero-layout')).toBe('stacked');
        await select(layout, 'image-overlay');
        expect(preview.getAttribute('data-services-hero-layout')).toBe('image-overlay');
        expect(preview.querySelector('img')!.getAttribute('src')).toBe(originalImage);
        const save = [...host.querySelectorAll('button')].find(button =>
            button.textContent?.includes('保存并发布'),
        )!;
        await act(async () => save.click());
        const input = mocks.mutate.mock.calls[0][0].variables.input;
        expect(input).toMatchObject({
            id: 'services',
            expectedUpdatedAt: block.updatedAt,
            targetType: 'URL',
            targetValue: 'https://example.com/services',
            settings: { preservedSetting: true, businessServicesHeroLayout: 'image-overlay' },
        });
        expect(input.items).toHaveLength(1);
        expect(input).not.toHaveProperty('imageAssetId');
        expect(input).not.toHaveProperty('imageUrl');
        expect(input.allowImageReplacement).not.toBe(true);
    });

    it('keeps editing available when the current store preview theme is unavailable', async () => {
        mocks.data.storefrontVisualPreset = { channelId: 'another-store', presetId: 'neo-minimalist' };
        await act(async () => root.render(<BusinessServicesCopyModule />));
        expect(host.querySelector('[data-business-services-preview]')).toBeNull();
        expect(host.textContent).toContain('店铺预览主题读取失败，编辑内容已保留');
        const chinese = host.querySelector<HTMLInputElement>('input[maxlength="40"]')!;
        expect(chinese.disabled).toBe(false);
        await fill(chinese, '主题读取失败时保留的草稿');
        expect(chinese.value).toBe('主题读取失败时保留的草稿');
    });

    it('retains both language drafts and submits both after switching the visible editor', async () => {
        await act(async () => root.render(<BusinessServicesCopyModule />));
        const language = host.querySelector<HTMLSelectElement>('[aria-label="编辑语言"]')!;
        const chinese = host.querySelector<HTMLInputElement>('input[maxlength="40"]')!;
        const english = host.querySelector<HTMLInputElement>('input[maxlength="80"]')!;
        await fill(chinese, '中文草稿');
        await select(language, 'en');
        expect(chinese.closest('[hidden]')).not.toBeNull();
        expect(english.closest('[hidden]')).toBeNull();
        await fill(english, 'English draft');
        const mobileViews = host.querySelectorAll<HTMLButtonElement>('[aria-label="编辑与预览视图"] button');
        await act(async () => mobileViews[1].click());
        expect(mobileViews[1].getAttribute('aria-pressed')).toBe('true');
        expect(english.closest('section')?.classList.contains('hidden')).toBe(true);
        await act(async () => mobileViews[0].click());
        expect(english.closest('section')?.classList.contains('hidden')).toBe(false);
        expect(english.value).toBe('English draft');
        expect(mocks.mutate).not.toHaveBeenCalled();
        await select(language, 'zh_Hans');
        expect(chinese.value).toBe('中文草稿');
        expect(english.value).toBe('English draft');
        expect(host.querySelector('h3')?.textContent).toBe('中文草稿');
        const save = [...host.querySelectorAll('button')].find(button =>
            button.textContent?.includes('保存并发布'),
        )!;
        await act(async () => save.click());
        expect(mocks.mutate).toHaveBeenCalledOnce();
        expect(mocks.mutate.mock.calls[0][0].variables.input.translations).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ languageCode: 'zh_Hans', title: '中文草稿' }),
                expect.objectContaining({ languageCode: 'en', title: 'English draft' }),
            ]),
        );
    });

    it('keeps category scope and selected categories when an installed row is reordered', async () => {
        mocks.data.storefrontContentBlocks = [
            {
                id: 'plugins',
                code: 'storefront-client-plugins',
                type: 'CLIENT_PLUGINS',
                updatedAt: '2026-10-03T00:00:00Z',
                settings: {},
                translations: [],
                items: storefrontClientPluginCatalog.slice(0, 2).map((definition, index) => ({
                    id: `plugin-${index}`,
                    enabled: true,
                    position: index,
                    translations: [],
                    settings: {
                        pluginCode: definition.code,
                        placement: 'BEFORE_PRODUCT_LIST',
                        categoryScope: 'ALL',
                        categoryIds: [],
                        includeChildren: true,
                    },
                })),
            },
        ];
        await act(async () => root.render(<ClientPluginsModule />));
        const library = host.querySelector('.admin-plugin-library')!;
        expect(library.textContent).toContain('可用官方插件库');
        expect(library.querySelector('details')).toBeNull();
        const firstRow = host.querySelector('article')!;
        const firstName = firstRow.querySelector('h3')!.textContent;
        await select(firstRow.querySelectorAll('select')[1], 'SELECTED');
        const category = [...firstRow.querySelectorAll('label')]
            .find(label => label.textContent?.includes('测试分类'))!
            .querySelector('input')!;
        await act(async () => category.click());
        await act(async () => firstRow.querySelector<HTMLButtonElement>('[aria-label="下移"]')!.click());
        const secondRow = host.querySelectorAll('article')[1];
        expect(secondRow.querySelector('h3')!.textContent).toBe(firstName);
        expect(secondRow.querySelectorAll('select')[1].value).toBe('SELECTED');
        const selected = [...secondRow.querySelectorAll('label')]
            .find(label => label.textContent?.includes('测试分类'))!
            .querySelector('input')!;
        expect(selected.checked).toBe(true);
        expect(mocks.mutate).not.toHaveBeenCalled();
    });
});

// The business fixtures own mocked data; lifecycle behavior is tested with real Apollo.
vi.mock('../../hooks/use-admin-query', () => import('../../test/admin-query-mock'));
