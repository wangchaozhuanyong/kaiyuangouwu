// @vitest-environment jsdom
import { onlineManager, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterAll, afterEach, expect, it, vi } from 'vitest';

import { PAGE_DATA_TIMEOUT_MS, PageReadinessBoundary } from '../../page-readiness';
import { createStorefrontQueryClient, storefrontQueryKeys } from '../../query-client';
import { persistPublicQueryCache } from '../../query-persistence';

import { type GptRechargeClient } from './contracts';
import { GptRechargePage } from './gpt-recharge-page';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const cache = createStorefrontQueryClient();
cache.setDefaultOptions({ queries: { ...cache.getDefaultOptions().queries, retry: false } });
const container = document.createElement('div');
const root = createRoot(container);
const config = vi.fn<GptRechargeClient['config']>();
const verify = vi.fn();
const submit = vi.fn();
const task = vi.fn();
const lookupCode = vi.fn();
const client: GptRechargeClient = {
    config,
    verify,
    submit,
    query: lookupCode,
    task,
};
const key = (market = 'test:MYR', language = 'zh') => [
    ...storefrontQueryKeys.privateScope(market, language),
    'gpt-recharge',
    'config',
];
const render = async (visible = true, market = 'test:MYR', language: 'zh' | 'en' = 'zh') => {
    await act(async () => {
        root.render(
            <QueryClientProvider client={cache}>
                {visible && (
                    <PageReadinessBoundary
                        pending={false}
                        online
                        language={language}
                        onRetry={() => undefined}
                        onBack={() => undefined}
                    >
                        <GptRechargePage
                            client={client}
                            marketKey={market}
                            language={language}
                            onBack={() => undefined}
                        />
                    </PageReadinessBoundary>
                )}
            </QueryClientProvider>,
        );
        if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(10);
        else await new Promise(resolve => setTimeout(resolve, 10));
    });
};
afterEach(async () => {
    await render(false);
    vi.useRealTimers();
    onlineManager.setOnline(true);
    cache.clear();
    config.mockReset();
    verify.mockReset();
    submit.mockReset();
    task.mockReset();
    lookupCode.mockReset();
});
afterAll(() => act(() => root.unmount()));

it.each(['zh', 'en'] as const)(
    'keeps the cold-load form and draft stable while availability resolves (%s)',
    async language => {
        let finish!: (value: { enabled: boolean; maintenance: boolean }) => void;
        config.mockImplementationOnce(() => new Promise(resolve => (finish = resolve)));
        await render(true, 'test:MYR', language);
        const input = container.querySelector<HTMLInputElement>('#gpt-code');
        const sessionInput = container.querySelector<HTMLTextAreaElement>('#gpt-session');
        if (!input?.form) throw new Error('Recharge code form is missing');
        const form = input.form;
        expect(sessionInput).not.toBeNull();
        expect(container.querySelector('.gpt-recharge-result')).toBeNull();
        expect(container.querySelector<HTMLButtonElement>('.gpt-recharge-verify')?.disabled).toBe(true);
        expect(container.querySelector<HTMLButtonElement>('.gpt-recharge-submit')?.disabled).toBe(true);
        expect(container.querySelector('.gpt-recharge-verify')?.textContent).not.toContain('服务响应较慢');
        act(() => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
                input,
                'draft-code',
            );
            input.dispatchEvent(new Event('input', { bubbles: true }));
            form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        });
        expect(verify).not.toHaveBeenCalled();
        expect(submit).not.toHaveBeenCalled();
        await act(async () => {
            finish({ enabled: true, maintenance: false });
            await new Promise(resolve => setTimeout(resolve, 10));
        });
        expect(container.querySelector('#gpt-code')).toBe(input);
        expect(container.querySelector('#gpt-session')).toBe(sessionInput);
        expect(input.value).toBe('draft-code');
        expect(container.querySelector<HTMLButtonElement>('.gpt-recharge-verify')?.disabled).toBe(false);
        expect(container.querySelector<HTMLButtonElement>('.gpt-recharge-submit')?.disabled).toBe(true);
        expect(verify).not.toHaveBeenCalled();
        expect(submit).not.toHaveBeenCalled();
    },
);

