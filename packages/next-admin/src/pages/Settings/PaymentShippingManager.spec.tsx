// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConfirmDialogContext } from '../../components/confirm-dialog-context';
import {
    CREATE_PAYMENT_METHOD_MUTATION,
    CREATE_SHIPPING_METHOD_MUTATION,
    UPDATE_SHIPPING_METHOD_MUTATION,
    type ConfigurableOperationDefinitionRecord,
    type StoreManagementResult,
} from '../../graphql/management.graphql';
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
    activeChannel: { id: 'channel-1', code: '__default_channel__', defaultCurrencyCode: 'CNY' },
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
        vi.clearAllMocks();
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

    it('shows only independent payment switches in an operating store even for a SuperAdmin', () => {
        apolloMocks.useQuery.mockReturnValue({
            data: {
                myStoreCommerceMode: { mode: 'HYBRID' },
                myStorePaymentOptions: [
                    {
                        id: 'shared-1',
                        name: '平台支付',
                        description: '统一网关',
                        enabled: true,
                        platformEnabled: false,
                        effectiveEnabled: false,
                    },
                ],
            },
            loading: false,
        });
        const html = renderToStaticMarkup(
            <AdminPermissionsContext.Provider
                value={{ permissions: ['SuperAdmin'], hasAnyPermission: () => true }}
            >
                <ConfirmDialogContext.Provider value={async () => false}>
                    <PaymentShippingManager
                        section="payment"
                        data={{ ...data, activeChannel: { ...data.activeChannel, code: 'store-b' } }}
                        paymentMethodCustomFields={[]}
                        shippingMethodCustomFields={[]}
                        onChanged={async () => undefined}
                        onError={() => undefined}
                    />
                </ConfirmDialogContext.Provider>
            </AdminPermissionsContext.Provider>,
        );
        expect(html).toContain('本店支付方式');
        expect(html).toContain('平台已停用');
        expect(html).toContain('本店开关');
        expect(html).not.toContain('新增');
        expect(html).not.toContain('USDT 收款设置');
        expect(html).not.toContain('编辑支付方式');
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

        const html = renderManager('shipping', {
            ...data,
            activeChannel: { ...data.activeChannel, code: 'store-b' },
        });

        expect(html).toContain('当前为纯数字商品模式，无需配置配送方式');
        expect(html).not.toContain('测试配送');
        expect(html).not.toContain('USDT 收款设置');
    });

    it('does not infer hybrid mode when a store mode read fails', () => {
        apolloMocks.useQuery.mockReturnValue({
            data: undefined,
            loading: false,
            error: new Error('offline'),
            refetch: vi.fn(),
        });
        const html = renderManager('shipping', {
            ...data,
            activeChannel: { ...data.activeChannel, code: 'store-b' },
        });
        expect(html).toContain('读取本店经营模式失败');
        expect(html).toContain('重试读取');
        expect(html).not.toContain('测试配送');
        expect(html).not.toContain('新增本店模板');
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

    it('explains store region and physical subtotal rules alongside legacy shipping summaries', () => {
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

        expect(html).toContain('包邮仍限定本店已配置的配送区域');
        expect(html).toContain('优惠后含税实物商品小计');
        expect(html).toContain('基础运费: 5.00 CNY · 满 200.00 CNY 免邮');
        expect(html).toContain('仅限配送: MY');
        expect(html).not.toContain('standard-shipping');
    });
});

