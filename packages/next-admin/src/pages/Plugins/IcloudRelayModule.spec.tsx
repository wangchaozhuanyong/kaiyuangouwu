// @vitest-environment jsdom
import { ApolloProvider } from '@apollo/client/react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createIcloudContractFixture } from '../../../e2e/icloud-contract/fixture';
import { ConfirmDialogProvider } from '../../components/ConfirmDialog';
import { FeatureHelpProvider } from '../../components/FeatureHelp';
import { IcloudRelayModule } from './IcloudRelayModule';

describe('iCloud admin save interactions against the server schema', () => {
    let root: Root;
    let container: HTMLDivElement;
    let fixture: ReturnType<typeof createIcloudContractFixture>;
    const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')!;
    const button = (text: string, scope: ParentNode = document) =>
        [...scope.querySelectorAll<HTMLButtonElement>('button')].find(item =>
            item.textContent?.includes(text),
        )!;
    async function click(element: HTMLElement) {
        await act(async () => element.click());
    }
    async function input(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
        await act(async () => {
            const prototype =
                element instanceof HTMLTextAreaElement
                    ? HTMLTextAreaElement.prototype
                    : HTMLInputElement.prototype;
            Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value);
            element.dispatchEvent(new Event('input', { bubbles: true }));
        });
    }
    async function editVirtual() {
        await click(button('虚拟邮箱管理'));
        await click(document.querySelector<HTMLButtonElement>('button[title="编辑备注"]')!);
    }
    beforeEach(async () => {
        vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
        fixture = createIcloudContractFixture();
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
        await act(async () =>
            root.render(
                <ApolloProvider client={fixture.client}>
                    <ConfirmDialogProvider>
                        <FeatureHelpProvider>
                            <IcloudRelayModule />
                        </FeatureHelpProvider>
                    </ConfirmDialogProvider>
                </ApolloProvider>,
            ),
        );
        await act(async () => {
            await vi.waitFor(() => expect(button('主邮箱管理 (1)')).toBeTruthy());
        });
    });
    afterEach(async () => {
        await act(async () => root.unmount());
        fixture.client.stop();
        container.remove();
        vi.unstubAllGlobals();
    });

    it('saves and reads back a virtual note, including clearing it', async () => {
        for (const note of ['主号1-虚拟1号', '']) {
            await editVirtual();
            await input(dialog().querySelector('#icloud-virtual-note')!, note);
            await click(button('保存', dialog()));
            await act(async () => {
                await vi.waitFor(() => expect(dialog()).toBeNull());
            });
            expect(
                fixture.state.requests.filter(r => r.name === 'UpdateIcloudVirtualEmail').at(-1)?.variables,
            ).toEqual({ input: { id: '2', note } });
            expect(fixture.state.virtual.note).toBe(note);
            await editVirtual();
            expect(dialog().querySelector<HTMLInputElement>('#icloud-virtual-note')!.value).toBe(note);
            await click(button('取消', dialog()));
        }
    });

    it('blocks duplicate saves while pending and keeps the entered note on failure for retry', async () => {
        let release!: () => void;
        fixture.state.pending = new Promise<void>(resolve => {
            release = resolve;
        });
        fixture.state.failure = '邮箱记录已发生变化，请刷新后重试';
        await editVirtual();
        await input(dialog().querySelector('#icloud-virtual-note')!, '保留待保存备注');
        await click(button('保存', dialog()));
        const saving = button('保存中', dialog());
        expect(saving.disabled).toBe(true);
        await click(saving);
        expect(fixture.state.requests.filter(r => r.name === 'UpdateIcloudVirtualEmail')).toHaveLength(1);
        await act(async () => release());
        await act(async () => {
            await vi.waitFor(() => expect(dialog().querySelector('[role="alert"]')).toBeTruthy());
        });
        expect(dialog().querySelector<HTMLInputElement>('#icloud-virtual-note')!.value).toBe(
            '保留待保存备注',
        );
        expect(fixture.state.virtual.note).toBe('原备注');
        fixture.state.failure = '';
        await click(button('保存', dialog()));
        await act(async () => {
            await vi.waitFor(() => expect(dialog()).toBeNull());
        });
        expect(fixture.state.virtual.note).toBe('保留待保存备注');
    });

    it('sends primary id inside input and does not reset the unchanged expiry period', async () => {
        await click(document.querySelector<HTMLButtonElement>('button[title="编辑主邮箱"]')!);
        await input(dialog().querySelector('input[placeholder="例如：主号1号、客户专用"]')!, '');
        await click(button('保存', dialog()));
        await act(async () => {
            await vi.waitFor(() => expect(dialog()).toBeNull());
        });
        expect(fixture.state.requests.find(r => r.name === 'UpdateIcloudPrimaryAccount')?.variables).toEqual({
            input: { id: '1', note: '' },
        });
        expect(fixture.state.primary.note).toBe('');
    });

    it('passes raw batch text to the schema and displays partial-import errors', async () => {
        fixture.state.batchResult = { createdCount: 1, skippedCount: 1, errors: ['第2行邮箱格式无效'] };
        await click(button('虚拟邮箱管理'));
        await click(button('批量导入'));
        const select = dialog().querySelector('select')!;
        await act(async () => {
            select.value = '1';
            select.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await input(dialog().querySelector('textarea')!, 'alias@icloud.com 主号1 备注\ninvalid-row');
        await click(button('开始导入', dialog()));
        await act(async () => {
            await vi.waitFor(() => expect(dialog()).toBeNull());
        });
        expect(
            fixture.state.requests.find(r => r.name === 'BatchCreateIcloudVirtualEmails')?.variables,
        ).toEqual({ input: { primaryAccountId: '1', rawInput: 'alias@icloud.com 主号1 备注\ninvalid-row' } });
        expect(document.body.textContent).toContain('成功创建 1 个，跳过 1 个');
        expect(document.body.textContent).toContain('第2行邮箱格式无效');
        expect(document.body.textContent).not.toContain('个重复项');
    });
    it('keeps a later dialog draft when an earlier save finishes', async () => {
        let release!: () => void;
        fixture.state.pending = new Promise<void>(resolve => {
            release = resolve;
        });
        await editVirtual();
        await input(dialog().querySelector('#icloud-virtual-note')!, '第一笔提交');
        await click(button('保存', dialog()));
        await click(button('取消', dialog()));
        await editVirtual();
        await input(dialog().querySelector('#icloud-virtual-note')!, '第二次打开的未提交草稿');
        expect(dialog().querySelector<HTMLInputElement>('#icloud-virtual-note')!.value).toContain('第二次');
        await act(async () => release());
        await act(async () => {
            await vi.waitFor(() => expect(fixture.state.virtual.note).toBe('第一笔提交'));
        });
        expect(fixture.state.virtual.note).toBe('第一笔提交');
        expect(dialog().querySelector<HTMLInputElement>('#icloud-virtual-note')!.value).toBe(
            '第二次打开的未提交草稿',
        );
    });

    it('reports query refresh failure and allows read-only retry', async () => {
        fixture.state.queryFailure = '加载失败：连接中断';
        await click(button('刷新'));
        await act(async () => {
            await vi.waitFor(() => expect(document.body.textContent).toContain('加载失败'));
        });
        expect(document.body.textContent).not.toContain('数据已刷新');
        fixture.state.queryFailure = '';
        await click(button('刷新'));
        await act(async () => {
            await vi.waitFor(() => expect(document.body.textContent).toContain('数据已刷新'));
        });
    });
    it('separates a committed save from failed readback and retries only queries', async () => {
        await editVirtual();
        fixture.state.queryFailure = 'query unavailable';
        await input(dialog().querySelector('#icloud-virtual-note')!, '已保存的备注');
        await click(button('保存', dialog()));
        await act(async () => {
            await vi.waitFor(() => expect(document.body.textContent).toContain('无需再次提交'));
        });
        expect(dialog()).toBeNull();
        expect(fixture.state.virtual.note).toBe('已保存的备注');
        fixture.state.queryFailure = '';
        await click(button('刷新'));
        await act(async () => {
            await vi.waitFor(() => expect(document.body.textContent).toContain('数据已刷新'));
        });
        expect(fixture.state.requests.filter(r => r.name === 'UpdateIcloudVirtualEmail')).toHaveLength(1);
    });

    it('blocks a malformed address before submitting and preserves its draft', async () => {
        await click(button('虚拟邮箱管理'));
        await click(button('新增虚拟邮箱'));
        await input(dialog().querySelector('input[type="email"]')!, '@');
        await click(button('保存', dialog()));
        expect(dialog().querySelector('[role="alert"]')?.textContent).toContain('邮箱地址格式无效');
        expect(fixture.state.requests.some(r => r.name === 'CreateIcloudVirtualEmail')).toBe(false);
    });
    it('distinguishes first-load failure from an empty account list', async () => {
        await act(async () => root.unmount());
        fixture.client.stop();
        fixture = createIcloudContractFixture();
        fixture.state.queryFailure = 'query unavailable';
        root = createRoot(container);
        await act(async () =>
            root.render(
                <ApolloProvider client={fixture.client}>
                    <ConfirmDialogProvider>
                        <FeatureHelpProvider>
                            <IcloudRelayModule />
                        </FeatureHelpProvider>
                    </ConfirmDialogProvider>
                </ApolloProvider>,
            ),
        );
        await act(async () => {
            await vi.waitFor(() => expect(document.body.textContent).toContain('主邮箱加载失败'));
        });
        expect(document.body.textContent).not.toContain('暂无主邮箱配置');
        fixture.state.queryFailure = '';
        await click(button('刷新'));
        await act(async () => {
            await vi.waitFor(() => expect(button('主邮箱管理 (1)')).toBeTruthy());
        });
        expect(document.body.textContent).not.toContain('加载失败');
    });
});
