// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { storefrontVisualPresets } from '../../../../storefront-content-plugin/src/visual-presets';
import { STOREFRONT_VISUAL_PRESET_QUERY } from '../../graphql/storefront-visual-preset.graphql';
import { StorefrontVisualPresetPanel } from './StorefrontVisualPresetPanel';
import { storefrontVisualPreviewDocument } from './storefront-visual-preview';

const mocks = vi.hoisted(() => ({ query: vi.fn(), save: vi.fn(), refetch: vi.fn() }));
vi.mock('@apollo/client/react', () => ({
    useQuery: mocks.query,
    useMutation: () => [mocks.save, { loading: false }],
}));
vi.mock('../../apollo', () => ({
    getActiveChannelToken: () => 'local-test-store',
    channelRequestContext: (token: string) => ({ headers: { 'vendure-token': token } }),
}));
vi.mock('../../hooks/use-admin-permissions', () => ({
    useAdminPermissions: () => ({ hasAnyPermission: () => true }),
}));
vi.mock('./StorefrontDecorationPreview', () => ({
    StorefrontDecorationPreview: (props: { presetId: string; fixedViewport: string }) => (
        <div data-real-client-preview data-preset={props.presetId} data-viewport={props.fixedViewport} />
    ),
}));
vi.mock('../../components/FeatureHelp', () => ({ FeatureHelpButton: () => null }));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement;
let root: Root;
const source = {
    channelId: 'local-store',
    presetId: 'modern-oriental',
    desktopLayout: 'catalog',
    revision: 'revision-1',
};
function queryResult(desktopLayout = 'catalog') {
    return {
        loading: false,
        data: {
            activeChannel: { id: 'local-store', code: 'local-store', token: 'local-test-store' },
            storefrontVisualPreset: { ...source, desktopLayout },
        },
        refetch: mocks.refetch,
    };
}
function saveButton() {
    const button = Array.from(host.querySelectorAll('button')).find(
        element => element.textContent === '保存到当前店铺',
    );
    if (!button) throw new Error('Missing skin save button');
    return button;
}
beforeEach(() => {
    vi.clearAllMocks();
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    mocks.query.mockReturnValue(queryResult());
});
afterEach(() => {
    act(() => root.unmount());
    host.remove();
});

describe('fixed desktop layout skin settings', () => {
    it('renders the same skin surface tokens in the offline admin sample', () => {
        const document = storefrontVisualPreviewDocument('neo-minimalist', '测试店铺');
        expect(document).toContain('--skin-divider:#2a3548');
        expect(document).toContain('--skin-card-radius:16px');
        expect(document).toContain('box-shadow:var(--skin-card-shadow)');
        expect(document).toContain('.preview-hero{padding:36px 28px;background:var(--surface)');
        expect(document).toContain('background:var(--accent);color:var(--accent-foreground)');
    });

    it('embeds the real storefront home with the unsaved skin only in preview context', () => {
        mocks.query.mockImplementation(document =>
            document === STOREFRONT_VISUAL_PRESET_QUERY
                ? {
                      ...queryResult(),
                      data: {
                          ...queryResult().data,
                          storefrontPreviewBranding: {
                              channelId: 'local-store',
                              backgroundColor: '#070b14',
                          },
                      },
                  }
                : {
                      loading: false,
                      data: {
                          storeProfiles: [
                              { channel: { id: 'local-store' }, storefrontUrl: 'https://shop.example.test' },
                          ],
                      },
                  },
        );
        act(() => root.render(<StorefrontVisualPresetPanel />));
        act(() => host.querySelector<HTMLInputElement>('input[value="classic"]')!.click());
        const previewButton = Array.from(host.querySelectorAll('button')).find(
            button => button.textContent === '预览效果',
        );
        act(() => previewButton!.click());
        const preview = host.querySelector('[data-real-client-preview]');
        expect(preview?.getAttribute('data-preset')).toBe('classic');
        expect(preview?.getAttribute('data-viewport')).toBe('mobile');
        expect(mocks.save).not.toHaveBeenCalled();
    });

    it.each(['classic', 'catalog'])('shows only skin options with legacy %s data', desktopLayout => {
        mocks.query.mockReturnValue(queryResult(desktopLayout));
        act(() => root.render(<StorefrontVisualPresetPanel />));
        expect(host.querySelectorAll('input[type="radio"]')).toHaveLength(storefrontVisualPresets.length);
        expect(host.querySelectorAll('input[name="desktopLayout"]')).toHaveLength(0);
        expect(host.textContent).toContain('电脑端共用布局');
        expect(saveButton().disabled).toBe(true);
    });

    it('saves only the selected skin with the current channel and revision', async () => {
        const saved = { ...source, presetId: 'classic', revision: 'revision-2' };
        mocks.save.mockResolvedValue({ data: { updateStorefrontVisualPreset: saved } });
        mocks.refetch.mockResolvedValue({ data: { storefrontVisualPreset: saved } });
        act(() => root.render(<StorefrontVisualPresetPanel />));
        act(() => host.querySelector<HTMLInputElement>('input[value="classic"]')!.click());
        await act(async () => saveButton().click());
        expect(mocks.save).toHaveBeenCalledWith({
            context: { headers: { 'vendure-token': 'local-test-store' } },
            variables: {
                input: { channelId: 'local-store', presetId: 'classic', expectedRevision: 'revision-1' },
            },
        });
        expect(host.querySelector('[role="status"]')?.textContent).toContain('已保存');
    });

    it('retains the chosen skin when a revision conflict rejects the save', async () => {
        mocks.save.mockRejectedValue(new Error('其他管理员已更新，请重新读取配置'));
        act(() => root.render(<StorefrontVisualPresetPanel />));
        act(() => host.querySelector<HTMLInputElement>('input[value="classic"]')!.click());
        await act(async () => saveButton().click());
        expect(host.querySelector<HTMLInputElement>('input[value="classic"]')?.checked).toBe(true);
        expect(host.querySelector('[role="alert"]')?.textContent).toContain('其他管理员');
        expect(mocks.refetch).not.toHaveBeenCalled();
    });
});
