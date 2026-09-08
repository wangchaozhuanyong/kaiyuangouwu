import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ConfirmDialogContext } from '../../components/confirm-dialog-context';
import type { StoreManagementResult } from '../../graphql/management.graphql';
import { AdminPermissionsContext } from '../../hooks/use-admin-permissions';
import { PaymentShippingManager } from './PaymentShippingManager';

const apolloMocks = vi.hoisted(() => ({
    useLazyQuery: vi.fn(),
    useMutation: vi.fn(),
    useQuery: vi.fn(),
}));

vi.mock('@apollo/client/react', () => apolloMocks);
vi.mock('../../components/FeatureHelp', () => ({ FeatureHelpButton: () => null }));
vi.mock('./UsdtPaymentSetupPanel', () => ({
    UsdtPaymentSetupPanel: () => <div>USDT 收款设置</div>,
}));

const data = {
    activeChannel: { id: 'channel-1', defaultCurrencyCode: 'CNY' },
    paymentMethodHandlers: [],
    paymentMethods: {
        items: [
            {
                id: 'payment-1',
                code: 'test-payment',
                name: '测试支付',
                description: '用于测试付款',
                enabled: true,
                handler: { code: 'test-handler' },
            },
        ],
    },
    shippingMethods: {
        items: [
            {
                id: 'shipping-1',
                code: 'test-shipping',
                name: '测试配送',
                description: '用于测试运费',
                calculator: { code: 'test-calculator' },
                fulfillmentHandlerCode: 'test-fulfillment-handler',
            },
        ],
    },
} as unknown as StoreManagementResult;

describe('PaymentShippingManager', () => {
    beforeEach(() => {
        apolloMocks.useLazyQuery.mockReturnValue([vi.fn(), { loading: false }]);
        apolloMocks.useMutation.mockReturnValue([vi.fn(), { loading: false }]);
        apolloMocks.useQuery.mockReturnValue({
            data: { myStoreCommerceMode: { mode: 'HYBRID' } },
            loading: false,
        });
    });

    it('shows only payment configuration in the payment section', () => {
        const html = renderManager('payment');

        expect(html).toContain('支付方式');
        expect(html).toContain('测试支付');
        expect(html).toContain('USDT 收款设置');
        expect(html).not.toContain('配送方式');
        expect(html).not.toContain('测试配送');
    });

    it('shows only shipping configuration in the shipping section', () => {
        const html = renderManager('shipping');

        expect(html).toContain('配送方式');
        expect(html).toContain('测试配送');
        expect(html).not.toContain('支付方式');
        expect(html).not.toContain('测试支付');
        expect(html).not.toContain('USDT 收款设置');
    });

    it('explains why shipping is unavailable for a digital-only store', () => {
        apolloMocks.useQuery.mockReturnValue({
            data: { myStoreCommerceMode: { mode: 'DIGITAL_ONLY' } },
            loading: false,
        });

        const html = renderManager('shipping');

        expect(html).toContain('当前为纯数字商品模式，无需配置配送方式');
        expect(html).not.toContain('测试配送');
        expect(html).not.toContain('USDT 收款设置');
    });
});

function renderManager(section: 'payment' | 'shipping') {
    return renderToStaticMarkup(
        <AdminPermissionsContext.Provider
            value={{ permissions: ['SuperAdmin'], hasAnyPermission: () => true }}
        >
            <ConfirmDialogContext.Provider value={async () => false}>
                <PaymentShippingManager
                    section={section}
                    data={data}
                    paymentMethodCustomFields={[]}
                    shippingMethodCustomFields={[]}
                    onChanged={async () => undefined}
                    onError={() => undefined}
                />
            </ConfirmDialogContext.Provider>
        </AdminPermissionsContext.Provider>,
    );
}
