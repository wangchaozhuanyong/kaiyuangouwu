// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
    ImageAiUsageRecord,
    ImageAiUsageRecordDetailQueryResult,
} from '../../graphql/image-usage.graphql';
import { IMAGE_AI_USAGE_DETAIL_QUERY } from '../../graphql/image-usage.graphql';
import { AiImageUsagePanel, ImageUsageCost } from './AiImageUsagePanel';

const mocks = vi.hoisted(() => ({
    query: vi.fn(),
    refetch: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@apollo/client/react', () => ({ useQuery: (...args: unknown[]) => mocks.query(...args) }));
const cleanups: Array<() => void> = [];
afterEach(async () => {
    await act(async () => cleanups.splice(0).forEach(cleanup => cleanup()));
    mocks.query.mockReset();
    mocks.refetch.mockClear();
});
const record: ImageAiUsageRecord = {
    id: '12',
    recordType: 'PROMPT_OPTIMIZATION',
    createdAt: '2026-09-13T12:00:00Z',
    channelId: '1',
    modelCode: 'gpt',
    credentialCode: 'gpt',
    credentialName: '主用',
    credentialLast4: '',
    state: 'SUCCEEDED',
    billingMode: 'FREE',
    freeQuantity: 1,
    paidQuantity: 0,
    chargedAmount: 0,
    refundedAmount: 0,
    currencyCode: 'CNY',
    actualCostMicrounits: null,
    costCurrency: null,
    missingCost: true,
    costCompleteness: 'UNKNOWN',
    missingCostCount: 1,
    costBreakdown: [],
    customer: { id: '1', firstName: '', lastName: '', emailAddress: '' },
};

async function mount() {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    cleanups.push(() => {
        root.unmount();
        container.remove();
    });
    await act(async () => root.render(<AiImageUsagePanel />));
    return container;
}

describe('AI 图片工坊供应商费用', () => {
    it('未知金额不显示为零，不同币种的已知部分不合并', () => {
        const unknown = renderToStaticMarkup(<ImageUsageCost record={record} />);
        expect(unknown).toContain('费用待核对');
        expect(unknown).not.toContain('0.000000');
        const partial = renderToStaticMarkup(
            <ImageUsageCost
                record={{
                    ...record,
                    costCompleteness: 'PARTIAL',
                    costBreakdown: [
                        { currency: 'USD', amount: 0.1 },
                        { currency: 'EUR', amount: 0.2 },
                    ],
                }}
            />,
        );
        expect(partial).toContain('部分已知');
        expect(partial).toContain('USD 0.100000');
        expect(partial).toContain('EUR 0.200000');
        expect(partial).not.toContain('0.300000');
    });

    it('明确的零费用保留六位精度', () => {
        const html = renderToStaticMarkup(
            <ImageUsageCost
                record={{
                    ...record,
                    costCompleteness: 'COMPLETE',
                    missingCostCount: 0,
                    costBreakdown: [{ currency: 'USD', amount: 0 }],
                }}
            />,
        );
        expect(html).toContain('费用完整');
        expect(html).toContain('USD 0.000000');
    });

    it('分页后更改费用过滤条件回到首页', async () => {
        mocks.query.mockReturnValue({
            data: { imageAiUsageRecords: { totalItems: 100, items: [record] } },
            loading: false,
            refetch: mocks.refetch,
        });
        const container = await mount();
        await act(async () =>
            Array.from(container.querySelectorAll('button'))
                .find(b => b.textContent === '下一页')!
                .click(),
        );
        expect(mocks.query.mock.lastCall?.[1].variables.input.skip).toBeGreaterThan(0);
        await act(async () => container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
        expect(mocks.query.mock.lastCall?.[1].variables.input).toMatchObject({
            skip: 0,
            missingCostOnly: true,
        });
    });

    it('从列表打开对应记录的独立调用，并区分各类编号', async () => {
        const attempt: ImageAiUsageRecordDetailQueryResult['imageAiUsageRecord']['attempts'][number] = {
            callId: 'local-call-id',
            attemptNumber: 1,
            stage: 'INITIAL',
            outcome: 'SUCCEEDED',
            modelId: 'gpt',
            credentialNameSnapshot: '主用',
            createdAt: record.createdAt,
            headerRequestId: 'gateway-header-id',
            headerRequestIdSource: 'x-request-id',
            modelResponseId: 'model-response-id',
            providerRequestId: 'legacy-id',
            httpStatus: 200,
            latencyMs: 100,
            actualCostMicrounits: null,
            costCurrency: null,
            costSource: 'UNVERIFIED',
            matchingStatus: 'UNRECONCILED',
            reportedCostEvidence: null,
        };
        mocks.query.mockImplementation(query => ({
            loading: false,
            refetch: mocks.refetch,
            data:
                query === IMAGE_AI_USAGE_DETAIL_QUERY
                    ? { imageAiUsageRecord: { record, attempts: [attempt] } }
                    : { imageAiUsageRecords: { totalItems: 1, items: [record] } },
        }));
        const container = await mount();
        await act(async () =>
            Array.from(container.querySelectorAll('button'))
                .find(b => b.textContent === '查看调用明细')!
                .click(),
        );
        const call = mocks.query.mock.calls.find(args => args[0] === IMAGE_AI_USAGE_DETAIL_QUERY);
        expect(call?.[1].variables).toEqual({ recordType: 'PROMPT_OPTIMIZATION', id: '12' });
        const detail = container.querySelector('[role="dialog"]')!;
        for (const text of [
            'local-call-id',
            'gateway-header-id',
            'model-response-id',
            'legacy-id',
            '尚未核实供应商账单',
        ]) {
            expect(detail.textContent).toContain(text);
        }
        await act(async () =>
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
        );
        expect(container.querySelector('[role="dialog"]')).toBeNull();
    });

    it('旧记录没有尝试时明确提示，不表示零次调用', async () => {
        mocks.query.mockImplementation(query => ({
            loading: false,
            refetch: mocks.refetch,
            data:
                query === IMAGE_AI_USAGE_DETAIL_QUERY
                    ? { imageAiUsageRecord: { record, attempts: [] } }
                    : { imageAiUsageRecords: { totalItems: 1, items: [record] } },
        }));
        const container = await mount();
        await act(async () =>
            Array.from(container.querySelectorAll('button'))
                .find(b => b.textContent === '查看调用明细')!
                .click(),
        );
        expect(container.querySelector('[role="dialog"]')?.textContent).toContain(
            '旧记录不能据此判断调用次数或零费用',
        );
    });

    it.each(['LEGACY_PROMPT', 'PROMPT_ATTEMPT'])(
        '展示 %s 的独立审定，并保留更正链和供应商账单',
        async recordType => {
            const review = {
                id: '2',
                recordType,
                recordIdSnapshot: '12',
                batchId: 'approved-batch',
                reviewer: '审核人',
                authorizationRef: 'approval-26',
                reviewedAt: record.createdAt,
                reason: '完整账单已交叉核对',
                matchingStatus: 'CROSS_MATCH_REVIEWED',
                previousAdjustmentId: '1',
                oldCostMicrounits: null,
                oldCurrency: null,
                newCostMicrounits: 2136,
                newCurrency: 'USD',
                sourceHash: 'source-hash',
                supplierBills: [
                    {
                        supplierScope: 'supplier-account-1',
                        billId: 'client:bill-1',
                        amountMicrounits: 2136,
                        currency: 'USD',
                        billedAt: null,
                        displayedTime: '2026/09/13 20:00:00',
                        timeZone: null,
                        evidenceHash: 'bill-hash',
                    },
                ],
            };
            mocks.query.mockImplementation(query => ({
                loading: false,
                refetch: mocks.refetch,
                data:
                    query === IMAGE_AI_USAGE_DETAIL_QUERY
                        ? { imageAiUsageRecord: { record, attempts: [], costAdjustments: [review] } }
                        : { imageAiUsageRecords: { totalItems: 1, items: [record] } },
            }));
            const container = await mount();
            await act(async () =>
                Array.from(container.querySelectorAll('button'))
                    .find(button => button.textContent === '查看调用明细')!
                    .click(),
            );
            const detail = container.querySelector('[role="dialog"]')!;
            for (const text of [
                '历史费用审定',
                '交叉匹配已审',
                'client:bill-1',
                'USD 0.002136',
                'approval-26',
                '更正前审定',
                '旧记录不能据此判断',
                '时区未核实',
            ]) {
                expect(detail.textContent).toContain(text);
            }
            expect(detail.textContent).not.toContain('第 1 次');
            expect(detail.textContent).toContain(
                recordType === 'PROMPT_ATTEMPT' ? '描述优化调用 #12' : '描述优化 #12',
            );
            expect(detail.textContent).not.toContain('生图费用 #12');
        },
    );

    it('读取失败显示错误并允许刷新，不展示空白成功', async () => {
        mocks.query.mockReturnValue({
            loading: false,
            error: new Error('network failure'),
            refetch: mocks.refetch,
        });
        const container = await mount();
        expect(container.querySelector('[role="alert"]')).not.toBeNull();
        expect(container.textContent).not.toContain('当前条件下暂无使用记录');
        await act(async () =>
            Array.from(container.querySelectorAll('button'))
                .find(b => b.textContent === '刷新费用')!
                .click(),
        );
        expect(mocks.refetch).toHaveBeenCalledOnce();
    });
});
