// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    adminCapabilityForPath,
    type AdminCapabilitySnapshot,
} from '../../../../common/src/admin-capabilities';
import { FeatureHelpProvider } from '../../components/FeatureHelp';
import { AdminCapabilitiesContext } from '../../hooks/use-admin-capabilities';
import { AdminPermissionsContext } from '../../hooks/use-admin-permissions';
import { AfterSalesModule } from './AfterSalesModule';

const mocks = vi.hoisted(() => ({ query: vi.fn(), mutate: vi.fn(), refetch: vi.fn() }));
vi.mock('../../hooks/use-admin-query', () => ({ useAdminQuery: mocks.query }));
vi.mock('@apollo/client/react', () => ({ useMutation: () => [mocks.mutate, { loading: false }] }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const request = {
    id: 'request-1',
    code: 'AFTER-SALES-FIXTURE',
    createdAt: '2026-10-08T00:00:00Z',
    updatedAt: '2026-10-08T00:00:00Z',
    type: 'REFUND_ONLY',
    state: 'PENDING',
    reason: 'OTHER',
    description: 'fixture request',
    currencyCode: 'MYR',
    requestedAmount: 0,
    approvedAmount: 0,
    resolution: 'fixture resolution',
    returnStatus: 'NOT_REQUIRED',
    returnInstructions: 'fixture return address',
    replacementStatus: 'NOT_REQUIRED',
    overdue: false,
    customerName: 'Fixture buyer',
    customerEmail: 'fixture@example.invalid',
    events: [],
    order: {
        id: 'order-1',
        code: 'ORDER-FIXTURE',
        state: 'PaymentSettled',
        totalWithTax: 1000,
        currencyCode: 'MYR',
        payments: [],
    },
    items: [
        {
            id: 'item-1',
            orderLineId: 'line-1',
            quantity: 1,
            unitPriceWithTax: 1000,
            lineAmountWithTax: 1000,
            productName: 'Fixture item',
            sku: 'SKU-1',
            fulfillmentType: 'physical',
            acceptedReturnQuantity: 0,
            rejectedReturnQuantity: 0,
        },
    ],
};
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
    sessionStorage.clear();
    mocks.mutate.mockReset();
    mocks.refetch.mockReset().mockResolvedValue(undefined);
    mocks.query.mockReset();
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
});
afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
});
async function renderPage(
    record = request,
    writable = true,
    receipts = [{ id: 'receipt-1', orderLineId: 'line-1', quantity: 1, quality: 'GOOD', state: 'RECEIVED' }],
    snapshot: AdminCapabilitySnapshot | null = null,
) {
    mocks.query.mockReturnValue({
        data: {
            afterSalesRequests: { items: [record], totalItems: 1 },
            stockLocations: { items: [{ id: 'warehouse-1', name: 'Fixture warehouse' }] },
            physicalReturnReceipts: receipts,
        },
        loading: false,
        refetch: mocks.refetch,
    });
    await act(async () =>
        root.render(
            <MemoryRouter initialEntries={['/sales/after-sales']}>
                <AdminPermissionsContext.Provider
                    value={{
                        permissions: [],
                        hasAnyPermission: required =>
                            writable || required.every(item => item.startsWith('Read')),
                    }}
                >
                    <AdminCapabilitiesContext.Provider value={snapshot}>
                        <FeatureHelpProvider>
                            <AfterSalesModule />
                        </FeatureHelpProvider>
                    </AdminCapabilitiesContext.Provider>
                </AdminPermissionsContext.Provider>
            </MemoryRouter>,
        ),
    );
    await act(async () => button(record.code).click());
}
function button(label: string) {
    const found = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
        item => item.textContent?.trim() === label,
    );
    expect(found, label).toBeDefined();
    return found!;
}
async function fill(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
    await act(async () => {
        const prototype =
            element instanceof HTMLTextAreaElement
                ? HTMLTextAreaElement.prototype
                : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value);
        element.dispatchEvent(new Event('input', { bubbles: true }));
    });
}

