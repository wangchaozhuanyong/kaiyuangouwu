// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConfirmDialogProvider } from '../../components/ConfirmDialog';
import { FeatureHelpProvider } from '../../components/FeatureHelp';
import { DataManagementModule } from './DataManagementModule';

const apolloMocks = vi.hoisted(() => ({ useQuery: vi.fn(), useMutation: vi.fn() }));
vi.mock('@apollo/client/react', () => apolloMocks);

const reactTestEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean };
let container: HTMLDivElement;
let root: Root;
let refetch: ReturnType<typeof vi.fn>;
let setLegalHold: ReturnType<typeof vi.fn>;
let retry: ReturnType<typeof vi.fn>;
let retrySubject: ReturnType<typeof vi.fn>;

const records = [
    {
        id: 'retention-1',
        createdAt: '2026-09-20T00:00:00.000Z',
        updatedAt: '2026-09-20T00:00:00.000Z',
        channelId: '2',
        resourceType: 'CUSTOMER_AVATAR',
        resourceKey: 'asset-1',
        policyCode: 'CUSTOMER_AVATAR_REPLACED_30D',
        reason: 'REPLACED',
        status: 'PENDING',
        quarantinedAt: '2026-09-20T00:00:00.000Z',
        purgeAfter: '2026-10-20T00:00:00.000Z',
        nextAttemptAt: '2026-10-20T00:00:00.000Z',
        legalHold: false,
        legalHoldReason: null,
        attemptCount: 0,
        lastAttemptAt: null,
        lastError: null,
        completedAt: null,
    },
    {
        id: 'retention-2',
        createdAt: '2026-09-10T00:00:00.000Z',
        updatedAt: '2026-09-20T00:00:00.000Z',
        channelId: '2',
        resourceType: 'CUSTOMER_AVATAR',
        resourceKey: 'asset-2',
        policyCode: 'CUSTOMER_AVATAR_REPLACED_30D',
        reason: 'REMOVED',
        status: 'BLOCKED_REFERENCE',
        quarantinedAt: '2026-08-10T00:00:00.000Z',
        purgeAfter: '2026-09-09T00:00:00.000Z',
        nextAttemptAt: '2026-09-21T00:00:00.000Z',
        legalHold: false,
        legalHoldReason: null,
        attemptCount: 2,
        lastAttemptAt: '2026-09-20T00:00:00.000Z',
        lastError: '资产仍被商品引用',
        completedAt: null,
    },
];

const subjectRequests = [
    {
        id: 'subject-1',
        createdAt: '2026-09-20T00:00:00.000Z',
        channelId: '2',
        requestType: 'ACCOUNT_CLOSURE',
        status: 'BLOCKED',
        requestedAt: '2026-09-20T00:00:00.000Z',
        dueAt: '2026-09-27T00:00:00.000Z',
        nextAttemptAt: '2026-09-28T00:00:00.000Z',
        lastAttemptAt: '2026-09-27T00:00:00.000Z',
        attemptCount: 1,
        blockersJson: '["仍有 1 个未完成订单"]',
        lastError: '仍有 1 个未完成订单',
        resultDigest: null,
        resultSummaryJson: null,
        completedAt: null,
        cancelledAt: null,
    },
];

beforeEach(() => {
    reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    refetch = vi.fn().mockResolvedValue({
        data: { dataRetentionRecords: records, dataSubjectRequests: subjectRequests },
    });
    setLegalHold = vi.fn().mockResolvedValue({ data: { setDataRetentionLegalHold: records[0] } });
    retry = vi.fn().mockResolvedValue({ data: { retryDataRetentionRecord: records[1] } });
    retrySubject = vi.fn().mockResolvedValue({ data: { retryDataSubjectRequest: subjectRequests[0] } });
    apolloMocks.useQuery.mockReturnValue({
        data: { dataRetentionRecords: records, dataSubjectRequests: subjectRequests },
        loading: false,
        refetch,
    });
    apolloMocks.useMutation.mockImplementation(document => {
        const source = document.loc?.source.body ?? '';
        if (source.includes('SetDataRetentionLegalHold')) return [setLegalHold, { loading: false }];
        if (source.includes('RetryDataRetentionRecord')) return [retry, { loading: false }];
        if (source.includes('RetryDataSubjectRequest')) return [retrySubject, { loading: false }];
        throw new Error('Unexpected mutation');
    });
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
    reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
    vi.clearAllMocks();
});

async function renderModule() {
    await act(async () => {
        root.render(
            <FeatureHelpProvider>
                <ConfirmDialogProvider>
                    <DataManagementModule />
                </ConfirmDialogProvider>
            </FeatureHelpProvider>,
        );
    });
}

function button(label: string) {
    const match = [...container.querySelectorAll('button')].find(item => item.textContent?.trim() === label);
    expect(match).toBeDefined();
    return match!;
}

describe('DataManagementModule', () => {
    it('shows the non-expiring active-avatar boundary and actionable retention states', async () => {
        await renderModule();

        expect(container.textContent).toContain('活跃用户当前头像不会因时间自动删除');
        expect(container.textContent).toContain('等待到期');
        expect(container.textContent).toContain('引用阻断');
        expect(container.textContent).toContain('资产仍被商品引用');
        expect(container.textContent).toContain('个人数据与账户注销请求');
        expect(container.textContent).toContain('仍有 1 个未完成订单');
        expect(container.querySelectorAll('button').length).toBeGreaterThan(0);
    });

    it('requires and submits an auditable reason before enabling legal hold', async () => {
        await renderModule();
        await act(async () => button('法律保留').click());
        const dialog = container.querySelector<HTMLElement>('[role="dialog"]');
        expect(dialog).not.toBeNull();
        const submit = button('启用保留');
        expect(submit.disabled).toBe(true);
        const textarea = dialog!.querySelector('textarea')!;
        await act(async () => {
            Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
                textarea,
                '退款争议处理中',
            );
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
        });
        expect(submit.disabled).toBe(false);
        await act(async () => submit.click());

        expect(setLegalHold).toHaveBeenCalledWith({
            variables: { id: 'retention-1', enabled: true, reason: '退款争议处理中' },
        });
        expect(refetch).toHaveBeenCalledOnce();
    });
});
