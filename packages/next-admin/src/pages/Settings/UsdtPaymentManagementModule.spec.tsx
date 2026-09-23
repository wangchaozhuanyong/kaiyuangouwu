import type { ReactElement } from 'react';
import { renderToStaticMarkup as renderMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FeatureHelpProvider } from '../../components/FeatureHelp';

import { UsdtPaymentManagementModule } from './UsdtPaymentManagementModule';

const apolloMocks = vi.hoisted(() => ({
    useMutation: vi.fn(),
    useQuery: vi.fn(),
}));

vi.mock('@apollo/client/react', () => apolloMocks);

describe('UsdtPaymentManagementModule', () => {
    beforeEach(() => {
        apolloMocks.useMutation.mockReturnValue([vi.fn(), { loading: false }]);
        apolloMocks.useQuery.mockReturnValue({
            data: undefined,
            error: undefined,
            loading: true,
            refetch: vi.fn(),
        });
    });

    it('uses the shared full-width loading frame', () => {
        const html = renderToStaticMarkup(<UsdtPaymentManagementModule />);

        expect(html.match(/max-w-none/g)).toHaveLength(2);
        expect(html).not.toContain('max-w-[1500px]');
        expect(html).toContain('aria-label="正在读取平台支付数据"');
        expect(html).toContain('min-h-[620px]');
    });

    it('renders localized store names and order codes in separate payment columns', () => {
        apolloMocks.useQuery.mockReturnValue({
            data: {
                channels: {
                    items: [{ id: 'channel-1', code: 'my-store', displayName: '美宜佳' }],
                },
                storeUsdtWallets: [],
                storeUsdtPaymentStats: [],
                storeUsdtPaymentIntents: [],
                storeUsdtReconciliationActions: [],
                storePaymentStats: [],
                storePaymentDetails: {
                    items: [
                        {
                            id: 'payment-1',
                            channelId: 'channel-1',
                            channelCode: 'my-store',
                            orderId: 'order-1',
                            orderCode: 'ORDER-123',
                            paymentMethodCode: 'test-payment',
                            paymentState: 'Settled',
                            currencyCode: 'MYR',
                            amount: 2200,
                            refundedAmount: 0,
                            netAmount: 2200,
                            transactionId: 'transaction-1',
                            createdAt: '2026-09-20T12:25:00.000Z',
                        },
                    ],
                    totalItems: 1,
                },
                storeUsdtManualRefunds: { items: [], totalItems: 0 },
            },
            error: undefined,
            loading: false,
            refetch: vi.fn(),
        });

        const html = renderToStaticMarkup(<UsdtPaymentManagementModule />);

        expect(html).toContain('<th class="px-3 py-2.5 font-bold">网店</th>');
        expect(html).toContain('<th class="px-3 py-2.5 font-bold">订单</th>');
        expect(html).not.toContain('网店 / 订单');
        expect(html).toContain(
            '<strong>美宜佳</strong></td><td class="whitespace-nowrap px-3 py-3 text-slate-500">ORDER-123</td>',
        );
        expect(html).not.toContain('>my-store</strong>');
    });
});

function renderToStaticMarkup(element: ReactElement) {
    return renderMarkup(<FeatureHelpProvider>{element}</FeatureHelpProvider>);
}
