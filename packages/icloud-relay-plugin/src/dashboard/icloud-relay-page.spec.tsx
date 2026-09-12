// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
    requests: [] as Array<{ name: string; variables: Record<string, unknown> }>,
    note: '原备注',
    pending: undefined as Promise<void> | undefined,
    queryFailure: false,
    failure: false,
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// Keep the real TanStack hooks. Only replace the network and presentation shell.
vi.mock('@vendure/dashboard', async () => {
    const React = await import('react');
    const query = await import('@tanstack/react-query');
    const element =
        (tag: string) =>
        ({ children, color, variant, ...props }: any) =>
            React.createElement(tag, props, children);
    return {
        Badge: element('span'),
        Button: element('button'),
        Input: element('input'),
        Table: element('table'),
        TableBody: element('tbody'),
        TableCell: element('td'),
        TableHead: element('th'),
        TableHeader: element('thead'),
        TableRow: element('tr'),
        useQuery: query.useQuery,
        toast: fixture.toast,
        api: {
            query: async (document: any) => {
                await Promise.resolve(); // Preserve an asynchronous network boundary.
                if (fixture.queryFailure) throw new Error('network unavailable');
                const name = document.definitions.find((d: any) => d.kind === 'OperationDefinition').name
                    .value;
                if (name === 'IcloudPrimaryAccounts')
                    return {
                        icloudPrimaryAccounts: [
                            {
                                id: '1',
                                email: 'test@icloud.com',
                                note: fixture.note,
                                status: 'ACTIVE',
                                codeResetIntervalDays: 0,
                                masterQueryCode: 'FIXTURE-CODE',
                                remainingDays: null,
                            },
                        ],
                    };
                if (name === 'IcloudVirtualEmails') return { icloudVirtualEmails: [] };
                return { icloudReceivedMails: [] };
            },
            mutate: (document: any) => async (variables: Record<string, unknown>) => {
                const name = document.definitions.find((d: any) => d.kind === 'OperationDefinition').name
                    .value;
                fixture.requests.push({ name, variables });
                await fixture.pending;
                if (fixture.failure) throw new Error('保存失败，请重试');
                fixture.note = (variables.input as { note: string }).note;
                return { updateIcloudPrimaryAccount: { id: '1', note: fixture.note } };
            },
        },
    };
});

import { IcloudRelayPage } from './icloud-relay-page';

describe('registered legacy iCloud dashboard', () => {
    let root: Root;
    let container: HTMLDivElement;
    let client: QueryClient;
    const required = <T,>(element: T | null | undefined): T => {
        if (!element) throw new Error('Expected element missing');
        return element;
    };
    const button = (text: string) =>
        required([...container.querySelectorAll('button')].find(b => b.textContent?.includes(text)));
    const flush = async (action: () => void) => {
        await act(async () => {
            action();
            await Promise.resolve();
        });
    };
    const click = async (element: HTMLElement) => {
        await flush(() => element.click());
    };
    beforeEach(async () => {
        vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
        fixture.note = '原备注';
        fixture.requests = [];
        fixture.pending = undefined;
        fixture.queryFailure = false;
        fixture.failure = false;
        vi.clearAllMocks();
        client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
        await flush(() =>
            root.render(
                <QueryClientProvider client={client}>
                    <IcloudRelayPage />
                </QueryClientProvider>,
            ),
        );
        await act(async () => {
            await vi.waitFor(() => expect(container.textContent).toContain('test@icloud.com'));
        });
    });
    afterEach(async () => {
        await flush(() => root.unmount());
        client.clear();
        container.remove();
        vi.unstubAllGlobals();
    });

    it('uses current hooks and typed variables, keeps zero cycle and disables closing a pending save', async () => {
        await click(required(container.querySelector<HTMLButtonElement>('button[title="编辑"]')));
        let release!: () => void;
        fixture.pending = new Promise<void>(resolve => {
            release = resolve;
        });
        expect(required(container.querySelector<HTMLInputElement>('input[type="number"]')).value).toBe('0');
        await click(button('保存'));
        expect(fixture.requests).toEqual([
            { name: 'UpdateIcloudPrimaryAccount', variables: { input: { id: '1', note: '原备注' } } },
        ]);
        expect(button('取消').matches(':disabled')).toBe(true);
        await click(button('保存'));
        expect(fixture.requests).toHaveLength(1);
        await flush(() => release());
        await act(async () => {
            await vi.waitFor(() => expect(container.querySelector('input')).toBeNull());
        });
    });

    it('retains the editor on mutation failure and reports readback failure after success', async () => {
        await click(required(container.querySelector<HTMLButtonElement>('button[title="编辑"]')));
        fixture.failure = true;
        await click(button('保存'));
        expect(container.querySelector('input')).toBeTruthy();
        expect(fixture.toast.error).toHaveBeenCalledWith('保存失败，请重试');
        fixture.failure = false;
        fixture.queryFailure = true;
        await click(button('保存'));
        await act(async () => {
            await vi.waitFor(() =>
                expect(container.querySelector('[role="alert"]')?.textContent).toContain('无需再次提交'),
            );
        });
        expect(container.querySelector('input')).toBeNull();
        fixture.queryFailure = false;
        await click(button('刷新'));
        await act(async () => {
            await vi.waitFor(() => expect(container.querySelector('[role="alert"]')).toBeNull());
        });
        expect(fixture.requests).toHaveLength(2);
    });
});
