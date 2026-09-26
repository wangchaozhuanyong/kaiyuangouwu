import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ConfirmDialogContext } from '../../components/confirm-dialog-context';
import type { StoreManagementResult } from '../../graphql/management.graphql';
import { AdminPermissionsContext } from '../../hooks/use-admin-permissions';
import { PaymentShippingManager } from './PaymentShippingManager';
import {
    formatFulfillmentHandlerSummary,
    formatShippingCalculatorSummary,
    formatShippingCheckerSummary,
} from './shipping-manager-utils';

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
                translations: [{ languageCode: 'zh_Hans', name: '测试配送', description: '用于测试运费' }],
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
        expect(html).not.toContain('test-payment');
        expect(html).not.toContain('test-handler');
        expect(html).not.toContain('配送方式');
        expect(html).not.toContain('测试配送');
    });

    it('shows only shipping configuration in the shipping section', () => {
        const html = renderManager('shipping');

        expect(html).toContain('配送方式');
        expect(html).toContain('测试配送');
        expect(html).not.toContain('test-shipping');
        expect(html).not.toContain('test-fulfillment-handler');
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

    it('formats shipping calculator and eligibility checker summaries cleanly', () => {
        expect(
            formatShippingCalculatorSummary(
                {
                    code: 'physical-subtotal-shipping-calculator',
                    args: [
                        { name: 'baseRate', value: '500' },
                        { name: 'freeAbove', value: '20000' },
                        { name: 'currencyCode', value: '"MYR"' },
                    ],
                },
                'MYR',
            ),
        ).toBe('基础运费: 5.00 MYR · 满 200.00 MYR 免邮');

        expect(
            formatShippingCalculatorSummary(
                {
                    code: 'default-shipping-calculator',
                    args: [{ name: 'rate', value: '0' }],
                },
                'MYR',
            ),
        ).toBe('全场免运费 (0.00)');

        expect(
            formatShippingCheckerSummary({
                code: 'supported-destination-eligibility-checker',
                args: [{ name: 'allowedCountryCodes', value: '"MY"' }],
            }),
        ).toBe('仅限配送: MY');

        expect(
            formatShippingCheckerSummary({
                code: 'default-shipping-eligibility-checker',
                args: [],
            }),
        ).toBe('全场通用');
        expect(formatFulfillmentHandlerSummary('unregistered-handler')).toBe('履约方式');
    });

    it('displays shipping guidance card and badges in shipping section', () => {
        const customData = {
            ...data,
            shippingMethods: {
                items: [
                    {
                        id: 'shipping-1',
                        code: 'standard-shipping',
                        name: '标准快递',
                        description: '普通快递配送',
                        calculator: {
                            code: 'physical-subtotal-shipping-calculator',
                            args: [
                                { name: 'baseRate', value: '500' },
                                { name: 'freeAbove', value: '20000' },
                            ],
                        },
                        checker: {
                            code: 'supported-destination-eligibility-checker',
                            args: [{ name: 'allowedCountryCodes', value: '"MY"' }],
                        },
                        fulfillmentHandlerCode: 'manual-fulfillment',
                    },
                ],
            },
        } as unknown as StoreManagementResult;

        const html = renderToStaticMarkup(
            <AdminPermissionsContext.Provider
                value={{ permissions: ['SuperAdmin'], hasAnyPermission: () => true }}
            >
                <ConfirmDialogContext.Provider value={async () => false}>
                    <PaymentShippingManager
                        section="shipping"
                        data={customData}
                        paymentMethodCustomFields={[]}
                        shippingMethodCustomFields={[]}
                        onChanged={async () => undefined}
                        onError={() => undefined}
                    />
                </ConfirmDialogContext.Provider>
            </AdminPermissionsContext.Provider>,
        );

        expect(html).toContain('💡 配送设置与客户端展示指引');
        expect(html).toContain('满额免邮无需单独建两个方式');
        expect(html).toContain('基础运费: 5.00 CNY · 满 200.00 CNY 免邮');
        expect(html).toContain('仅限配送: MY');
        expect(html).not.toContain('standard-shipping');
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
