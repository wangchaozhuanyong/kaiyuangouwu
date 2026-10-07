// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmDialogContext, type RequestConfirmation } from '../../components/confirm-dialog-context';
import type { SettingsStoreFieldRecord } from '../../graphql/management.graphql';
import { AdminPermissionsContext } from '../../hooks/use-admin-permissions';
import { SystemSettingsPanel } from './SystemSettingsPanel';

const mocks = vi.hoisted(() => ({ useMutation: vi.fn(), useAdminQuery: vi.fn() }));
vi.mock('@apollo/client/react', () => ({ useMutation: mocks.useMutation }));
vi.mock('../../hooks/use-admin-query', () => ({ useAdminQuery: mocks.useAdminQuery }));
vi.mock('../../components/FeatureHelp', () => ({ FeatureHelpButton: () => null }));

const field = (key: string, currentValue: unknown, readonly = false): SettingsStoreFieldRecord => ({
    key,
    currentValue,
    readonly,
    scopeType: key.startsWith('storefront') ? 'CHANNEL' : 'GLOBAL',
});
const businessFields = [
    field('storefrontAuth.emailPasswordEnabled', true),
    field('storefrontAccount.personalDataExportEnabled', false),
    field('storefrontReview.enabled', null),
];
const technicalField = field('vendure.dashboard.userSettings', null);
let root: Root;
let container: HTMLDivElement;
let save: ReturnType<typeof vi.fn>;
let onChanged: ReturnType<typeof vi.fn<(message: string) => Promise<void>>>;
let onError: ReturnType<typeof vi.fn<(message: string) => void>>;
let confirm: ReturnType<typeof vi.fn<RequestConfirmation>>;
const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean };

beforeEach(() => {
    environment.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    save = vi.fn().mockResolvedValue({ data: { setSettingsStoreValue: { result: true, error: null } } });
    onChanged = vi.fn<(message: string) => Promise<void>>().mockResolvedValue(undefined);
    onError = vi.fn<(message: string) => void>();
    confirm = vi.fn<RequestConfirmation>().mockResolvedValue(false);
    mocks.useMutation.mockReturnValue([save, { loading: false }]);
    mocks.useAdminQuery.mockReturnValue({ data: undefined });
});
afterEach(() => {
    act(() => root.unmount());
    container.remove();
    environment.IS_REACT_ACT_ENVIRONMENT = false;
    vi.clearAllMocks();
});

function render(
    fields = [technicalField],
    channelCode: string | null = 'shop-a',
    permissions = ['SuperAdmin'],
) {
    act(() =>
        root.render(
            <MemoryRouter>
                <AdminPermissionsContext.Provider value={{ permissions, hasAnyPermission: () => true }}>
                    <ConfirmDialogContext.Provider value={confirm}>
                        <SystemSettingsPanel
                            fields={fields}
                            channelCode={channelCode ?? undefined}
                            onChanged={onChanged}
                            onError={onError}
                        />
                    </ConfirmDialogContext.Provider>
                </AdminPermissionsContext.Provider>
            </MemoryRouter>,
        ),
    );
}
function button(label: string) {
    const match = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
        node => node.textContent === label,
    );
    if (!match) throw new Error(`找不到按钮：${label}`);
    return match;
}
async function click(node: HTMLElement) {
    await act(async () => node.click());
}
function input(node: HTMLInputElement | HTMLTextAreaElement, value: string) {
    act(() => {
        const prototype =
            node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(node, value);
        node.dispatchEvent(new Event('input', { bubbles: true }));
    });
}
async function openEditor() {
    await click(container.querySelector('[data-settings-diagnostics] summary')!);
    await click(button('高级编辑'));
    return document.querySelector<HTMLTextAreaElement>('[aria-label="原始配置数据"]')!;
}

