// @vitest-environment jsdom
import { act, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StorefrontContentBlock, StorefrontContentResult } from '../../graphql/storefront.graphql';
import { newContentBlock, newContentItem } from './storefront-content-utils';
import { StorefrontContentModule } from './StorefrontContentModule';
import { StorefrontModule } from './StorefrontModule';

const mocks = vi.hoisted(() => ({
    query: vi.fn(),
    refetch: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
    other: vi.fn(),
    token: 'store-a',
}));
vi.mock('@apollo/client/react', () => ({
    useQuery: mocks.query,
    useMutation: (document: { definitions: Array<{ kind?: string; name?: { value: string } }> }) => {
        const name = document.definitions.find(definition => definition.kind === 'OperationDefinition')?.name
            ?.value;
        return [
            name === 'NextAdminUpdateStorefrontBlock'
                ? mocks.update
                : name === 'NextAdminCreateStorefrontBlock'
                  ? mocks.create
                  : mocks.other,
            { loading: false },
        ];
    },
}));
vi.mock('../../apollo', () => ({
    getActiveChannelToken: () => mocks.token,
    channelRequestContext: (token: string) => ({ headers: { 'vendure-token': token } }),
}));
vi.mock('react-router-dom', () => ({
    useLocation: () => ({ search: '' }),
    useSearchParams: () => [new URLSearchParams(), vi.fn()],
}));
vi.mock('../../hooks/use-url-tab', () => ({ useUrlTab: () => ['PAGES', vi.fn()] }));
vi.mock('../../hooks/use-admin-permissions', () => ({
    useAdminPermissions: () => ({ hasAnyPermission: () => true }),
}));
vi.mock('../../components/FeatureHelp', () => ({ FeatureHelpButton: () => null }));
vi.mock('./StorefrontVisualPresetPanel', () => ({ StorefrontVisualPresetPanel: () => null }));
vi.mock('./DesktopCategoryBannerPanel', () => ({ DesktopCategoryBannerPanel: () => null }));
vi.mock('./AccountHeroImagePanel', () => ({ AccountHeroImagePanel: () => null }));
vi.mock('./StorefrontAuthSettingsPanel', () => ({ StorefrontAuthSettingsPanel: () => null }));
vi.mock('./StorefrontBlockEditor', () => ({
    StorefrontBlockEditor: ({
        value,
        onSave,
    }: {
        value: StorefrontContentBlock;
        onSave: (value: StorefrontContentBlock) => Promise<void>;
    }) => (
        <button aria-label="保存测试草稿" onClick={() => void onSave(value)}>
            保存测试草稿
        </button>
    ),
}));
vi.mock('./StorefrontDecorationPreview', () => ({
    StorefrontDecorationPreview: ({ language }: { language: string }) => {
        const [instance] = useState(() => crypto.randomUUID());
        return <section data-client-preview={instance} data-language={language} />;
    },
}));
vi.mock('./StorefrontFloorList', () => ({
    StorefrontFloorList: ({
        rows,
        renderRow,
    }: {
        rows: unknown[];
        renderRow: (row: unknown, index: number, handle: ReactNode) => ReactNode;
    }) => (
        <>
            {rows.map((row, index) => (
                <div key={index}>{renderRow(row, index, null)}</div>
            ))}
        </>
    ),
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root, current: StorefrontContentResult;
const item = {
    ...newContentItem(0),
    id: 'card',
    translations: [
        { languageCode: 'zh_Hans' as const, label: '客服', description: '' },
        { languageCode: 'en' as const, label: 'Support', description: '' },
    ],
};
const core = {
    ...newContentBlock('CORE_CATEGORIES', 0),
    id: 'core',
    updatedAt: '2026-09-26T00:00:00Z',
    enabled: false,
    items: [item],
};
function data(channel = 'a', enabled = false): StorefrontContentResult {
    return {
        activeChannel: {
            id: channel,
            code: channel,
            token: 'store-' + channel,
            defaultLanguageCode: 'zh_Hans',
            availableLanguageCodes: ['zh_Hans', 'en'],
        },
        storefrontContentBlocks: [{ ...core, enabled }],
        storefrontContentSettings: {
            heroAutoplayIntervalSeconds: 5,
            configuredBlockTypes: ['CORE_CATEGORIES'],
        },
        storefrontAuthConfiguration: {} as StorefrontContentResult['storefrontAuthConfiguration'],
    };
}
function button(label: string) {
    const node = host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
    if (!node) throw new Error('Missing button: ' + label);
    return node;
}
async function render() {
    await act(async () => {
        root.render(<StorefrontModule />);
    });
}
async function click(label: string) {
    await act(async () => {
        button(label).click();
    });
}
beforeEach(() => {
    vi.clearAllMocks();
    mocks.token = 'store-a';
    current = data();
    mocks.query.mockImplementation((_document, options) => ({
        data: options?.skip ? undefined : current,
        loading: false,
        refetch: mocks.refetch,
    }));
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
});
afterEach(() => {
    act(() => root.unmount());
    host.remove();
});

describe('store scoped verified content writes', () => {
    it('does not report enabled when the mutation returns no saved record', async () => {
        mocks.update.mockResolvedValue({ data: null });
        await render();
        await click('启用楼层');
        expect(host.querySelector('[role="alert"]')?.textContent).toContain('未返回');
        expect(host.querySelector('[role="status"]')).toBeNull();
        expect(mocks.refetch).not.toHaveBeenCalled();
    });
    it('rejects a stale readback after a successful mutation', async () => {
        mocks.update.mockResolvedValue({
            data: { updateStorefrontContentBlock: { ...core, enabled: true } },
        });
        mocks.refetch.mockResolvedValue({ data: data('a', false) });
        await render();
        await click('启用楼层');
        expect(host.querySelector('[role="alert"]')?.textContent).toContain('不一致');
        expect(host.querySelector('[role="status"]')).toBeNull();
    });
    it('waits for verification, prevents duplicate clicks and pins the mutation to the selected store', async () => {
        mocks.update.mockResolvedValue({
            data: { updateStorefrontContentBlock: { ...core, enabled: true } },
        });
        let resolve!: (value: { data: StorefrontContentResult }) => void;
        mocks.refetch.mockReturnValue(
            new Promise(value => {
                resolve = value;
            }),
        );
        await render();
        await click('启用楼层');
        expect(host.querySelector('[role="status"]')).toBeNull();
        expect(button('启用楼层').disabled).toBe(true);
        await click('启用楼层');
        expect(mocks.update).toHaveBeenCalledTimes(1);
        expect(mocks.update.mock.calls[0][0].context.headers['vendure-token']).toBe('store-a');
        await act(async () => {
            resolve({ data: data('a', true) });
        });
        expect(host.querySelector('[role="status"]')?.textContent).toContain('已保存并重新读取核对');
    });
    it('rejects a readback belonging to a different store', async () => {
        mocks.update.mockResolvedValue({
            data: { updateStorefrontContentBlock: { ...core, enabled: true } },
        });
        mocks.refetch.mockResolvedValue({ data: data('b', true) });
        await render();
        await click('启用楼层');
        expect(host.querySelector('[role="alert"]')?.textContent).toContain('店铺不一致');
        expect(host.querySelector('[role="status"]')).toBeNull();
    });
    it('discards the previous store draft and never shows its late save feedback in the next store', async () => {
        await render();
        await click('编辑');
        expect(button('保存测试草稿')).toBeTruthy();
        current = data('b');
        mocks.token = 'store-b';
        await render();
        expect(host.querySelector('button[aria-label="保存测试草稿"]')).toBeNull();
        current = data();
        mocks.token = 'store-a';
        await render();
        let resolve!: (value: unknown) => void;
        mocks.update.mockReturnValue(
            new Promise(value => {
                resolve = value;
            }),
        );
        await click('启用楼层');
        current = data('b');
        mocks.token = 'store-b';
        await render();
        await act(async () => {
            resolve({ data: { updateStorefrontContentBlock: { ...core, enabled: true } } });
        });
        expect(mocks.refetch).not.toHaveBeenCalled();
        expect(host.querySelector('[role="status"]')).toBeNull();
        expect(host.querySelector('[role="alert"]')).toBeNull();
    });
    it('blocks writes while the query still contains the previous store', async () => {
        mocks.token = 'store-b';
        await render();
        expect(host.querySelector('button[aria-label="启用楼层"]')).toBeNull();
        expect(mocks.update).not.toHaveBeenCalled();
    });
});

describe('policy and support configuration uses verified writes as well', () => {
    it.each([false, true])(
        'reports success only if readback contains the saved enable state (%s)',
        async verified => {
            const legal = {
                ...newContentBlock('LEGAL', 0, '隐私政策'),
                id: 'legal',
                updatedAt: '2026-09-26T00:00:00Z',
                enabled: false,
            };
            current.storefrontContentBlocks = [legal];
            const refreshed = { ...current, storefrontContentBlocks: [{ ...legal, enabled: verified }] };
            mocks.update.mockResolvedValue({
                data: { updateStorefrontContentBlock: { ...legal, enabled: true } },
            });
            mocks.refetch.mockResolvedValue({ data: refreshed });
            await act(async () => {
                root.render(<StorefrontContentModule />);
            });
            const toggle = Array.from(host.querySelectorAll('button')).find(node =>
                node.textContent?.includes('启用'),
            );
            if (!toggle) throw new Error('Missing policy toggle');
            await act(async () => {
                toggle.click();
            });
            expect(
                Boolean(host.querySelector('[role="status"]')?.textContent?.includes('已保存并重新读取核对')),
            ).toBe(verified);
            expect(Boolean(host.querySelector('[role="alert"]'))).toBe(!verified);
        },
    );
});

it('forwards the selected publication language to the actual client preview', async () => {
    current = data('a', true);
    current.storefrontContentBlocks[0].translations = [current.storefrontContentBlocks[0].translations[0]];
    await render();
    const preview = host.querySelector('[data-client-preview]');
    expect(preview?.getAttribute('data-language')).toBe('zh_Hans');
    const select = host.querySelector<HTMLSelectElement>('select[aria-label="预览语言"]')!;
    await act(async () => {
        select.value = 'en';
        select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(preview?.getAttribute('data-language')).toBe('en');
});

it('refreshes the saved client preview after a verified content revision', async () => {
    current = data('a', true);
    await render();
    const instance = host.querySelector('[data-client-preview]')?.getAttribute('data-client-preview');
    expect(instance).toBeTruthy();
    current = {
        ...current,
        storefrontContentBlocks: current.storefrontContentBlocks.map(block => ({
            ...block,
            updatedAt: '2026-09-26T10:00:00Z',
            position: block.position + 1,
        })),
    };
    await render();
    expect(host.querySelector('[data-client-preview]')?.getAttribute('data-client-preview')).not.toBe(
        instance,
    );
});