it('shows only a local slow-read hint after the shared deadline and keeps other tabs usable', async () => {
    vi.useFakeTimers();
    config.mockImplementationOnce(() => new Promise(() => undefined));
    await render();
    await act(() => vi.advanceTimersByTimeAsync(PAGE_DATA_TIMEOUT_MS - 100));
    expect(container.querySelector('.gpt-recharge-verify')?.textContent).not.toContain('服务响应较慢');
    await act(() => vi.advanceTimersByTimeAsync(100));
    expect(container.querySelector('.gpt-recharge-verify')?.textContent).toContain('服务响应较慢');
    expect(container.querySelector('#gpt-code')).not.toBeNull();
    expect(container.querySelector('.page-readiness-overlay')).toBeNull();
    act(() =>
        [...container.querySelectorAll('button')]
            .find(button => button.textContent === '兑换码查询')
            ?.click(),
    );
    expect(container.querySelector('#gpt-query')).not.toBeNull();
    expect(container.querySelector('.page-readiness-overlay')).toBeNull();
    expect(verify).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
});

it('shows offline recovery instead of an indefinite availability wait', async () => {
    onlineManager.setOnline(false);
    await render();
    expect(container.textContent).toContain('网络连接不可用');
    expect(container.textContent).toContain('重新检查服务状态');
    expect(container.querySelector('#gpt-code')).toBeNull();
    expect(config).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
});

it('reuses a fresh scoped service configuration after leaving and returning', async () => {
    config.mockResolvedValue({ enabled: true, maintenance: false });
    await render();
    await render(false);
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(cache.getQueryData(key())).toEqual({ enabled: true, maintenance: false });
    await render();
    expect(config).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain('正在确认充值服务状态');
});

it('retains content while expired configuration refreshes and accepts maintenance changes', async () => {
    config.mockResolvedValueOnce({ enabled: true, maintenance: false });
    await render();
    await render(false);
    cache.setQueryData(key(), { enabled: true, maintenance: false }, { updatedAt: Date.now() - 31_000 });
    let finish!: (value: { enabled: boolean; maintenance: boolean }) => void;
    config.mockImplementationOnce(
        () =>
            new Promise(resolve => {
                finish = resolve;
            }),
    );
    await render();
    expect(config).toHaveBeenCalledTimes(2);
    expect(container.textContent).not.toContain('正在确认充值服务状态');
    expect(container.querySelector('#gpt-code')).not.toBeNull();
    await act(async () => {
        finish({ enabled: true, maintenance: true });
        await new Promise(resolve => setTimeout(resolve, 10));
    });
    expect(cache.getQueryData(key())).toEqual({ enabled: true, maintenance: true });
    expect(container.textContent).toContain('充值服务维护中');
    expect(container.querySelector('#gpt-code')).toBeNull();
});

it.each([
    [{ enabled: true, maintenance: true }, '充值服务维护中'],
    [{ enabled: false, maintenance: false }, '充值服务暂未开放'],
])('offers existing-task lookup when the service reports %j', async (availability, title) => {
    cache.setQueryData(key(), availability);
    await render();
    expect(container.textContent).toContain(title);
    expect(container.querySelector('#gpt-code')).toBeNull();
    expect(container.querySelector('#gpt-session')).toBeNull();
    const lookup = container.querySelector<HTMLButtonElement>(
        '.gpt-recharge-service-actions .primary-action',
    );
    expect(lookup?.textContent).toBe('查询已有任务');
    act(() => lookup?.click());
    expect(container.querySelector('#gpt-query')).not.toBeNull();
    expect(verify).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    expect(lookupCode).not.toHaveBeenCalled();
});

