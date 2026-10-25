// @vitest-environment jsdom
import { QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterAll, afterEach, expect, it, vi } from 'vitest';

import {
    createStorefrontQueryClient,
    persistPublicQueryCache,
    storefrontQueryKeys,
} from '../../query-client';

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
const client: GptRechargeClient = {
    config,
    verify,
    submit,
    query: vi.fn(),
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
                    <GptRechargePage
                        client={client}
                        marketKey={market}
                        language={language}
                        onBack={() => undefined}
                    />
                )}
            </QueryClientProvider>,
        );
        await new Promise(resolve => setTimeout(resolve, 10));
    });
};
afterEach(async () => {
    await render(false);
    cache.clear();
    config.mockReset();
});
afterAll(() => act(() => root.unmount()));

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
    await act(async () => {
        finish({ enabled: true, maintenance: true });
        await Promise.resolve();
    });
    expect(cache.getQueryData(key())).toEqual({ enabled: true, maintenance: true });
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
    config.mockRejectedValueOnce(new Error('Synthetic configuration outage'));
    await render();
    await render();
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
