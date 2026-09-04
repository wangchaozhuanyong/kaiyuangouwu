import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmDialogContext } from '../../components/confirm-dialog-context';
import type { StoreManagementResult } from '../../graphql/management.graphql';
import { AdminPermissionsContext } from '../../hooks/use-admin-permissions';
import type { AdminPermission } from '../../utils/admin-permissions';
import { PaymentShippingManager } from './PaymentShippingManager';
import { SIMULATED_PAYMENT_HANDLER_CODE } from './simulated-payment-utils';

const apolloMocks = vi.hoisted(() => ({
    useLazyQuery: vi.fn(),
    useMutation: vi.fn(),
    useQuery: vi.fn(),
}));

vi.mock('@apollo/client/react', () => apolloMocks);
vi.mock('./UsdtPaymentSetupPanel', () => ({ UsdtPaymentSetupPanel: () => null }));

describe('PaymentShippingManager simulated payment controls', () => {
    beforeEach(() => {
        apolloMocks.useLazyQuery.mockReturnValue([vi.fn(), { loading: false }]);
        apolloMocks.useMutation.mockReturnValue([vi.fn(), { loading: false }]);
        apolloMocks.useQuery.mockReturnValue({
            data: { myStoreCommerceMode: { mode: 'DIGITAL_ONLY' } },
            error: undefined,
            loading: false,
        });
    });

    it('offers to create and enable simulated payment when the Channel has none', () => {
        const html = renderManager(managementData(), ['CreatePaymentMethod', 'UpdatePaymentMethod']);

        expect(html).toContain('模拟支付（测试）');
        expect(html).toContain('创建并开启');
        expect(html).toContain('不扣款完成订单');
    });

    it('renders a working on/off control for an immediately settled simulated method', () => {
        const html = renderManager(
            managementData({ paymentMethods: { totalItems: 1, items: [simulatedMethod('true')] } }),
            ['UpdatePaymentMethod'],
        );

        expect(html).toContain('仅限测试');
        expect(html).toContain('已开启');
        expect(html).toContain('checked=""');
        expect(html).not.toContain('修复并开启');
    });

    it('flags legacy authorization-only dummy payment for repair', () => {
        const html = renderManager(
            managementData({ paymentMethods: { totalItems: 1, items: [simulatedMethod('false')] } }),
            ['UpdatePaymentMethod'],
        );

        expect(html).toContain('旧的“仅授权”配置');
        expect(html).toContain('修复并开启');
    });
});

function renderManager(data: StoreManagementResult, permissions: readonly AdminPermission[]): string {
    return renderToStaticMarkup(
        <AdminPermissionsContext.Provider
            value={{
                permissions,
                hasAnyPermission: required => required.some(item => permissions.includes(item)),
            }}
        >
            <ConfirmDialogContext.Provider value={async () => false}>
                <PaymentShippingManager
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

function managementData(overrides: Partial<StoreManagementResult> = {}): StoreManagementResult {
    return {
        activeAdministrator: null,
        activeChannel: {
            id: 'channel-1',
            code: 'my-malaysia',
            defaultLanguageCode: 'zh_Hans',
            defaultCurrencyCode: 'CNY',
        },
        storeProfiles: [],
        storeProvisioningTemplates: [],
        sellers: { totalItems: 0, items: [] },
        paymentMethods: { totalItems: 0, items: [] },
        shippingMethods: { totalItems: 0, items: [] },
        paymentMethodEligibilityCheckers: [],
        paymentMethodHandlers: [
            {
                code: SIMULATED_PAYMENT_HANDLER_CODE,
                description: '模拟支付',
                args: [
                    {
                        name: 'automaticSettle',
                        type: 'boolean',
                        required: true,
                        defaultValue: false,
                        label: '立即结算',
                        description: null,
                    },
                ],
            },
        ],
        shippingEligibilityCheckers: [],
        shippingCalculators: [],
        fulfillmentHandlers: [],
        ...overrides,
    };
}

function simulatedMethod(automaticSettle: string) {
    return {
        id: 'payment-1',
        name: '模拟支付（测试）',
        description: '不会真实扣款',
        code: 'simulated-payment',
        enabled: true,
        updatedAt: '2026-09-04T00:00:00.000Z',
        translations: [],
        checker: null,
        handler: {
            code: SIMULATED_PAYMENT_HANDLER_CODE,
            args: [{ name: 'automaticSettle', value: automaticSettle }],
        },
    };
}