describe('advanced settings for business administrators', () => {
    it('shows Chinese daily settings and keeps raw keys and read-only data in folded diagnostics', () => {
        render([...businessFields, technicalField, field('systemOperations.workerHeartbeat', null, true)]);
        const daily = container.querySelector('section')!;
        expect(daily.textContent).toContain('邮箱密码登录');
        expect(daily.textContent).toContain('客户个人数据导出');
        expect(daily.textContent).toContain('客户端商品评价');
        expect(daily.textContent).toContain('未单独设置');
        expect(daily.textContent).not.toContain('storefrontAuth.');
        expect(daily.querySelectorAll('a')).toHaveLength(3);
        expect(container.querySelector<HTMLDetailsElement>('[data-settings-diagnostics]')!.open).toBe(false);
        expect(container.querySelectorAll('button[aria-label^="高级编辑"]')).toHaveLength(1);
        expect(save).not.toHaveBeenCalled();
    });

    it('renders one dynamic business field per table row without inserting catalogue defaults', () => {
        render([businessFields[0], technicalField]);
        const table = container.querySelector('section table')!;
        expect(Array.from(table.querySelectorAll('th')).map(node => node.textContent)).toEqual([
            '配置名称',
            '已保存摘要',
            '定义范围',
            '用途',
        ]);
        expect(table.querySelectorAll('tbody tr')).toHaveLength(1);
        expect(table.querySelectorAll('tbody td')).toHaveLength(4);
        expect(container.textContent).not.toContain('客户端商品评价');
        expect(save).not.toHaveBeenCalled();
    });

    it('guides platform users to select a store and does not link to blocked store pages', () => {
        render(businessFields, '__default_channel__');
        expect(container.textContent).toContain('请先在顶部选择需要管理的经营店铺');
        expect(container.querySelectorAll('a')).toHaveLength(0);
        render(businessFields, 'shop-a', ['ReadSystem']);
        expect(container.querySelectorAll('a')).toHaveLength(0);
        expect(container.textContent).toContain('具有对应管理权限');
    });

    it('shows store entries only while the fallback context identifies an operating store', () => {
        render(businessFields, null);
        expect(container.querySelectorAll('a')).toHaveLength(0);

        mocks.useAdminQuery.mockReturnValue({ data: { activeChannel: { code: 'shop-a' } } });
        render(businessFields, null);
        expect(container.querySelectorAll('a')).toHaveLength(3);

        mocks.useAdminQuery.mockReturnValue({ data: undefined });
        render(businessFields, null);
        expect(container.querySelectorAll('a')).toHaveLength(0);
        expect(save).not.toHaveBeenCalled();
    });

    it('keeps an explicit platform context authoritative over a store bootstrap result', () => {
        mocks.useAdminQuery.mockReturnValue({ data: { activeChannel: { code: 'shop-a' } } });
        render(businessFields, '__default_channel__');
        expect(container.textContent).toContain('请先在顶部选择需要管理的经营店铺');
        expect(container.querySelectorAll('a')).toHaveLength(0);
        expect(save).not.toHaveBeenCalled();
    });

    it('keeps explicit store entries subject to the current management permissions', () => {
        mocks.useAdminQuery.mockReturnValue({
            data: { activeChannel: { code: '__default_channel__' } },
        });
        render(businessFields, 'shop-a');
        expect(container.querySelectorAll('a')).toHaveLength(3);

        render(businessFields, 'shop-a', ['ReadSystem']);
        expect(container.querySelectorAll('a')).toHaveLength(0);
        expect(container.textContent).toContain('具有对应管理权限');
        expect(save).not.toHaveBeenCalled();
    });

    it('searches by Chinese usage and keeps extension settings available for maintenance', async () => {
        render([...businessFields, field('extension.example', { value: 1 })]);
        const search = container.querySelector<HTMLInputElement>('[aria-label="搜索设置"]')!;
        input(search, '个人数据');
        await act(async () =>
            search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })),
        );
        expect(container.textContent).toContain('客户个人数据导出');
        expect(container.textContent).not.toContain('邮箱密码登录');
        input(search, 'extension.example');
        await act(async () =>
            search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })),
        );
        expect(container.textContent).toContain('扩展技术配置');
        expect(container.querySelector('[data-settings-diagnostics]')).not.toBeNull();
    });

    it('rejects malformed JSON and protects an unsaved draft when closing', async () => {
        render();
        const editor = await openEditor();
        input(editor, '{broken');
        await click(button('保存配置'));
        expect(document.querySelector('[role="alert"]')!.textContent).toContain('数据格式不正确');
        expect(save).not.toHaveBeenCalled();
        await click(button('取消'));
        expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: '放弃未保存的修改？' }));
        expect(editor.value).toBe('{broken');
        confirm.mockResolvedValue({});
        await click(button('取消'));
        expect(document.querySelector('[role="dialog"]')).toBeNull();
        expect(document.activeElement?.getAttribute('aria-label')).toBe('高级编辑管理员界面偏好');
    });

    it.each([
        ['false', false],
        ['12', 12],
        ['"文本"', '文本'],
        ['{"enabled":true}', { enabled: true }],
    ])('preserves JSON types when saving %s', async (text, value) => {
        render([field('extension.example', true)]);
        const editor = await openEditor();
        input(editor, text as string);
        await click(button('保存配置'));
        expect(save).toHaveBeenCalledExactlyOnceWith({
            variables: { input: { key: 'extension.example', value } },
        });
        expect(onChanged).toHaveBeenCalledOnce();
        expect(document.querySelector('[role="dialog"]')).toBeNull();
    });

    it('rejects top-level null before calling the non-null GraphQL input', async () => {
        render([field('extension.example', true)]);
        const editor = await openEditor();
        input(editor, 'null');
        await click(button('保存配置'));
        expect(document.querySelector('[role="alert"]')?.textContent).toContain('不接受顶层 null');
        expect(save).not.toHaveBeenCalled();
        expect(editor.value).toBe('null');
    });

    it('preserves drafts across refresh and requires the latest value before another save', async () => {
        render([field('extension.example', { version: 1 })]);
        const editor = await openEditor();
        input(editor, '{"draft":2}');
        render([field('extension.example', { version: 3 })]);
        expect(editor.value).toBe('{"draft":2}');
        expect(document.querySelector('[role="alert"]')!.textContent).toContain('当前输入已保留');
        expect(button('保存配置').disabled).toBe(true);
        await click(button('放弃草稿并读取最新值'));
        expect(editor.value).toBe('{"draft":2}');
        confirm.mockResolvedValue({});
        await click(button('放弃草稿并读取最新值'));
        expect(JSON.parse(editor.value)).toEqual({ version: 3 });
        expect(document.querySelector('[role="alert"]')).toBeNull();
        expect(save).not.toHaveBeenCalled();
    });

    it('keeps failed saves editable and does not repeat a successful write when readback fails', async () => {
        save.mockResolvedValueOnce({
            data: { setSettingsStoreValue: { result: false, error: '不符合格式' } },
        });
        render();
        const editor = await openEditor();
        input(editor, '{"value":1}');
        await click(button('保存配置'));
        expect(editor.value).toBe('{"value":1}');
        expect(onChanged).not.toHaveBeenCalled();
        expect(onError).toHaveBeenCalledOnce();
        onChanged.mockRejectedValue(new Error('network'));
        await click(button('保存配置'));
        expect(save).toHaveBeenCalledTimes(2);
        expect(onError).toHaveBeenLastCalledWith('配置已保存，但最新数据读取失败，请刷新本页。');
        expect(document.querySelector('[role="dialog"]')).toBeNull();
    });
});
