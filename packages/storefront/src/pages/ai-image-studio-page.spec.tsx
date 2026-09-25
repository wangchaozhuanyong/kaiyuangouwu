// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/require-await -- React act callbacks and API fixtures use asynchronous contracts. */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ShopApi } from '../api';
import {
    type ActiveCustomer,
    type ImageGenerationJob,
    type ImageStudioConfig,
    type MarketConfig,
} from '../types';

import { clearStudioCache } from './ai-image-studio-cache';
import { AiImageStudioPage } from './ai-image-studio-page';

const cleanups: Array<() => void> = [];
afterEach(async () => {
    await act(async () => cleanups.splice(0).forEach(cleanup => cleanup()));
    clearStudioCache();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});
const market: MarketConfig = {
    code: 'test',
    currencyCode: 'CNY',
    locale: 'zh-CN',
    defaultLanguageCode: 'zh_Hans',
    countryCode: 'CN',
    label: 'Test',
};
const reference = {
    id: 'ref-1',
    originalName: 'coffee.png',
    mimeType: 'image/png',
    byteSize: 100,
    width: 100,
    height: 100,
    expiresAt: '2099-01-01',
    previewUrl: '/reference.png',
};
function job(index = 0): ImageGenerationJob {
    return {
        id: `job-${index}`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        state: 'SUCCEEDED',
        modelCodeSnapshot: 'test-model',
        modelNameSnapshot: '测试模型',
        officialModelIdSnapshot: 'fixture',
        originalPrompt: `商品 ${index}`,
        finalPrompt: '商品图',
        referenceMode: 'NONE',
        aspectRatio: '1:1',
        resolution: '1K',
        quantity: 1,
        unitPriceSnapshot: 100,
        reservedAmount: 0,
        expectedChargeAmount: 0,
        freeQuantityReserved: 1,
        freeQuantityCaptured: 1,
        paidQuantityReserved: 0,
        capturedAmount: 0,
        releasedAmount: 0,
        currencyCode: 'CNY',
        termsVersion: 'v1',
        promptSkillHash: 'test',
        outputs: [],
        inputSnapshotVersion: 1,
    };
}
async function setup(options: { paid?: boolean; balance?: number; history?: ImageGenerationJob[] } = {}) {
    vi.useFakeTimers();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    const bucket = {
        limit: 20,
        unlimited: false,
        reserved: 0,
        consumed: 0,
        remaining: 20,
        windowEndsAt: '2099-01-01',
    };
    const quota = {
        paidEnabled: true,
        paidPrice: 50,
        currencyCode: 'CNY',
        daily: { ...bucket, remaining: options.paid ? 0 : 20 },
        minute: bucket,
    };
    const config = {
        enabled: true,
        promptOptimizationEnabled: true,
        promptOptimizerModelIds: ['fixture'],
        defaultModelCode: 'test-model',
        termsVersion: 'v1',
        termsZh: '服务条款',
        termsEn: 'Terms',
        maxQuantity: 4,
        outputRetentionDays: 90,
        referenceRetentionHours: 24,
        models: [
            {
                id: 'model-1',
                code: 'test-model',
                displayNameZh: '测试模型',
                displayNameEn: 'Test model',
                officialModelId: 'fixture',
                resolutionOptions: [{ resolution: '1K', unitPrice: 100, supportedAspectRatios: ['1:1'] }],
                unitPrice: 100,
                currencyCode: 'CNY',
                dailyGenerationSafetyLimit: 20,
                freeImageEnabled: true,
                dailyFreeImageLimit: 20,
                paidAfterFreeEnabled: true,
            },
        ],
    } as ImageStudioConfig;
    const history = options.history ?? [];
    const api = {
        imageStudioConfig: vi.fn().mockResolvedValue(config),
        previewImageGenerationPrompt: vi.fn(
            async (input: { prompt: string; optimizedPrompt?: string | null }) => {
                const length = (input.optimizedPrompt || input.prompt).trim().length + 100;
                return { length, limit: 8000, valid: length <= 8000 };
            },
        ),
        imageStudioWallet: vi
            .fn()
            .mockResolvedValue({ availableBalance: options.balance ?? 1000, currencyCode: 'CNY' }),
        imagePromptQuotaStatus: vi.fn().mockResolvedValue(quota),
        imageModelQuotaStatus: vi.fn().mockResolvedValue([
            {
                modelCode: 'test-model',
                freeImageEnabled: true,
                paidAfterFreeEnabled: true,
                free: bucket,
                safety: bucket,
            },
        ]),
        myImageGenerationJobs: vi.fn(
            async (skip: number, take: number, _signal?: AbortSignal, states?: string[]) => {
                const filtered = history.filter(item => !states || states.includes(item.state));
                return { items: filtered.slice(skip, skip + take), totalItems: filtered.length };
            },
        ),
        myImageGenerationJob: vi.fn(async (id: string) => {
            const found = history.find(item => item.id === id);
            if (!found) throw new Error('Job unavailable');
            return found;
        }),
        optimizeImagePrompt: vi.fn().mockResolvedValue({
            originalPrompt: '商品',
            optimizedPrompt: '包装'.repeat(1100),
            source: 'MODEL',
            recommendationReason: '',
            recommendedModelCode: 'test-model',
            promptQuota: quota,
            billingMode: options.paid ? 'PAID' : 'FREE',
            chargedAmount: options.paid ? 50 : 0,
            currencyCode: 'CNY',
        }),
        createImageGeneration: vi.fn().mockResolvedValue(job(100)),
        releaseImageReference: vi.fn().mockResolvedValue(true),
        deleteMyImageGenerationJob: vi.fn(async (id: string) => {
            const index = history.findIndex(item => item.id === id);
            if (index >= 0) history.splice(index, 1);
            return true;
        }),
    };
    const onNotify = vi.fn();
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    await act(async () =>
        root.render(
            <AiImageStudioPage
                api={api as unknown as ShopApi}
                customer={{ id: 'customer-1' } as ActiveCustomer}
                market={market}
                displayCurrencyCode="CNY"
                language="zh"
                onBack={() => undefined}
                onSignIn={() => undefined}
                onNotify={onNotify}
            />,
        ),
    );
    cleanups.push(() => {
        root.unmount();
        container.remove();
    });
    return { api, container, onNotify, root };
}
function button(container: Element, text: string) {
    const value = [...container.querySelectorAll('button')].find(item => item.textContent?.includes(text));
    if (!value) throw new Error(`Missing button ${text}`);
    return value;
}
async function click(element: HTMLElement) {
    await act(async () => element.click());
    await act(async () => vi.advanceTimersByTimeAsync(180));
}
async function type(container: Element, value: string) {
    const textarea = container.querySelector('textarea');
    const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
    if (!textarea || !descriptor?.set) throw new Error('Missing editor');
    await act(async () => {
        descriptor.set?.call(textarea, value);
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => vi.advanceTimersByTimeAsync(180));
}

describe('AI studio complete customer workflows', () => {
    it('does not show the previous account balance or draft while another account loads', async () => {
        const { api, container, root } = await setup({ balance: 2500 });
        await type(container, '客户 A 的私有创作内容');
        const previousBalance = container.querySelector('.is-balance')?.textContent;
        expect(previousBalance).toBeTruthy();
        expect(container.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('客户 A 的私有创作内容');
        api.imageStudioConfig.mockImplementation(() => new Promise(() => undefined));

        await act(async () => {
            root.render(
                <AiImageStudioPage
                    api={api as unknown as ShopApi}
                    customer={{ id: 'customer-2' } as ActiveCustomer}
                    market={market}
                    displayCurrencyCode="CNY"
                    language="zh"
                    onBack={() => undefined}
                    onSignIn={() => undefined}
                    onNotify={() => undefined}
                />,
            );
        });
        expect(container.querySelector('.is-balance')).toBeNull();
        expect(container.querySelector<HTMLTextAreaElement>('textarea')?.value).not.toBe(
            '客户 A 的私有创作内容',
        );
        expect(container.textContent).not.toContain(previousBalance);

        await act(async () => {
            root.render(
                <AiImageStudioPage
                    api={api as unknown as ShopApi}
                    customer={{ id: 'customer-1' } as ActiveCustomer}
                    market={market}
                    displayCurrencyCode="CNY"
                    language="zh"
                    onBack={() => undefined}
                    onSignIn={() => undefined}
                    onNotify={() => undefined}
                />,
            );
        });
        expect(container.querySelector('.is-balance')?.textContent).toBe(previousBalance);
        expect(container.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('客户 A 的私有创作内容');
    });

    it('preserves the draft, quantity and consent while switching views and restoring scroll positions', async () => {
        const { container } = await setup({ history: [job(1)] });
        expect(container.querySelector('.ai-studio-composer label')?.classList.contains('sr-only')).toBe(
            true,
        );
        expect(container.querySelector('textarea')?.placeholder).toContain('描述你想生成的图片');
        await type(container, '保留这段商品描述');
        await click(button(container, '生成张数'));
        await click(button(document.body, '2 张'));
        const consent = container.querySelector<HTMLInputElement>('.ai-studio-terms-row input');
        if (!consent) throw new Error('Missing consent control');
        await click(consent);
        const create = container.querySelector<HTMLElement>('.ai-studio-create-panel');
        const history = container.querySelector<HTMLElement>('.ai-studio-history');
        const historyTab = container.querySelector<HTMLElement>('[aria-controls$="-HISTORY-panel"]');
        const createTab = container.querySelector<HTMLElement>('[aria-controls$="-CREATE-panel"]');
        if (!create || !history || !historyTab || !createTab) throw new Error('Missing studio views');
        const scrollTo = vi.spyOn(window, 'scrollTo');
        const scroll = vi.spyOn(window, 'scrollY', 'get');
        scroll.mockReturnValue(300);
        await click(historyTab);
        expect(create.hidden).toBe(true);
        expect(history.hidden).toBe(false);
        expect(historyTab.getAttribute('aria-selected')).toBe('true');
        expect(scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: 'instant' });
        scroll.mockReturnValue(500);
        await click(createTab);
        expect(create.hidden).toBe(false);
        expect(history.hidden).toBe(true);
        expect(container.querySelector('textarea')?.value).toBe('保留这段商品描述');
        expect(button(container, '生成张数').textContent).toContain('2 张');
        expect(consent.checked).toBe(false);
        expect(scrollTo).toHaveBeenLastCalledWith({ top: 300, behavior: 'instant' });
        await click(historyTab);
        expect(scrollTo).toHaveBeenLastCalledWith({ top: 500, behavior: 'instant' });
    });

    it('shows history after submission and returns to the populated editor when using a previous generation', async () => {
        const { api, container } = await setup({ history: [job(1)] });
        await type(container, '新的商品描述');
        await click(button(container, '开始生成'));
        expect(api.createImageGeneration).toHaveBeenCalledTimes(1);
        expect(container.querySelector<HTMLElement>('.ai-studio-create-panel')?.hidden).toBe(true);
        expect(container.querySelector<HTMLElement>('.ai-studio-history')?.hidden).toBe(false);
        const record = [...container.querySelectorAll('article')].find(
            item => item.querySelector('p')?.textContent === '商品 1',
        );
        if (!record) throw new Error('Missing previous generation');
        await click(button(record, '再次创作'));
        expect(container.querySelector<HTMLElement>('.ai-studio-create-panel')?.hidden).toBe(false);
        expect(container.querySelector<HTMLElement>('.ai-studio-history')?.hidden).toBe(true);
        expect(container.querySelector('textarea')?.value).toBe('商品 1');
        expect(api.createImageGeneration).toHaveBeenCalledTimes(1);
    });

    it('releases replaced draft references before restoring another job and preserves failed releases for retry', async () => {
        const history = [
            {
                ...job(1),
                referenceMode: 'PRODUCT' as const,
                referenceAssetIds: ['ref-1'],
                referenceAssets: [reference],
            },
            {
                ...job(2),
                referenceMode: 'PRODUCT' as const,
                referenceAssetIds: ['ref-2'],
                referenceAssets: [{ ...reference, id: 'ref-2' }],
            },
        ];
        const { api, container } = await setup({ history });
        await click(button(container, '再次创作'));
        const replaySecond = () =>
            [...container.querySelectorAll('button')].filter(item =>
                item.textContent?.includes('再次创作'),
            )[1];
        api.releaseImageReference.mockRejectedValueOnce(new Error('network'));
        await click(replaySecond());
        expect(container.textContent).toContain('部分旧参考图释放失败');
        expect(container.querySelector('textarea')?.value).toBe('商品 1');
        await click(replaySecond());
        expect(api.releaseImageReference).toHaveBeenCalledWith('ref-1');
        await click(button(container, '开始生成'));
        expect(api.createImageGeneration).toHaveBeenCalledWith(
            expect.objectContaining({ referenceAssetIds: ['ref-2'] }),
        );
    });
    it('keeps newer edits and reports charges when an optimizer reply arrives late', async () => {
        const { api, container, onNotify } = await setup({ paid: true });
        const result = await api.optimizeImagePrompt();
        let finish: (value: unknown) => void = () => undefined;
        api.optimizeImagePrompt.mockImplementationOnce(
            () =>
                new Promise(resolve => {
                    finish = resolve;
                }),
        );
        await type(container, '原始袋装咖啡');
        await click(button(container, '付费优化'));
        await type(container, '我后来修改的商品需求');
        await act(async () => finish(result));
        expect(container.querySelector('textarea')?.value).toBe('我后来修改的商品需求');
        expect(onNotify).toHaveBeenCalledWith(expect.stringContaining('保留你后续编辑的内容'));
        expect(onNotify).toHaveBeenCalledWith(expect.stringContaining('本次费用'));
    });

    it('blocks generation using the server final length including reference requirements', async () => {
        const { api, container } = await setup({
            history: [{ ...job(), optimizedPrompt: '包装'.repeat(3900) }],
        });
        api.previewImageGenerationPrompt.mockResolvedValueOnce({ length: 8120, limit: 8000, valid: false });
        await click(button(container, '再次创作'));
        expect(container.textContent).toContain('8120/8000');
        expect(container.textContent).toContain('请缩短后再生成');
        expect(button(container, '开始生成').disabled).toBe(true);
        expect(api.createImageGeneration).not.toHaveBeenCalled();
        api.previewImageGenerationPrompt.mockResolvedValueOnce({ length: 8000, limit: 8000, valid: true });
        await type(container, '包装'.repeat(3800));
        expect(button(container, '开始生成').disabled).toBe(false);
    });
    it('ignores a late budget reply for older text and allows retry after a check failure', async () => {
        const { api, container } = await setup();
        let finish: (value: { length: number; limit: number; valid: boolean }) => void = () => undefined;
        api.previewImageGenerationPrompt.mockImplementationOnce(
            () =>
                new Promise(resolve => {
                    finish = resolve;
                }),
        );
        await type(container, '旧描述');
        expect(button(container, '开始生成').disabled).toBe(true);
        await type(container, '新描述');
        await act(async () => finish({ length: 9000, limit: 8000, valid: false }));
        expect(button(container, '开始生成').disabled).toBe(false);
        expect(container.textContent).not.toContain('9000/8000');
        api.previewImageGenerationPrompt.mockRejectedValueOnce(new Error('offline'));
        await type(container, '断网后的描述');
        expect(button(container, '开始生成').disabled).toBe(true);
        await click(button(container, '重试字数检查'));
        expect(button(container, '开始生成').disabled).toBe(false);
    });
    it.each([
        ['REFUNDED', '预冻结金额已退回'],
        ['RELEASED', '免费额度已释放'],
    ])('explains the released charge after fallback %s', async (billingMode, expected) => {
        const { api, container, onNotify } = await setup({ paid: billingMode === 'REFUNDED' });
        const result = await api.optimizeImagePrompt();
        api.optimizeImagePrompt.mockResolvedValue({
            ...result,
            source: 'FALLBACK',
            billingMode,
            chargedAmount: 0,
        });
        await type(container, '袋装咖啡');
        await click(button(container, '优化'));
        expect(onNotify).toHaveBeenCalledWith(expect.stringContaining(expected));
        expect(onNotify).toHaveBeenCalledWith(expect.stringContaining('本次未扣费'));
    });

    it('requires a new size when replaying a retired resolution', async () => {
        const { api, container } = await setup({ history: [{ ...job(), resolution: '4K' }] });
        await click(button(container, '再次创作'));
        expect(container.textContent).toContain('原尺寸不可用');
        expect(button(container, '开始生成').disabled).toBe(true);
        expect(api.createImageGeneration).not.toHaveBeenCalled();
    });
    it('does not turn a stale free click into a paid request', async () => {
        const { api, container } = await setup();
        await type(container, '袋装咖啡');
        api.optimizeImagePrompt.mockRejectedValueOnce(new Error('PRICE_CHANGED：免费额度已用完'));
        const currentQuota = await api.imagePromptQuotaStatus();
        api.imagePromptQuotaStatus.mockResolvedValue({
            ...currentQuota,
            daily: { ...currentQuota.daily, remaining: 0 },
        });
        await click(button(container, '免费优化'));
        const sent = api.optimizeImagePrompt.mock.calls[0][2];
        expect(sent.expectedPrice).toBeNull();
        expect(api.optimizeImagePrompt).toHaveBeenCalledTimes(1);
        expect(button(container, '付费优化').textContent).toContain('0.5');
    });
    it('explains why paid optimization is unavailable when free image generation is still available', async () => {
        const { api, container } = await setup({ paid: true, balance: 20 });
        await type(container, '袋装咖啡');
        expect(button(container, '付费优化').disabled).toBe(true);
        expect(container.textContent).toContain('余额不足，无法付费优化');
        expect(api.optimizeImagePrompt).not.toHaveBeenCalled();
    });

    it('refreshes the wallet after an optimization rejection and disables unaffordable retries', async () => {
        const { api, container } = await setup({ paid: true });
        await type(container, '袋装咖啡');
        api.optimizeImagePrompt.mockRejectedValueOnce(new Error('返利可用余额不足'));
        api.imageStudioWallet.mockClear().mockResolvedValue({ availableBalance: 0, currencyCode: 'CNY' });
        await click(button(container, '付费优化'));
        expect(api.imageStudioWallet).toHaveBeenCalledTimes(1);
        expect(button(container, '付费优化').disabled).toBe(true);
        expect(container.textContent).toContain('余额不足，无法付费优化');
        expect(api.optimizeImagePrompt).toHaveBeenCalledTimes(1);
    });

    it('keeps confirmed free optimization available when only the wallet refresh fails', async () => {
        const { api, container } = await setup();
        await type(container, '袋装咖啡');
        api.optimizeImagePrompt.mockRejectedValueOnce(new Error('模型暂不可用'));
        api.imageStudioWallet.mockRejectedValueOnce(new Error('wallet read unavailable'));
        await click(button(container, '免费优化'));
        expect(button(container, '免费优化').disabled).toBe(false);
        expect(api.optimizeImagePrompt).toHaveBeenCalledTimes(1);
        expect(api.optimizeImagePrompt.mock.calls[0][2]?.expectedPrice).toBeNull();
    });

    it.each(['quote', 'wallet'] as const)(
        'requires a fresh quote and wallet after the %s refresh fails without retrying the charge',
        async failedRead => {
            const { api, container } = await setup({ paid: true });
            await type(container, '袋装咖啡');
            const quota = { ...(await api.imagePromptQuotaStatus()), paidPrice: 100 };
            api.imagePromptQuotaStatus.mockResolvedValue(quota);
            api.optimizeImagePrompt.mockRejectedValueOnce(new Error('PRICE_CHANGED：提示词优化价格已更新'));
            (failedRead === 'quote'
                ? api.imagePromptQuotaStatus
                : api.imageStudioWallet
            ).mockRejectedValueOnce(new Error('read temporarily unavailable'));
            await click(button(container, '付费优化'));
            expect(button(container, '费用待更新').disabled).toBe(true);
            expect(api.optimizeImagePrompt).toHaveBeenCalledTimes(1);
            await click(button(container, '刷新'));
            expect(button(container, '付费优化').disabled).toBe(false);
            expect(button(container, '付费优化').textContent).toContain('¥1/次');
            expect(container.querySelector('textarea')?.value).toBe('袋装咖啡');
            expect(api.optimizeImagePrompt).toHaveBeenCalledTimes(1);
            await click(button(container, '付费优化'));
            expect(api.optimizeImagePrompt.mock.calls[1][2]).toMatchObject({
                expectedPrice: 100,
                currencyCode: 'CNY',
            });
        },
    );

    it('refreshes the signed URL and retries exactly once when downloading an expired link', async () => {
        const item = {
            ...job(),
            outputs: [
                {
                    id: 'output-1',
                    outputIndex: 0,
                    state: 'SUCCEEDED',
                    attemptCount: 1,
                    billingMode: 'FREE',
                    chargeAmount: 0,
                    imageUrl: '/old.png',
                    downloadUrl: '/old.png',
                },
            ],
        } as ImageGenerationJob;
        const { api, container, onNotify } = await setup({ history: [item] });
        const view = container.querySelector<HTMLButtonElement>('button[aria-label="查看生成详情"]');
        if (!view) throw new Error('Missing detail button');
        await click(view);
        const baseline = api.myImageGenerationJob.mock.calls.length;
        api.myImageGenerationJob.mockResolvedValueOnce({
            ...item,
            outputs: [{ ...item.outputs[0], downloadUrl: '/expired.png' }],
        });
        api.myImageGenerationJob.mockResolvedValueOnce({
            ...item,
            outputs: [{ ...item.outputs[0], downloadUrl: '/fresh.png' }],
        });
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce({ ok: false, status: 403 })
            .mockResolvedValueOnce({
                ok: true,
                blob: async () => new Blob(['image'], { type: 'image/png' }),
            });
        vi.stubGlobal('fetch', fetchMock);
        vi.stubGlobal(
            'URL',
            Object.assign(class extends URL {}, {
                createObjectURL: () => 'blob:download',
                revokeObjectURL: () => undefined,
            }),
        );
        vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
        await click(button(document.body, '下载'));
        expect(api.myImageGenerationJob).toHaveBeenCalledTimes(baseline + 2);
        expect(fetchMock.mock.calls.map(call => call[0])).toEqual(['/expired.png', '/fresh.png']);
        expect(onNotify).toHaveBeenCalledWith('图片已保存');
    });

    it('shows the paid price before sending a quote and refreshes the wallet afterward', async () => {
        const { api, container, onNotify } = await setup({ paid: true });
        await type(container, '袋装咖啡');
        expect(button(container, '付费优化').textContent).toContain('0.5');
        expect(api.optimizeImagePrompt).not.toHaveBeenCalled();
        await click(button(container, '付费优化'));
        expect(api.optimizeImagePrompt).toHaveBeenCalledWith(
            '袋装咖啡',
            'NONE',
            expect.objectContaining({ expectedPrice: 50, currencyCode: 'CNY' }),
        );
        expect(api.imageStudioWallet).toHaveBeenCalledTimes(2);
        expect(onNotify).toHaveBeenCalledWith(expect.stringContaining('本次费用'));
    });
    it('keeps edited long optimization in the optimized field for generation and reoptimization', async () => {
        const { api, container } = await setup();
        await type(container, '袋装咖啡');
        await click(button(container, '免费优化'));
        const edited = '包装'.repeat(1100) + '白底';
        await type(container, edited);
        await click(button(container, '开始生成'));
        expect(api.createImageGeneration).toHaveBeenCalledWith(
            expect.objectContaining({ prompt: '袋装咖啡', optimizedPrompt: edited }),
        );
        await click(button(container, '免费优化'));
        expect(api.optimizeImagePrompt).toHaveBeenLastCalledWith(
            '袋装咖啡',
            'NONE',
            expect.objectContaining({ optimizedPrompt: edited }),
        );
    });
    it('loads older history and filters the entire history through the API', async () => {
        const history = Array.from({ length: 45 }, (_, i) => job(i));
        history[44].state = 'FAILED';
        const { api, container } = await setup({ history });
        await click(button(container, '加载更多'));
        await click(button(container, '加载更多'));
        expect(container.textContent).toContain('商品 44');
        await click(button(container, '失败'));
        expect(api.myImageGenerationJobs).toHaveBeenLastCalledWith(0, 20, undefined, ['FAILED', 'CANCELLED']);
        expect(container.textContent).toContain('商品 44');
        expect(container.textContent).not.toContain('商品 43');
    });
    it.each([1, 2, 3])(
        'restores all %s ordered references and edited prompt when replaying history',
        async count => {
            const item = {
                ...job(),
                referenceMode: 'PRODUCT' as const,
                referenceAssetIds: Array.from({ length: count }, (_, index) => `ref-${index + 1}`),
                referenceAssets: Array.from({ length: count }, (_, index) => ({
                    ...reference,
                    id: `ref-${index + 1}`,
                })),
                referenceInstruction: '保留包装',
                optimizedPrompt: '袋装咖啡白底商品图',
            };
            const { api, container } = await setup({ history: [item] });
            await click(button(container, '再次创作'));
            await click(button(container, '开始生成'));
            expect(api.createImageGeneration).toHaveBeenCalledWith(
                expect.objectContaining({
                    prompt: item.originalPrompt,
                    optimizedPrompt: item.optimizedPrompt,
                    referenceAssetIds: item.referenceAssetIds,
                    referenceMode: 'PRODUCT',
                    referenceInstruction: '保留包装',
                }),
            );
        },
    );
    it.each([21, 41])('downloads and deletes the older history item %s', async index => {
        const history = Array.from({ length: 45 }, (_, i) => job(i + 1));
        history[index - 1].outputs = [
            {
                id: `output-${index}`,
                outputIndex: 0,
                state: 'SUCCEEDED',
                attemptCount: 1,
                billingMode: 'FREE',
                chargeAmount: 0,
                imageUrl: '/image.png',
                downloadUrl: '/download.png',
            },
        ];
        const { api, container, onNotify } = await setup({ history });
        await click(button(container, '加载更多'));
        if (index > 40) await click(button(container, '加载更多'));
        const article = [...container.querySelectorAll('article')].find(
            item => item.querySelector('p')?.textContent === `商品 ${index}`,
        );
        if (!article) throw new Error('Missing older history card');
        const view = article.querySelector<HTMLButtonElement>('button[aria-label="查看生成详情"]');
        if (!view) throw new Error('Missing older detail');
        await click(view);
        const fetchMock = vi
            .fn()
            .mockResolvedValue({ ok: true, blob: async () => new Blob(['png'], { type: 'image/png' }) });
        vi.stubGlobal('fetch', fetchMock);
        vi.stubGlobal(
            'URL',
            Object.assign(class extends URL {}, {
                createObjectURL: () => 'blob:download',
                revokeObjectURL: () => undefined,
            }),
        );
        vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
        await click(button(document.body, '下载'));
        expect(api.myImageGenerationJob).toHaveBeenLastCalledWith(`job-${index}`);
        expect(fetchMock).toHaveBeenCalledWith('/download.png', expect.anything());
        expect(onNotify).toHaveBeenCalledWith('图片已保存');
        const dialogClose = document.querySelector<HTMLButtonElement>(
            '[role="dialog"] button[aria-label="关闭"]',
        );
        if (!dialogClose) throw new Error('Missing close');
        await click(dialogClose);
        const remove = article.querySelector<HTMLButtonElement>('button[aria-label="删除记录"]');
        if (!remove) throw new Error('Missing delete');
        await click(remove);
        await click(button(document.body, '确认删除'));
        expect(api.deleteMyImageGenerationJob).toHaveBeenCalledWith(`job-${index}`);
        expect(container.querySelectorAll('article')).toHaveLength(index > 40 ? 44 : 40);
    });

    it('warns about legacy replay and blocks an unavailable model', async () => {
        const item = {
            ...job(),
            inputSnapshotVersion: null,
            modelCodeSnapshot: 'retired-model',
            finalPrompt: 'Compiled legacy text must not be submitted as the original request',
        };
        const { api, container, onNotify } = await setup({ history: [item] });
        await click(button(container, '再次创作'));
        expect(container.querySelector('textarea')?.value).toBe(item.originalPrompt);
        expect(container.textContent).toContain('原模型不可用');
        expect(button(container, '开始生成').disabled).toBe(true);
        expect(onNotify).toHaveBeenCalledWith(expect.stringContaining('旧记录'));
        expect(api.createImageGeneration).not.toHaveBeenCalled();
    });

    it('keeps history complete across deletion, insertion and older-page replay', async () => {
        const history = Array.from({ length: 45 }, (_, index) => job(index + 1));
        const { api, container } = await setup({ history });
        const card = (prompt: string) => {
            const found = [...container.querySelectorAll('article')].find(
                item => item.querySelector('p')?.textContent === prompt,
            );
            if (!found) throw new Error(`Missing history card ${prompt}`);
            return found;
        };
        await click(button(container, '加载更多'));
        await click(button(card('商品 21'), '再次创作'));
        expect(container.querySelector('textarea')?.value).toBe('商品 21');
        const deleteButton =
            card('商品 21').querySelector<HTMLButtonElement>('button[aria-label="删除记录"]');
        if (!deleteButton) throw new Error('Missing delete');
        await click(deleteButton);
        await click(button(document.body, '确认删除'));
        expect(api.deleteMyImageGenerationJob).toHaveBeenCalledWith('job-21');
        api.createImageGeneration.mockImplementationOnce(async () => {
            const created = job(100);
            history.unshift(created);
            return created;
        });
        await type(container, '新生成');
        await click(button(container, '开始生成'));
        await click(button(container, '加载更多'));
        await click(button(card('商品 41'), '再次创作'));
        expect(container.querySelector('textarea')?.value).toBe('商品 41');
        const shown = [...container.querySelectorAll('article .ai-generation-card-content > p')].map(
            item => item.textContent,
        );
        expect(shown).toEqual(history.map(item => item.originalPrompt));
        expect(new Set(shown).size).toBe(45);
    });

    it('blocks replay when a reference is missing instead of renumbering the remaining image', async () => {
        const item = {
            ...job(),
            referenceMode: 'PRODUCT' as const,
            referenceAssetIds: ['missing', 'ref-1'],
            referenceAssets: [null, reference],
        };
        const { api, container } = await setup({ history: [item] });
        await click(button(container, '再次创作'));
        expect(button(container, '开始生成').disabled).toBe(true);
        expect(container.querySelector('input[aria-label="替换图1"]')).not.toBeNull();
        expect(api.createImageGeneration).not.toHaveBeenCalled();
    });
    it('releases an unused reference when removing it from the editor', async () => {
        const item = {
            ...job(),
            referenceMode: 'PRODUCT' as const,
            referenceAssetIds: ['ref-1'],
            referenceAssets: [reference],
        };
        const { api, container } = await setup({ history: [item] });
        await click(button(container, '再次创作'));
        const remove = container.querySelector<HTMLButtonElement>('button[aria-label*="移除"]');
        if (!remove) throw new Error('Missing remove reference button');
        await click(remove);
        expect(api.releaseImageReference).toHaveBeenCalledWith('ref-1');
    });
    it('renders instantly from session cache without showing loading skeleton on subsequent visits', async () => {
        const { container } = await setup({ balance: 2500 });
        expect(container.textContent).toContain('fixture');
        expect(container.querySelector('.skeleton-route-header')).toBeNull();

        // Type a prompt
        await type(container, '国潮风古风茶饮海报');

        // Unmount component (simulating navigation away)
        const currentContainer = container;
        cleanups.splice(0).forEach(cleanup => cleanup());
        currentContainer.remove();

        // Mount again (simulating navigation back into studio)
        const nextContainer = document.createElement('div');
        document.body.append(nextContainer);
        const root = createRoot(nextContainer);
        cleanups.push(() => {
            root.unmount();
            nextContainer.remove();
        });

        await act(async () =>
            root.render(
                <AiImageStudioPage
                    api={
                        {
                            imageStudioConfig: vi.fn().mockReturnValue(new Promise(() => undefined)),
                            imageStudioWallet: vi.fn().mockReturnValue(new Promise(() => undefined)),
                            imagePromptQuotaStatus: vi.fn().mockReturnValue(new Promise(() => undefined)),
                            imageModelQuotaStatus: vi.fn().mockReturnValue(new Promise(() => undefined)),
                            myImageGenerationJobs: vi.fn().mockReturnValue(new Promise(() => undefined)),
                            previewImageGenerationPrompt: vi
                                .fn()
                                .mockResolvedValue({ length: 10, limit: 8000, valid: true }),
                        } as unknown as ShopApi
                    }
                    customer={{ id: 'customer-1' } as ActiveCustomer}
                    market={market}
                    displayCurrencyCode="CNY"
                    language="zh"
                    onBack={() => undefined}
                    onSignIn={() => undefined}
                    onNotify={() => undefined}
                />,
            ),
        );
        await act(async () => vi.advanceTimersByTimeAsync(180));

        // Instant render: NO skeleton loader rendered, content and draft prompt immediately visible
        expect(nextContainer.querySelector('.skeleton-route-header')).toBeNull();
        expect(nextContainer.textContent).toContain('fixture');
        const nextTextarea = nextContainer.querySelector<HTMLTextAreaElement>('textarea');
        expect(nextTextarea?.value).toBe('国潮风古风茶饮海报');
    });
});
