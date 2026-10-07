// @vitest-environment jsdom
import { act, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultAccountRecommendationSettings } from '../../../../storefront-content-plugin/src/shared/account-recommendation-settings';
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
    canUpdate: true,
    search: '',
    setSearchParams: vi.fn(),
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
vi.mock('react-router-dom', async importOriginal => ({
    ...(await importOriginal<typeof import('react-router-dom')>()),
    useLocation: () => ({ search: '' }),
    useSearchParams: () => [new URLSearchParams(mocks.search), mocks.setSearchParams],
}));
vi.mock('../../hooks/use-url-tab', () => ({ useUrlTab: () => ['PAGES', vi.fn()] }));
vi.mock('../../hooks/use-admin-permissions', () => ({
    useAdminPermissions: () => ({
        hasAnyPermission: (permissions: string[]) =>
            !permissions.includes('UpdateStorefrontContent') || mocks.canUpdate,
    }),
}));
vi.mock('../../components/FeatureHelp', () => ({
    FeatureHelpButton: ({ title, description }: { title: string; description?: string }) => (
        <span data-help-title={title} data-help-description={description} />
    ),
}));
vi.mock('./StorefrontVisualPresetPanel', () => ({ StorefrontVisualPresetPanel: () => null }));
vi.mock('./StorefrontAuthSettingsPanel', () => ({ StorefrontAuthSettingsPanel: () => null }));
vi.mock('./StorefrontBlockEditor', () => ({
    StorefrontBlockEditor: ({
        value,
        onSave,
        initialLanguage,
        reviewTarget,
    }: {
        value: StorefrontContentBlock;
        onSave: (value: StorefrontContentBlock) => Promise<void>;
        initialLanguage?: string;
        reviewTarget?: { itemId: string | null; field: string | null };
    }) => (
        <button
            aria-label="保存测试草稿"
            data-block-id={value.id ?? 'new'}
            data-block-type={value.type}
            data-block-position={value.position}
            data-display-mode={value.settings?.displayMode as string}
            data-review-language={initialLanguage}
            data-review-item={reviewTarget?.itemId ?? undefined}
            data-review-field={reviewTarget?.field ?? undefined}
            onClick={() => void onSave(value)}
        >
            保存测试草稿
        </button>
    ),
}));
vi.mock('./StorefrontDecorationPreview', () => ({
    StorefrontDecorationPreview: ({ language }: { language: string }) => {
        const [instance] = useState(() => crypto.randomUUID());
        return (
            <section
                data-testid="shared-client-preview"
                data-client-preview={instance}
                data-language={language}
            />
        );
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
    mocks.canUpdate = true;
    mocks.search = '';
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
    it('opens an audit deep link for content-only blocks in the shared existing editor without writing', async () => {
        const legal = { ...newContentBlock('LEGAL', 5), id: 'legal-87', items: [item] };
        current.storefrontContentBlocks.push(legal);
        mocks.search = '?blockId=legal-87&itemId=card&field=description&language=en';
        await render();
        const editor = button('保存测试草稿');
        expect(editor.dataset.blockId).toBe('legal-87');
        expect(editor.dataset.reviewLanguage).toBe('en');
        expect(editor.dataset.reviewItem).toBe('card');
        expect(editor.dataset.reviewField).toBe('description');
        expect(mocks.update).not.toHaveBeenCalled();
        expect(mocks.create).not.toHaveBeenCalled();
    });

    it('does not open an audit deep link for another store or without edit permission', async () => {
        mocks.search = '?blockId=missing-from-store&field=title&language=en';
        await render();
        expect(host.querySelector('[aria-label="保存测试草稿"]')).toBeNull();
        mocks.search = '?blockId=core&field=title&language=en';
        mocks.canUpdate = false;
        await render();
        expect(host.querySelector('[aria-label="保存测试草稿"]')).toBeNull();
    });
    it('creates independent custom card floors repeatedly without editing existing custom ads or images', async () => {
        const existing = {
            ...newContentBlock('CUSTOM', 10, '空间灵感'),
            id: 'existing-ad',
            updatedAt: core.updatedAt,
            settings: { displayMode: 'scrollingAds' },
            imageAssetId: 'existing-image',
            items: [item],
        };
        current.storefrontContentBlocks.push(existing);
        mocks.create.mockImplementation(({ variables: { input } }) => {
            const saved = {
                ...input,
                id: `custom-${mocks.create.mock.calls.length}`,
                updatedAt: core.updatedAt,
            };
            current.storefrontContentBlocks.push(saved);
            return Promise.resolve({ data: { createStorefrontContentBlock: saved } });
        });
        mocks.refetch.mockImplementation(() => Promise.resolve({ data: current }));
        await render();
        for (const position of [11, 12]) {
            await click('新增自定义图文／卡片模块');
            const draft = button('保存测试草稿');
            expect(draft.dataset.blockId).toBe('new');
            expect(draft.dataset.blockType).toBe('CUSTOM');
            expect(draft.dataset.displayMode).toBeUndefined();
            expect(draft.dataset.blockPosition).toBe(String(position));
            await click('保存测试草稿');
            expect(host.querySelector('[role="alert"]')).toBeNull();
            expect(host.querySelector('button[aria-label="保存测试草稿"]')).toBeNull();
        }
        expect(mocks.create).toHaveBeenCalledTimes(2);
        const inputs = mocks.create.mock.calls.map(([request]) => request.variables.input);
        expect(inputs.map(input => input.position)).toEqual([11, 12]);
        expect(inputs.every(input => input.enabled === false && input.type === 'CUSTOM')).toBe(true);
        expect(new Set(inputs.map(input => input.code)).size).toBe(2);
        expect(mocks.update).not.toHaveBeenCalled();
        expect(current.storefrontContentBlocks.find(block => block.id === existing.id)).toEqual(existing);
        expect(button('新增自定义图文／卡片模块').disabled).toBe(false);
    });

    it('opens each configured scrolling ad independently and keeps adding a separate draft', async () => {
        const ads = ['空间灵感', '新品灵感'].map((name, index) => ({
            ...newContentBlock('CUSTOM', index + 1, name),
            id: `ad-${index}`,
            updatedAt: core.updatedAt,
            settings: { displayMode: 'scrollingAds', scrollIntervalSeconds: 6 },
            items: [{ ...item, id: `ad-item-${index}` }],
        }));
        current.storefrontContentBlocks.push(...ads, newContentBlock('CUSTOM', 3, '普通图文'));
        await render();
        expect(host.textContent).toContain('已配置 2 组');
        expect(host.querySelector('[aria-label="编辑滚动广告：普通图文"]')).toBeNull();
        for (const ad of ads) {
            await click(`编辑滚动广告：${ad.internalName}`);
            expect(button('保存测试草稿').dataset.blockId).toBe(ad.id);
        }
        const add = Array.from(host.querySelectorAll('button')).find(
            node => node.textContent === '新增滚动广告楼层',
        );
        await act(async () => add!.click());
        expect(button('保存测试草稿').dataset.blockId).toBe('new');
        expect(button('保存测试草稿').dataset.displayMode).toBe('scrollingAds');
        expect(mocks.create).not.toHaveBeenCalled();
        expect(mocks.update).not.toHaveBeenCalled();
    });

    it('removes the personal account background editor from store settings', async () => {
        await render();
        const settings = Array.from(host.querySelectorAll('button')).find(node =>
            node.textContent?.includes('设置'),
        );
        expect(settings).toBeDefined();
        await act(async () => settings!.click());
        expect(host.textContent).not.toContain('个人中心背景图片设置');
        expect(host.textContent).not.toContain('个人中心头图');
        expect(
            host.querySelector('[data-help-title="商城装修"]')?.getAttribute('data-help-description'),
        ).toContain('首页楼层');
    });
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
        mocks.canUpdate = true;
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

it('keeps the preview instance and language when switching the mobile editing view', async () => {
    await render();
    const preview = host.querySelector('[data-testid="shared-client-preview"]')!;
    const instance = preview.getAttribute('data-client-preview');
    const switcher = host.querySelector('[aria-label="编辑与预览视图"]')!;
    const buttons = switcher.querySelectorAll<HTMLButtonElement>('button');
    expect(buttons[0].getAttribute('aria-pressed')).toBe('true');
    expect(preview.closest('aside')?.classList.contains('hidden')).toBe(true);
    await act(async () => buttons[1].click());
    const select = host.querySelector<HTMLSelectElement>('select[aria-label="预览语言"]')!;
    await act(async () => {
        select.value = 'en';
        select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => buttons[0].click());
    await act(async () => buttons[1].click());
    expect(host.querySelector('[data-testid="shared-client-preview"]')).toBe(preview);
    expect(preview.getAttribute('data-client-preview')).toBe(instance);
    expect(preview.getAttribute('data-language')).toBe('en');
    expect(preview.closest('aside')?.classList.contains('hidden')).toBe(false);
    expect(buttons[1].getAttribute('aria-pressed')).toBe('true');
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.other).not.toHaveBeenCalled();
});

it('forwards the selected language to the shared client preview without changing saved content', async () => {
    current = data('a', true);
    current.storefrontContentBlocks[0].translations = [current.storefrontContentBlocks[0].translations[0]];
    const saved = JSON.stringify(current.storefrontContentBlocks);
    await render();
    const preview = host.querySelector('[data-testid="shared-client-preview"]')!;
    expect(preview.getAttribute('data-language')).toBe('zh_Hans');
    const select = host.querySelector<HTMLSelectElement>('select[aria-label="预览语言"]')!;
    await act(async () => {
        select.value = 'en';
        select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(preview.getAttribute('data-language')).toBe('en');
    expect(JSON.stringify(current.storefrontContentBlocks)).toBe(saved);
    expect(mocks.update).not.toHaveBeenCalled();
});

it('keeps saved item order intact when the shared client preview changes language', async () => {
    current = data('a', true);
    current.storefrontContentBlocks[0].items = [
        { ...item, id: 'second', position: 2 },
        { ...item, id: 'first', position: 1 },
    ];
    const saved = JSON.stringify(current.storefrontContentBlocks[0].items);
    await render();
    const select = host.querySelector<HTMLSelectElement>('select[aria-label="预览语言"]')!;
    await act(async () => {
        select.value = 'en';
        select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(host.querySelector('[data-testid="shared-client-preview"]')?.getAttribute('data-language')).toBe(
        'en',
    );
    expect(JSON.stringify(current.storefrontContentBlocks[0].items)).toBe(saved);
    expect(mocks.update).not.toHaveBeenCalled();
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

describe('personal-data export visibility', () => {
    it('defaults off and verifies enable and disable writes in the selected store', async () => {
        mocks.other.mockImplementation(async ({ variables }) => ({
            data: { updateStorefrontPersonalDataExportEnabled: variables.enabled },
        }));
        mocks.refetch.mockImplementation(async () => {
            current = {
                ...current,
                storefrontContentSettings: {
                    ...current.storefrontContentSettings,
                    personalDataExportEnabled: mocks.other.mock.calls.at(-1)?.[0].variables.enabled,
                },
            };
            return { data: current };
        });
        await render();
        expect(button('个人数据导出入口').getAttribute('aria-checked')).toBe('false');
        await click('个人数据导出入口');
        expect(mocks.other).toHaveBeenLastCalledWith({
            context: { headers: { 'vendure-token': 'store-a' } },
            variables: { enabled: true },
        });
        expect(host.textContent).toContain('个人数据导出入口已开启');
        await render();
        expect(button('个人数据导出入口').getAttribute('aria-checked')).toBe('true');
        await click('个人数据导出入口');
        await render();
        expect(button('个人数据导出入口').getAttribute('aria-checked')).toBe('false');
        expect(host.textContent).toContain('个人数据导出入口已关闭');
    });
    it('keeps the switch off and reports failed readback without a false success', async () => {
        mocks.other.mockResolvedValue({ data: { updateStorefrontPersonalDataExportEnabled: true } });
        mocks.refetch.mockResolvedValue({ data: current });
        await render();
        await click('个人数据导出入口');
        expect(host.textContent).toContain('重新读取结果不一致');
        expect(host.textContent).not.toContain('个人数据导出入口已开启');
        expect(button('个人数据导出入口').getAttribute('aria-checked')).toBe('false');
    });
    it('disables the switch without update permission', async () => {
        mocks.canUpdate = false;
        await render();
        await click('个人数据导出入口');
        expect(button('个人数据导出入口').disabled).toBe(true);
        expect(mocks.other).not.toHaveBeenCalled();
    });
});

describe('account recommendation settings', () => {
    async function openSettings() {
        await render();
        const open = Array.from(host.querySelectorAll('button')).find(
            node => node.textContent?.trim() === '装修设置',
        );
        await act(async () => open!.click());
    }
    const form = () => host.querySelector<HTMLFormElement>('form[aria-label="账户推荐设置"]')!;
    async function setLimit(value: string) {
        const input = form().querySelector<HTMLInputElement>('input[type="number"]')!;
        await act(async () => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
    }
    async function save() {
        await act(async () => form().dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    }
    it('defaults to eight and verifies saved values against the selected store', async () => {
        mocks.other.mockImplementation(async ({ variables }) => ({
            data: { updateStorefrontAccountRecommendations: variables.input },
        }));
        mocks.refetch.mockImplementation(async () => {
            current = {
                ...current,
                storefrontContentSettings: {
                    ...current.storefrontContentSettings,
                    accountRecommendations: mocks.other.mock.calls.at(-1)![0].variables.input,
                },
            };
            return { data: current };
        });
        await openSettings();
        expect(form().querySelector<HTMLInputElement>('input[type="number"]')!.value).toBe('8');
        expect(form().textContent).not.toContain('今日净销量');
        expect(
            form()
                .querySelector('[data-help-title="账户 · 专属推荐"]')
                ?.getAttribute('data-help-description'),
        ).toContain('今日净销量');
        await setLimit('6');
        await save();
        expect(mocks.other).toHaveBeenLastCalledWith({
            context: { headers: { 'vendure-token': 'store-a' } },
            variables: { input: { ...defaultAccountRecommendationSettings, limit: 6 } },
        });
        expect(host.textContent).toContain('账户推荐已保存');
        await render();
        expect(form().querySelector<HTMLInputElement>('input[type="number"]')!.value).toBe('6');
        current = data('b');
        mocks.token = 'store-b';
        await render();
        const open = Array.from(host.querySelectorAll('button')).find(
            node => node.textContent?.trim() === '装修设置',
        );
        await act(async () => open!.click());
        expect(form().querySelector<HTMLInputElement>('input[type="number"]')!.value).toBe('8');
    });
    it('reports a readback mismatch without claiming a save and preserves the draft', async () => {
        mocks.other.mockImplementation(async ({ variables }) => ({
            data: { updateStorefrontAccountRecommendations: variables.input },
        }));
        mocks.refetch.mockImplementation(async () => {
            current = {
                ...current,
                storefrontContentSettings: {
                    ...current.storefrontContentSettings,
                    accountRecommendations: { ...defaultAccountRecommendationSettings, limit: 4 },
                },
            };
            return { data: current };
        });
        await openSettings();
        await setLimit('6');
        await save();
        expect(host.textContent).toContain('账户推荐重新读取结果不一致');
        expect(host.textContent).not.toContain('账户推荐已保存');
        expect(form().querySelector<HTMLInputElement>('input[type="number"]')!.value).toBe('6');
    });
    it('rejects invalid counts and prevents writes without update permission', async () => {
        await openSettings();
        await setLimit('11');
        await save();
        expect(form().textContent).toContain('1–10');
        expect(mocks.other).not.toHaveBeenCalled();
        mocks.canUpdate = false;
        await render();
        await setLimit('6');
        await save();
        expect(form().querySelector('fieldset')!.disabled).toBe(true);
        expect(mocks.other).not.toHaveBeenCalled();
    });
});

// The business fixtures own mocked data; lifecycle behavior is tested with real Apollo.
vi.mock('../../hooks/use-admin-query', () => import('../../test/admin-query-mock'));