describe('after-sales accepted writes and permissions', () => {
    it('keeps an accepted approval separate from a failed read and retries only the list read', async () => {
        const updated = { ...request, state: 'APPROVED' };
        mocks.mutate.mockResolvedValue({ data: { transitionAfterSalesRequest: updated } });
        mocks.refetch.mockRejectedValueOnce(new Error('fixture read failure'));
        await renderPage();
        await act(async () => button('审核通过').click());
        expect(host.textContent).toContain('售后申请已审核通过');
        expect(host.textContent).toContain('操作已完成，但最新数据读取失败');
        expect(host.textContent).not.toContain('售后状态更新失败');
        const complete = [...host.querySelectorAll<HTMLButtonElement>('button')].find(item =>
            item.textContent?.includes('确认退款并完成'),
        );
        expect(complete?.disabled).toBe(true);
        await act(async () => button('核对最新工单').click());
        expect(mocks.refetch).toHaveBeenCalledTimes(2);
        expect(mocks.mutate).toHaveBeenCalledTimes(1);
        expect(host.textContent).not.toContain('操作已完成，但最新数据读取失败');
    });

    it.each([
        {
            type: 'RETURN_AND_REFUND',
            returnStatus: 'IN_TRANSIT',
            replacementStatus: 'NOT_REQUIRED',
            action: '确认退货已签收',
            result: 'receiveAfterSalesReturn',
            updatedStatus: 'RECEIVED',
            note: '填写仓库签收结果、包裹外观和签收人',
            success: '退货已签收，等待质检',
            failure: '退货签收失败',
        },
        {
            type: 'RETURN_AND_REFUND',
            returnStatus: 'RECEIVED',
            replacementStatus: 'NOT_REQUIRED',
            action: '提交质检并审计入库',
            result: 'inspectAfterSalesReturn',
            updatedStatus: 'INSPECTED',
            note: '填写质检结论和拒收/报损依据',
            success: '退货质检完成，合格数量已审计入库',
            failure: '退货质检入库失败',
        },
        {
            type: 'RESHIP',
            returnStatus: 'NOT_REQUIRED',
            replacementStatus: 'SHIPPED',
            action: '登记配送异常',
            result: 'updateAfterSalesReplacement',
            updatedStatus: 'NOT_REQUIRED',
            note: '填写配送进展、异常原因或送达说明',
            success: '配送异常已进入例外队列',
            failure: '换货/补发状态更新失败',
        },
    ])('preserves the accepted $result response when readback fails', async scenario => {
        const record = {
            ...request,
            state: 'APPROVED',
            type: scenario.type,
            returnStatus: scenario.returnStatus,
            replacementStatus: scenario.replacementStatus,
        };
        const updated = {
            ...record,
            returnStatus: scenario.updatedStatus,
            replacementStatus:
                scenario.result === 'updateAfterSalesReplacement' ? 'EXCEPTION' : record.replacementStatus,
        };
        mocks.mutate.mockResolvedValue({ data: { [scenario.result]: updated } });
        mocks.refetch.mockRejectedValueOnce(new Error('fixture read failure'));
        await renderPage(record);
        await fill(
            host.querySelector<HTMLTextAreaElement>(`textarea[placeholder="${scenario.note}"]`)!,
            'fixture workflow note',
        );
        await act(async () => button(scenario.action).click());
        expect(host.textContent).toContain(scenario.success);
        expect(host.textContent).toContain('操作已完成，但最新数据读取失败');
        expect(host.textContent).not.toContain(scenario.failure);
        await act(async () => button('核对最新工单').click());
        expect(mocks.mutate).toHaveBeenCalledTimes(1);
    });

    it.each(['PENDING', 'APPROVED'])(
        'offers no approval or completion writes to a read-only user in $0',
        async state => {
            await renderPage({ ...request, state }, false);
            expect(host.textContent).not.toContain('审核通过');
            expect(host.textContent).not.toContain('驳回申请');
            expect(
                [...host.querySelectorAll('button')].some(item =>
                    item.textContent?.includes('确认退款并完成'),
                ),
            ).toBe(false);
            expect(button('关闭').disabled).toBe(false);
            expect(mocks.mutate).not.toHaveBeenCalled();
        },
    );

    it('hides writes when the current store capability is read-only even if the role has UpdateOrder', async () => {
        const capability = adminCapabilityForPath('/sales/after-sales');
        if (!capability) throw new Error('Expected registered after-sales capability');
        await renderPage(request, true, [], {
            channelId: 'store-1',
            channelCode: 'store-1',
            scope: 'STORE',
            commerceMode: null,
            capabilities: [
                { id: capability.id, state: 'READY', canRead: true, canWrite: false, canConfigure: false },
            ],
        });
        expect(host.textContent).not.toContain('审核通过');
        expect(host.textContent).not.toContain('驳回申请');
        expect(mocks.mutate).not.toHaveBeenCalled();
    });
    it('keeps a legacy return receipt accepted when its reread fails, and never repeats the receive mutation', async () => {
        const record = {
            ...request,
            type: 'RETURN_AND_REFUND',
            state: 'APPROVED',
            returnStatus: 'NOT_REQUIRED',
        };
        mocks.mutate.mockResolvedValue({
            data: { receivePhysicalReturn: { id: 'receipt-1', state: 'RECEIVED' } },
        });
        mocks.refetch.mockRejectedValueOnce(new Error('fixture receipt read failure'));
        await renderPage(record, true, []);
        await act(async () => button('确认已收到并验收').click());
        expect(host.textContent).toContain('已验收并回库');
        expect(host.textContent).toContain('操作已完成，但最新数据读取失败');
        expect(button('确认已收到并验收').disabled).toBe(true);
        await act(async () => button('核对最新验收记录').click());
        expect(mocks.mutate).toHaveBeenCalledTimes(1);
        expect(mocks.refetch).toHaveBeenCalledTimes(2);
    });
    it('shows historical receipts without a second writable return entry for a unified request', async () => {
        await renderPage({
            ...request,
            type: 'RETURN_AND_REFUND',
            state: 'APPROVED',
            returnStatus: 'IN_TRANSIT',
        });
        expect(host.textContent).toContain('已验收 1 件');
        expect(host.textContent).toContain('本工单请使用下方统一签收与质检流程');
        expect(host.textContent).not.toContain('确认已收到并验收');
        expect(button('确认退货已签收').disabled).toBe(false);
    });

    it('lets a historical default-status return enter the unified workflow, then makes its old receipts read-only', async () => {
        const record = {
            ...request,
            type: 'RETURN_AND_REFUND',
            state: 'APPROVED',
            returnStatus: 'NOT_REQUIRED',
        };
        mocks.mutate.mockResolvedValue({
            data: { receiveAfterSalesReturn: { ...record, returnStatus: 'RECEIVED' } },
        });
        await renderPage(record);
        expect(host.textContent).toContain('确认已收到并验收');
        await fill(
            host.querySelector<HTMLTextAreaElement>(
                'textarea[placeholder="填写仓库签收结果、包裹外观和签收人"]',
            )!,
            '核对历史收货记录',
        );
        await act(async () => button('确认退货已签收').click());
        expect(mocks.mutate).toHaveBeenCalledTimes(1);
        expect(host.textContent).not.toContain('确认已收到并验收');
        expect(host.textContent).toContain('已验收 1 件');
        expect(button('提交质检并审计入库').disabled).toBe(false);
    });
    it('disables unified return writes and hides legacy return writes for a read-only user', async () => {
        await renderPage(
            { ...request, type: 'RETURN_AND_REFUND', state: 'APPROVED', returnStatus: 'IN_TRANSIT' },
            false,
        );
        expect(button('确认退货已签收').disabled).toBe(true);
        expect(host.textContent).not.toContain('确认已收到并验收');
        expect(mocks.mutate).not.toHaveBeenCalled();
    });
});
