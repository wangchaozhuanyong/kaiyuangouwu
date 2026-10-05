// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ManualDeliveryRecord } from '../../graphql/manual-digital-delivery.graphql';
import { DeliveryEditor } from './ManualDigitalDeliveryModule';
import { parseManualDeliveryPaste } from './manual-delivery-paste';

const mocks = vi.hoisted(() => ({
    record: null as ManualDeliveryRecord | null,
    save: vi.fn(),
    publish: vi.fn(),
    retry: vi.fn(),
    append: vi.fn(),
    loading: false,
    reveal: vi.fn(),
    canReveal: true,
}));
vi.mock('@apollo/client/react', () => ({
    useMutation: (document: { definitions: Array<{ kind: string; name?: { value: string } }> }) => {
        const name = document.definitions.find(item => item.kind === 'OperationDefinition')?.name?.value;
        return [
            name === 'NextAdminSaveManualDeliveryDraft'
                ? mocks.save
                : name === 'NextAdminPublishManualDelivery'
                  ? mocks.publish
                  : name === 'NextAdminRevealManualDelivery'
                    ? mocks.reveal
                    : name === 'NextAdminAppendManualDelivery'
                      ? mocks.append
                      : mocks.retry,
            { loading: mocks.loading },
        ];
    },
}));
vi.mock('../../hooks/use-admin-query', () => ({
    useAdminQuery: (_document: unknown, options: { skip?: boolean }) => ({
        data: options.skip ? undefined : { manualDigitalDelivery: { ...mocks.record, packages: [] } },
        loading: false,
        refetch: vi.fn(),
    }),
}));
vi.mock('../../hooks/use-admin-permissions', () => ({
    useAdminPermissions: () => ({ hasAnyPermission: () => mocks.canReveal }),
}));
vi.mock('../../components/FeatureHelp', () => ({ FeatureHelpButton: () => null }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const record = (): ManualDeliveryRecord => ({
    id: 'synthetic-task',
    updatedAt: '2026-10-04T08:00:00Z',
    state: 'DRAFT',
    recipientEmail: 'synthetic@example.invalid',
    productName: '合成成品',
    sku: 'SYNTHETIC',
    quantity: 2,
    hasContent: true,
    expectedAt: '2026-10-04T08:00:00Z',
    overdue: false,
    attemptCount: 0,
    order: { id: 'synthetic-order', code: 'SYNTHETIC' },
    packages: [
        {
            fields: [{ key: 'region', label: '地区', value: '示例地区', secret: false }],
            note: '原说明',
            attachmentAssetIds: ['synthetic-attachment'],
        },
    ],
});
const tsv = 'SYNTHETIC-A\tdummy-a-no-credential\t\t说明\t含逗号,及竖线|\t\n\n\t\t第二件仅说明';
beforeEach(() => {
    mocks.record = record();
    mocks.loading = false;
    mocks.canReveal = true;
    mocks.reveal.mockImplementation(async () => ({
        data: { revealMyManualDigitalDelivery: structuredClone(mocks.record) },
    }));
    mocks.save.mockResolvedValue({
        data: { saveManualDigitalDeliveryDraft: { id: 'synthetic-task', state: 'DRAFT' } },
    });
    mocks.publish.mockResolvedValue({
        data: { publishManualDigitalDelivery: { id: 'synthetic-task', state: 'SENDING' } },
    });
    mocks.retry.mockResolvedValue({
        data: { retryManualDigitalDelivery: { id: 'synthetic-task', state: 'SENDING' } },
    });
});
afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
});
async function withEditor(
    check: (host: HTMLDivElement, rerender: () => Promise<void>) => Promise<void>,
    canUpdate = true,
    autoReveal = true,
) {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const render = () =>
        act(async () =>
            root.render(
                <DeliveryEditor
                    id="synthetic-task"
                    canUpdate={canUpdate}
                    onSaved={vi.fn()}
                    onClose={vi.fn()}
                />,
            ),
        );
    try {
        await render();
        if (autoReveal && button(host, '查看已有交付内容')) await click(host, '查看已有交付内容');
        await check(host, render);
    } finally {
        await act(async () => root.unmount());
        host.remove();
    }
}
const button = (host: HTMLElement, text: string) =>
    [...host.querySelectorAll('button')].find(item => item.textContent?.trim() === text)!;