it('isolates markets and languages without persisting configuration or invoking business operations', async () => {
    config.mockResolvedValue({ enabled: true, maintenance: false });
    await render();
    await render(false);
    await render(true, 'other:CNY');
    await render(false);
    await render(true, 'other:CNY', 'en');
    expect(config).toHaveBeenCalledTimes(3);
    const setItem = vi.fn();
    persistPublicQueryCache(cache, { setItem, removeItem: vi.fn() });
    expect(setItem).not.toHaveBeenCalled();
    expect(verify).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    expect(task).not.toHaveBeenCalled();
});

it('keeps first-load failure retryable and discards the separate task query on exit', async () => {
    let fail!: (error: Error) => void;
    config.mockImplementationOnce(() => new Promise((_, reject) => (fail = reject)));
    await render();
    expect(container.textContent).not.toContain('正在确认充值服务状态');
    expect(container.querySelector('#gpt-code')).not.toBeNull();
    await act(async () => {
        fail(new Error('Synthetic configuration outage'));
        await new Promise(resolve => setTimeout(resolve, 10));
    });
    expect(container.textContent).toContain('暂时无法确认充值服务状态');
    const retry = [...container.querySelectorAll('button')].find(button =>
        button.textContent?.includes('重新检查服务状态'),
    );
    expect(retry).toBeDefined();
    config.mockResolvedValueOnce({ enabled: true, maintenance: false });
    await act(async () => {
        retry?.click();
        await new Promise(resolve => setTimeout(resolve, 10));
    });
    expect(config).toHaveBeenCalledTimes(2);
    expect(container.textContent).not.toContain('暂时无法确认充值服务状态');
    expect(container.querySelector('#gpt-code')).not.toBeNull();
    const tasks = cache
        .getQueryCache()
        .findAll()
        .filter(query => query.queryKey.includes('gpt-recharge') && query.queryKey.at(-1) !== 'config');
    expect(tasks).toHaveLength(1);
    expect(tasks[0].gcTime).toBe(0);
    await render(false);
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(cache.getQueryCache().find({ queryKey: tasks[0].queryKey })).toBeUndefined();
});

it('tracks a looked-up task without retaining its credential or replacing it with an older poll', async () => {
    config.mockResolvedValue({ enabled: true, maintenance: false });
    const snapshot = {
        id: 'synthetic-reference',
        credential: 'synthetic-proof',
        plan: 'plus' as const,
        status: 'running' as const,
        stage: 'payment_details' as const,
        updatedAt: '2026-11-13T10:02:00Z',
    };
    lookupCode.mockResolvedValue({ plan: 'plus', status: 'reserved', task: snapshot });
    task.mockResolvedValue({ ...snapshot, stage: 'started', updatedAt: '2026-11-13T10:01:00Z' });
    await render();
    act(() =>
        [...container.querySelectorAll('button')]
            .find(button => button.textContent === '兑换码查询')
            ?.click(),
    );
    const input = container.querySelector<HTMLInputElement>('#gpt-query');
    if (!input) throw new Error('Expected the code lookup field');
    act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
            input,
            'synthetic-code',
        );
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => {
        input.closest('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 20));
    });
    expect(container.textContent).toContain('正在填写充值资料');
    const tracked = cache
        .getQueryCache()
        .getAll()
        .find(query => query.queryKey.at(-1) === snapshot.id);
    expect(tracked?.gcTime).toBe(0);
    act(() =>
        [...container.querySelectorAll('button')].find(button => button.textContent === '刷新进度')?.click(),
    );
    await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 20));
    });
    expect(task).toHaveBeenCalledWith(snapshot.id, snapshot.credential, expect.any(AbortSignal));
    expect(container.textContent).toContain('正在填写充值资料');
    expect(container.textContent).not.toContain('已开始执行');
    expect(submit).not.toHaveBeenCalled();
    const setItem = vi.fn();
    persistPublicQueryCache(cache, { setItem, removeItem: vi.fn() });
    expect(setItem).not.toHaveBeenCalled();
    await render(false);
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(
        cache
            .getQueryCache()
            .getAll()
            .some(query => query.queryKey.at(-1) === snapshot.id),
    ).toBe(false);
});