describe('store shipping template editor', () => {
    let container: HTMLDivElement;
    let root: Root;
    const reactTestEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean };
    const createShipping = vi.fn(async (_options: { variables: { input: Record<string, unknown> } }) => ({}));
    const updateShipping = vi.fn(async (_options: { variables: { input: Record<string, unknown> } }) => ({}));
    const createPayment = vi.fn(async (_options: { variables: { input: Record<string, unknown> } }) => ({}));
    const onChanged = vi.fn(async () => undefined);
    const onError = vi.fn();
    const argument = (name: string, type: string, defaultValue: unknown) => ({
        name,
        type,
        defaultValue,
        required: true,
        label: null,
        description: null,
    });
    const checker: ConfigurableOperationDefinitionRecord = {
        code: 'store-shipping-zone-eligibility-checker',
        description: '本店配送区域',
        args: [
            argument('allowedCountryCodes', 'string', ''),
            argument('blockedPostalPrefixes', 'string', ''),
        ],
    };
    const calculator: ConfigurableOperationDefinitionRecord = {
        code: 'physical-subtotal-shipping-calculator',
        description: '实物商品运费',
        args: [
            argument('baseRate', 'int', 0),
            argument('freeAbove', 'int', 0),
            argument('currencyCode', 'string', ''),
            argument('sourceCurrencyCode', 'string', ''),
            argument('taxRate', 'float', 0),
            argument('priceIncludesTax', 'boolean', false),
            argument('estimateMinDays', 'int', 1),
            argument('estimateMaxDays', 'int', 3),
        ],
    };
    const method = {
        id: 'store-template',
        code: 'store-shipping-template',
        name: '本店配送',
        description: '',
        updatedAt: '2026-10-08T12:00:00.000Z',
        fulfillmentHandlerCode: 'manual-fulfillment',
        translations: [{ languageCode: 'zh_Hans', name: '本店配送', description: '' }],
        checker: {
            code: checker.code,
            args: [
                { name: 'allowedCountryCodes', value: '"MY"' },
                { name: 'blockedPostalPrefixes', value: '""' },
            ],
        },
        calculator: {
            code: calculator.code,
            args: calculator.args
                .filter(arg => arg.name !== 'sourceCurrencyCode')
                .map(arg => ({ name: arg.name, value: JSON.stringify(arg.defaultValue) })),
        },
    };
    const managerData = (edit = false, eligibilityChecker = checker) =>
        ({
            ...data,
            activeChannel: {
                ...data.activeChannel,
                code: 'operating-store',
                defaultCurrencyCode: edit ? 'CNY' : 'MYR',
            },
            shippingMethods: { items: edit ? [method] : [], totalItems: edit ? 1 : 0 },
            shippingEligibilityCheckers: [eligibilityChecker],
            shippingCalculators: [calculator],
            fulfillmentHandlers: [{ code: 'manual-fulfillment', description: '手动发货', args: [] }],
        }) as unknown as StoreManagementResult;

    beforeEach(() => {
        vi.clearAllMocks();
        reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
        apolloMocks.useLazyQuery.mockReturnValue([vi.fn(), { loading: false }]);
        apolloMocks.useMutation.mockImplementation(document => [
            document === CREATE_SHIPPING_METHOD_MUTATION
                ? createShipping
                : document === UPDATE_SHIPPING_METHOD_MUTATION
                  ? updateShipping
                  : document === CREATE_PAYMENT_METHOD_MUTATION
                    ? createPayment
                    : vi.fn(),
            { loading: false },
        ]);
        apolloMocks.useQuery.mockReturnValue({
            data: {
                myStoreCommerceMode: { mode: 'HYBRID' },
                shippingTemplateManagement: {
                    items: [
                        {
                            method,
                            ownedByStore: true,
                            platformTemplate: false,
                            enabled: true,
                            sourceCurrencyCode: 'MYR',
                            assignedStoreChannels: [],
                        },
                    ],
                },
            },
            loading: false,
            refetch: vi.fn(async () => undefined),
        });
    });
    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
    });
    const button = (label: string) => {
        const found = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
            element => element.textContent?.trim() === label || element.getAttribute('aria-label') === label,
        );
        expect(found).toBeDefined();
        return found!;
    };
    const input = (label: string) => {
        const field = [...container.querySelectorAll<HTMLLabelElement>('label')].find(element =>
            element.querySelector('.admin-field-label')?.textContent?.startsWith(label),
        );
        const found = field?.querySelector<HTMLInputElement>('input');
        expect(found).toBeDefined();
        return found!;
    };
    const setInput = async (label: string, value: string) =>
        act(async () => {
            const field = input(label);
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value);
            field.dispatchEvent(new Event('input', { bubbles: true }));
        });
    const renderEditor = async (edit = false, eligibilityChecker = checker) => {
        await act(async () =>
            root.render(
                <AdminPermissionsContext.Provider
                    value={{ permissions: ['SuperAdmin'], hasAnyPermission: () => true }}
                >
                    <ConfirmDialogContext.Provider value={async () => ({})}>
                        <PaymentShippingManager
                            section="shipping"
                            data={managerData(edit, eligibilityChecker)}
                            paymentMethodCustomFields={[]}
                            shippingMethodCustomFields={[]}
                            onChanged={onChanged}
                            onError={onError}
                        />
                    </ConfirmDialogContext.Provider>
                </AdminPermissionsContext.Provider>,
            ),
        );
        await act(async () => button(edit ? '编辑配送方式本店配送' : '新增本店模板').click());
    };

    it.each(['create', 'edit'] as const)(
        'saves %s store template with unrestricted postcodes, immutable MYR source and full minor-unit amounts',
        async mode => {
            const edit = mode === 'edit';
            await renderEditor(edit);
            await setInput('显示名称', '马来西亚配送');
            await setInput('允许配送的国家代码', 'MY');
            await setInput('基础运费 ·', '5');
            await setInput('实物免邮门槛', '200');
            expect(input('不配送的邮编前缀').required).toBe(false);
            expect(input('不配送的邮编前缀').value).toBe('');
            expect(input('金额来源币种').readOnly).toBe(true);
            expect(input('金额来源币种').value).toBe('MYR');
            await act(async () => button('保存配置').click());

            const save = edit ? updateShipping : createShipping;
            expect(onError).not.toHaveBeenCalled();
            expect(save).toHaveBeenCalledTimes(1);
            const saved = save.mock.calls[0][0].variables.input;
            expect(saved.checker).toEqual({
                code: checker.code,
                arguments: [
                    { name: 'allowedCountryCodes', value: 'MY' },
                    { name: 'blockedPostalPrefixes', value: '' },
                ],
            });
            expect(saved.calculator).toEqual({
                code: calculator.code,
                arguments: [
                    { name: 'baseRate', value: '500' },
                    { name: 'freeAbove', value: '20000' },
                    { name: 'currencyCode', value: '' },
                    { name: 'sourceCurrencyCode', value: 'MYR' },
                    { name: 'taxRate', value: '0' },
                    { name: 'priceIncludesTax', value: 'false' },
                    { name: 'estimateMinDays', value: '1' },
                    { name: 'estimateMaxDays', value: '3' },
                ],
            });
            expect(saved.id).toBe(edit ? method.id : undefined);
            expect(onChanged).toHaveBeenCalledTimes(1);
            expect(container.querySelector('[role="dialog"]')).toBeNull();
        },
    );

    it('keeps an actually required string parameter from saving when blank', async () => {
        await renderEditor(false, {
            ...checker,
            args: [...checker.args, { ...argument('requiredAddress', 'string', null), label: '收货地址' }],
        });
        await setInput('显示名称', '马来西亚配送');
        await act(async () => button('保存配置').click());
        expect(onError).toHaveBeenCalledWith(expect.stringContaining('收货地址为必填参数'));
        expect(createShipping).not.toHaveBeenCalled();
        expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    });

    it('rejects an empty monetary field while permitting empty postcode restrictions', async () => {
        await renderEditor();
        await setInput('显示名称', '马来西亚配送');
        await setInput('基础运费 ·', '');
        await act(async () => button('保存配置').click());
        expect(onError).toHaveBeenCalledWith('请填写有效的基础运费与免邮门槛，金额不能小于零。');
        expect(createShipping).not.toHaveBeenCalled();
    });

    it('keeps a required payment secret mandatory even when its configured default is an empty string', async () => {
        await act(async () =>
            root.render(
                <AdminPermissionsContext.Provider
                    value={{ permissions: ['SuperAdmin'], hasAnyPermission: () => true }}
                >
                    <ConfirmDialogContext.Provider value={async () => ({})}>
                        <PaymentShippingManager
                            section="payment"
                            data={{
                                ...data,
                                paymentMethodEligibilityCheckers: [],
                                paymentMethodHandlers: [
                                    {
                                        code: 'payment-gateway',
                                        description: '支付网关',
                                        args: [{ ...argument('apiKey', 'string', ''), label: '支付密钥' }],
                                    },
                                ],
                            }}
                            paymentMethodCustomFields={[]}
                            shippingMethodCustomFields={[]}
                            onChanged={onChanged}
                            onError={onError}
                        />
                    </ConfirmDialogContext.Provider>
                </AdminPermissionsContext.Provider>,
            ),
        );
        await act(async () => button('新增').click());
        await setInput('配置代码', 'gateway-config');
        await setInput('显示名称', '银行卡支付');
        const handlerSelect = [...container.querySelectorAll('label')]
            .find(element =>
                element.querySelector('.admin-field-label')?.textContent?.startsWith('支付处理器'),
            )!
            .querySelector('select')!;
        await act(async () => {
            handlerSelect.value = 'payment-gateway';
            handlerSelect.dispatchEvent(new Event('change', { bubbles: true }));
        });
        expect(input('支付密钥').required).toBe(true);
        await act(async () => button('保存配置').click());
        expect(onError).toHaveBeenCalledWith(expect.stringContaining('支付密钥为必填参数'));
        expect(createPayment).not.toHaveBeenCalled();
        expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    });

    it('preserves scalar ID and datetime values as text while saving the operation', async () => {
        await renderEditor(false, {
            ...checker,
            args: [
                ...checker.args,
                { ...argument('warehouseId', 'ID', null), label: '仓库 ID' },
                { ...argument('deliveryDate', 'datetime', null), label: '配送日期' },
            ],
        });
        await setInput('显示名称', '马来西亚配送');
        await setInput('允许配送的国家代码', 'MY');
        await setInput('仓库 ID', 'warehouse-1');
        await setInput('配送日期', '2026-10-09T10:30');
        await act(async () => button('保存配置').click());
        expect(onError).not.toHaveBeenCalled();
        expect(createShipping).toHaveBeenCalledTimes(1);
        expect(createShipping.mock.calls[0][0].variables.input.checker).toEqual({
            code: checker.code,
            arguments: [
                { name: 'allowedCountryCodes', value: 'MY' },
                { name: 'blockedPostalPrefixes', value: '' },
                { name: 'warehouseId', value: 'warehouse-1' },
                { name: 'deliveryDate', value: '2026-10-09T10:30' },
            ],
        });
    });
});

function renderManager(section: 'payment' | 'shipping', managerData = data) {
    return renderToStaticMarkup(
        <AdminPermissionsContext.Provider
            value={{ permissions: ['SuperAdmin'], hasAnyPermission: () => true }}
        >
            <ConfirmDialogContext.Provider value={async () => false}>
                <PaymentShippingManager
                    section={section}
                    data={managerData}
                    paymentMethodCustomFields={[]}
                    shippingMethodCustomFields={[]}
                    onChanged={async () => undefined}
                    onError={() => undefined}
                />
            </ConfirmDialogContext.Provider>
        </AdminPermissionsContext.Provider>,
    );
}

// The business fixtures own mocked data; lifecycle behavior is tested with real Apollo.
vi.mock('../../hooks/use-admin-query', () => import('../../test/admin-query-mock'));