const click = (host: HTMLElement, text: string) => act(async () => button(host, text).click());
const paste = (host: HTMLElement, value: string) =>
    act(async () => {
        const input = host.querySelector<HTMLTextAreaElement>('[aria-label="批量成品 TSV"]')!;
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });

describe('manual delivery fixed TSV', () => {
    it('counts exact units and preserves note delimiters and blank optional columns', () => {
        const preview = parseManualDeliveryPaste(tsv.replace(/\n/g, '\r\n'), 2);
        expect(preview.errors).toEqual([]);
        expect(preview.ignoredEmptyLines).toBe(1);
        expect(preview.rows[0].note).toBe('\t说明\t含逗号,及竖线|\t');
        expect(preview.rows[1]).toEqual({ account: '', key: '', note: '第二件仅说明' });
    });
    it('rejects missing columns, empty packages and too few or too many units without echoing input secrets', () => {
        const invalid = parseManualDeliveryPaste('dummy-no-credential\n\t\t\naccount\tkey\t', 2);
        expect(invalid.errors.join(' ')).toContain('第 1 行格式不完整');
        expect(invalid.errors.join(' ')).toContain('第 2 行缺少交付内容');
        expect(invalid.errors.join(' ')).not.toContain('dummy-no-credential');
        expect(invalid.errors.join(' ')).toContain('必须恰好提供 2 件');
        expect(parseManualDeliveryPaste(tsv, 1).errors.join(' ')).toContain('识别到 2 件');
        expect(parseManualDeliveryPaste('', 2).errors.join(' ')).toContain('识别到 0 件');
        expect(parseManualDeliveryPaste(tsv, 0).errors).toContain('任务应交付数量无效，请重新读取任务。');
    });
});
describe('manual delivery batch application', () => {
    it('uses current eligible quantity after a partial item refund, saving and publishing only the remaining one of two purchased units', async () => {
        mocks.record = { ...record(), quantity: 2, eligibleQuantity: 1, hasContent: false, packages: [] };
        await withEditor(
            async host => {
                expect(host.querySelectorAll('[aria-label$=" 账号"]')).toHaveLength(1);
                expect(host.textContent).toContain('应交付 1 件');
                await paste(host, tsv);
                await click(host, '校验并预览');
                expect(button(host, '应用到草稿').disabled).toBe(true);
                await paste(host, 'SYNTHETIC-REMAINING\t\t仅交付保留的一件');
                await click(host, '校验并预览');
                await click(host, '应用到草稿');
                await click(host, '保存草稿');
                expect(mocks.save.mock.calls[0][0].variables.input.packages).toHaveLength(1);
                await click(host, '发布交付');
                await click(host, '发布并通知买家');
                expect(mocks.publish.mock.calls[0][0].variables.input.packages).toHaveLength(1);
                expect(mocks.append).not.toHaveBeenCalled();
            },
            true,
            false,
        );
    });

    it.each(['SENT', 'EMAIL_FAILED'] as const)(
        'appends only missing content in %s, retaining the draft until a quantity receipt is confirmed',
        async state => {
            mocks.canReveal = false;
            const original = [
                {
                    fields: [{ key: 'account', label: '账号', value: 'SYNTHETIC-OLD-A', secret: false }],
                    note: '原成品A',
                    attachmentAssetIds: [],
                },
                { fields: [], note: '原成品B', attachmentAssetIds: [] },
            ];
            mocks.record = { ...record(), state, quantity: 2, eligibleQuantity: 3, packages: original };
            mocks.append
                .mockReset()
                .mockResolvedValueOnce({
                    data: {
                        appendManualDigitalDelivery: { id: 'synthetic-task', state: 'SENT', quantity: 2 },
                    },
                })
                .mockResolvedValueOnce({
                    data: {
                        appendManualDigitalDelivery: { id: 'synthetic-task', state: 'SENDING', quantity: 3 },
                    },
                });
            await withEditor(
                async host => {
                    expect(button(host, '查看已有交付内容')).toBeUndefined();
                    expect(button(host, '重发交付通知')).toBeUndefined();
                    await click(host, '补交新增成品');
                    expect(host.querySelectorAll('[aria-label="新增成品包 1 账号"]')).toHaveLength(1);
                    expect(host.querySelector('[aria-label="成品包 1 账号"]')).toBeNull();
                    expect(button(host, '保存草稿')).toBeUndefined();
                    expect(host.textContent).toContain('应补交 1 件');
                    await paste(host, 'SYNTHETIC-NEW\t\t仅追加新成品');
                    await click(host, '校验并预览');
                    await click(host, '应用到草稿');
                    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
                    await click(host, '关闭');
                    expect(confirm).toHaveBeenCalledOnce();
                    expect(mocks.append).not.toHaveBeenCalled();
                    await click(host, '确认补交内容');
                    expect(mocks.append).not.toHaveBeenCalled();
                    await click(host, '补交并发送通知');
                    expect(
                        host.querySelector<HTMLInputElement>('[aria-label="新增成品包 1 账号"]')?.value,
                    ).toBe('SYNTHETIC-NEW');
                    expect(host.textContent).toContain('后端未确认补交后的成品数量');
                    await click(host, '补交并发送通知');
                    expect(mocks.append.mock.calls[1][0].variables.input.packages).toEqual([
                        {
                            fields: [
                                { key: 'account', label: '账号', value: 'SYNTHETIC-NEW', secret: false },
                            ],
                            note: '仅追加新成品',
                            attachmentAssetIds: [],
                        },
                    ]);
                    expect(mocks.save).not.toHaveBeenCalled();
                    expect(mocks.publish).not.toHaveBeenCalled();
                    expect(mocks.reveal).not.toHaveBeenCalled();
                    expect(mocks.record?.packages).toEqual(original);
                    expect(host.querySelector('[aria-label="新增成品包 1 账号"]')).toBeNull();
                },
                true,
                false,
            );
        },
    );
    it('never reveals automatically or edits hidden existing content; explicit reveal bypasses the shared cache and close clears it', async () => {
        await withEditor(
            async host => {
                expect(mocks.reveal).not.toHaveBeenCalled();
                expect(host.querySelector('[aria-label="批量成品 TSV"]')).toBeNull();
                expect(host.querySelector('[aria-label="成品包 1 交付说明"]')).toBeNull();
                await click(host, '查看已有交付内容');
                expect(mocks.reveal).toHaveBeenCalledExactlyOnceWith({
                    variables: { id: 'synthetic-task' },
                    fetchPolicy: 'no-cache',
                });
                expect(
                    host.querySelector<HTMLTextAreaElement>('[aria-label="成品包 1 交付说明"]')?.value,
                ).toBe('原说明');
                await click(host, '关闭');
                expect(host.querySelector('[aria-label="成品包 1 交付说明"]')).toBeNull();
                expect(mocks.save).not.toHaveBeenCalled();
                expect(mocks.publish).not.toHaveBeenCalled();
            },
            true,
            false,
        );
        mocks.canReveal = false;
        mocks.record = { ...record(), state: 'SENT' };
        await withEditor(
            async host => {
                expect(button(host, '查看已有交付内容')).toBeUndefined();
                expect(host.querySelector('[aria-label="成品包 1 交付说明"]')).toBeNull();
                expect(button(host, '重发交付通知')).toBeTruthy();
            },
            true,
            false,
        );
    });
    it('previews masked secrets without changing packages; explicit apply preserves attachments and saving does not publish', async () => {
        await withEditor(async host => {
            await paste(host, tsv);
            await click(host, '校验并预览');
            const preview = host.querySelector('[aria-label="批量成品预览"]')!;
            expect(preview.textContent).toContain('识别 2 件 / 应交付 2 件');
            expect(preview.textContent).toContain('已遮盖');
            expect(preview.textContent).not.toContain('dummy-a-no-credential');
            expect(host.querySelector<HTMLInputElement>('[aria-label="成品包 1 账号"]')?.value).toBe('');
            expect(mocks.save).not.toHaveBeenCalled();
            expect(mocks.publish).not.toHaveBeenCalled();
            await click(host, '应用到草稿');
            expect(host.querySelector<HTMLInputElement>('[aria-label="成品包 1 账号"]')?.value).toBe(
                'SYNTHETIC-A',
            );
            expect(host.querySelector<HTMLTextAreaElement>('[aria-label="批量成品 TSV"]')?.value).toBe('');
            expect(host.textContent).toContain('尚未保存或发布');
            await click(host, '保存草稿');
            expect(mocks.save).toHaveBeenCalledTimes(1);
            expect(mocks.publish).not.toHaveBeenCalled();
            const input = mocks.save.mock.calls[0][0].variables.input;
            expect(input.packages).toHaveLength(2);
            expect(input.packages[0].attachmentAssetIds).toEqual(['synthetic-attachment']);
            expect(input.packages[0].fields).toContainEqual({
                key: 'region',
                label: '地区',
                value: '示例地区',
                secret: false,
            });
            expect(input.packages[0].fields).toContainEqual({
                key: 'password',
                label: '密钥/密码',
                value: 'dummy-a-no-credential',
                secret: true,
            });
            expect(input.packages[0].note).toBe('\t说明\t含逗号,及竖线|\t');
            await click(host, '发布交付');
            expect(mocks.publish).not.toHaveBeenCalled();
            await click(host, '发布并通知买家');
            expect(mocks.publish.mock.calls[0][0].variables.input).toEqual(input);
        });
    });
    it('blocks wrong counts and un-applied input, and discards a stale preview after text changes', async () => {
        await withEditor(async host => {
            await paste(host, 'SYNTHETIC-A\t\t说明');
            await click(host, '校验并预览');
            expect(button(host, '应用到草稿').disabled).toBe(true);
            await click(host, '保存草稿');
            expect(mocks.save).not.toHaveBeenCalled();
            expect(host.textContent).toContain('批量粘贴内容尚未应用');
            await paste(host, tsv);
            expect(host.querySelector('[aria-label="批量成品预览"]')).toBeNull();
            const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
            await click(host, '关闭');
            expect(confirm).toHaveBeenCalledOnce();
        });
    });
    it('keeps dirty packages on a server conflict and gates batch writes until a deliberate reload', async () => {
        await withEditor(async (host, rerender) => {
            await paste(host, tsv);
            await click(host, '校验并预览');
            await click(host, '应用到草稿');
            mocks.record = { ...record(), updatedAt: '2026-10-04T09:00:00Z' };
            await rerender();
            await click(host, '查看已有交付内容');
            expect(host.querySelector<HTMLInputElement>('[aria-label="成品包 1 账号"]')?.value).toBe(
                'SYNTHETIC-A',
            );
            expect(host.querySelector('[aria-label="批量成品 TSV"]')).toBeNull();
            expect(button(host, '保存草稿')).toBeUndefined();
            expect(mocks.save).not.toHaveBeenCalled();
        });
    });
    it('hides batch editing without permission and during terminal states; notification retry uses only the original task id', async () => {
        await withEditor(async host => {
            expect(host.querySelector('[aria-label="批量成品 TSV"]')).toBeNull();
        }, false);
        mocks.record = { ...record(), state: 'SENT' };
        await withEditor(async host => {
            expect(host.querySelector('[aria-label="批量成品 TSV"]')).toBeNull();
            await click(host, '重发交付通知');
            await click(host, '确认重发');
            expect(mocks.retry).toHaveBeenCalledExactlyOnceWith({ variables: { id: 'synthetic-task' } });
            expect(mocks.publish).not.toHaveBeenCalled();
            expect(mocks.save).not.toHaveBeenCalled();
            expect(host.textContent).toContain('不会分配新卡');
        });
    });
    it('gates batch controls and closing while a write is in flight', async () => {
        mocks.loading = true;
        mocks.record = { ...record(), hasContent: false, packages: [] };
        await withEditor(async host => {
            expect(
                host.querySelector<HTMLTextAreaElement>('[aria-label="批量成品 TSV"]')?.closest('fieldset')
                    ?.disabled,
            ).toBe(true);
            expect(button(host, '关闭').disabled).toBe(true);
            expect(button(host, '保存草稿').disabled).toBe(true);
        });
    });
});
