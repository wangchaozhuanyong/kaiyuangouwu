// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmDialogContext, type RequestConfirmation } from '../../components/confirm-dialog-context';
import {
    DELETE_PAYMENT_METHOD_MUTATION,
    DELETE_SELLER_MUTATION,
    DELETE_SHIPPING_METHOD_MUTATION,
    type StoreManagementResult,
} from '../../graphql/management.graphql';
import { PaymentShippingManager } from './PaymentShippingManager';
import { SellersPanel } from './StorePanels';

const apolloMocks = vi.hoisted(() => ({
    useMutation: vi.fn(),
    useQuery: vi.fn(),
}));
const sensitiveActionContextMock = vi.hoisted(() =>
    vi.fn((currentPassword: string) => ({
        headers: { 'x-vendure-sensitive-action-password': currentPassword },
    })),
);

vi.mock('@apollo/client/react', () => apolloMocks);
vi.mock('../../apollo', () => ({
    client: { query: vi.fn() },
    sensitiveActionContext: sensitiveActionContextMock,
}));
vi.mock('../../components/FeatureHelp', () => ({ FeatureHelpButton: () => null }));
vi.mock('../../hooks/use-admin-permissions', () => ({
    useAdminPermissions: () => ({ hasAnyPermission: () => true }),
}));
vi.mock('./UsdtPaymentSetupPanel', () => ({ UsdtPaymentSetupPanel: () => null }));

const storeManagementData: StoreManagementResult = {
    activeAdministrator: null,
    activeChannel: { id: 'channel-1', defaultLanguageCode: 'zh_Hans', defaultCurrencyCode: 'MYR' },
    storeProfiles: [],
    storeProvisioningTemplates: [],
    sellers: {
        totalItems: 1,
        items: [
            {
                id: 'seller-1',
                name: '美宜佳',
                createdAt: '2026-09-01T00:00:00.000Z',
                updatedAt: '2026-09-01T00:00:00.000Z',
            },
        ],
    },
    paymentMethods: {
        totalItems: 1,
        items: [
            {
                id: 'payment-1',
                name: '银行卡',
                description: '',
                code: 'card',
                enabled: true,
                updatedAt: '2026-09-01T00:00:00.000Z',
                translations: [],
                checker: null,
                handler: { code: 'card-handler', args: [] },
            },
        ],
    },
    shippingMethods: {
        totalItems: 1,
        items: [
            {
                id: 'shipping-1',
                name: '全马配送',
                description: '',
                code: 'malaysia-shipping',
                fulfillmentHandlerCode: 'manual-fulfillment',
                updatedAt: '2026-09-01T00:00:00.000Z',
                translations: [],
                checker: { code: 'default-checker', args: [] },
                calculator: { code: 'default-calculator', args: [] },
            },
        ],
    },
    paymentMethodEligibilityCheckers: [],
    paymentMethodHandlers: [],
    shippingEligibilityCheckers: [],
    shippingCalculators: [],
    fulfillmentHandlers: [],
};

const reactTestEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean };
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    apolloMocks.useQuery.mockReturnValue({
        data: { myStoreCommerceMode: { mode: 'HYBRID' } },
        loading: false,
    });
    apolloMocks.useMutation.mockReturnValue([vi.fn(), { loading: false }]);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
    reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
    vi.clearAllMocks();
});

describe('protected settings deletion', () => {
    it('refreshes seller occupancy after one store is rebound and still protects the other store', async () => {
        const requestConfirmation = vi.fn<RequestConfirmation>();
        const onError = vi.fn();
        const sellers = [
            { ...storeManagementData.sellers.items[0], name: '大马仓库' },
            { ...storeManagementData.sellers.items[0], id: 'seller-2', name: '模钥科技' },
        ];
        const profiles: StoreManagementResult['storeProfiles'] = ['模钥店铺', '大马通'].map(
            (name, index) => ({
                id: `profile-${index}`,
                updatedAt: '2026-09-12T00:00:00.000Z',
                status: 'ACTIVE',
                sortOrder: index,
                descriptionZh: '',
                descriptionEn: '',
                taglineZh: null,
                taglineEn: null,
                brandBackgroundColor: null,
                brandPrimaryColor: null,
                brandAccentColor: null,
                brandHighlightColor: null,
                legalEntityName: null,
                legalRegistrationCountry: null,
                supportEmail: null,
                privacyEmail: null,
                internalNote: null,
                primaryDomain: null,
                storefrontUrl: null,
                isOperational: true,
                activationReadiness: { ready: true, checks: [] },
                logoAsset: null,
                logoOnLightAsset: null,
                logoOnDarkAsset: null,
                channel: {
                    id: `channel-${index}`,
                    code: `store-${index}`,
                    token: `test-channel-${index}`,
                    defaultCurrencyCode: 'MYR',
                    defaultLanguageCode: 'zh_Hans',
                    seller: sellers[0],
                    customFields: { storefrontNameZh: name, storefrontNameEn: name },
                },
            }),
        );
        const renderPanel = async () =>
            act(async () =>
                root.render(
                    <ConfirmDialogContext.Provider value={requestConfirmation}>
                        <SellersPanel
                            sellers={sellers}
                            profiles={profiles}
                            customFieldDefinitions={[]}
                            onChanged={async () => undefined}
                            onError={onError}
                        />
                    </ConfirmDialogContext.Provider>,
                ),
            );
        const rowFor = (name: string) =>
            container.querySelector(`button[aria-label="删除${name}"]`)!.closest('tr')!;
        await renderPanel();
        expect(rowFor('大马仓库').textContent).toContain('模钥店铺');
        expect(rowFor('大马仓库').textContent).toContain('大马通');
        expect(rowFor('模钥科技').textContent).toContain('未被店铺占用');

        profiles[0] = { ...profiles[0], channel: { ...profiles[0].channel, seller: sellers[1] } };
        await renderPanel();
        expect(rowFor('大马仓库').textContent).not.toContain('模钥店铺');
        expect(rowFor('大马仓库').textContent).toContain('大马通');
        expect(rowFor('模钥科技').textContent).toContain('模钥店铺');
        expect(rowFor('模钥科技').textContent).not.toContain('大马通');
        await act(async () =>
            container.querySelector<HTMLButtonElement>('button[aria-label="删除大马仓库"]')!.click(),
        );
        expect(onError).toHaveBeenCalledWith(expect.stringContaining('正在占用的店铺：大马通'));
        expect(requestConfirmation).not.toHaveBeenCalled();
    });

    it('uses one password confirmation for payment and shipping deletion', async () => {
        const requestConfirmation = vi
            .fn<RequestConfirmation>()
            .mockResolvedValue({ currentPassword: 'Current123!' });
        const deletePayment = vi.fn().mockResolvedValue({
            data: { deletePaymentMethod: { result: 'DELETED', message: null } },
        });
        const deleteShipping = vi.fn().mockResolvedValue({
            data: { deleteShippingMethod: { result: 'DELETED', message: null } },
        });
        apolloMocks.useMutation.mockImplementation(document => {
            if (document === DELETE_PAYMENT_METHOD_MUTATION) return [deletePayment, { loading: false }];
            if (document === DELETE_SHIPPING_METHOD_MUTATION) return [deleteShipping, { loading: false }];
            return [vi.fn(), { loading: false }];
        });

        await act(async () => {
            root.render(
                <ConfirmDialogContext.Provider value={requestConfirmation}>
                    <PaymentShippingManager
                        section="payment"
                        data={storeManagementData}
                        paymentMethodCustomFields={[]}
                        shippingMethodCustomFields={[]}
                        onChanged={async () => undefined}
                        onError={() => undefined}
                    />
                </ConfirmDialogContext.Provider>,
            );
        });

        const paymentButton = container.querySelector<HTMLButtonElement>(
            'button[aria-label="删除支付方式银行卡"]',
        );
        expect(paymentButton).not.toBeNull();
        await act(async () => paymentButton?.dispatchEvent(new MouseEvent('click', { bubbles: true })));

        await act(async () => {
            root.render(
                <ConfirmDialogContext.Provider value={requestConfirmation}>
                    <PaymentShippingManager
                        section="shipping"
                        data={storeManagementData}
                        paymentMethodCustomFields={[]}
                        shippingMethodCustomFields={[]}
                        onChanged={async () => undefined}
                        onError={() => undefined}
                    />
                </ConfirmDialogContext.Provider>,
            );
        });
        const shippingButton = container.querySelector<HTMLButtonElement>(
            'button[aria-label="删除配送方式全马配送"]',
        );
        expect(shippingButton).not.toBeNull();
        await act(async () => shippingButton?.dispatchEvent(new MouseEvent('click', { bubbles: true })));

        expect(requestConfirmation).toHaveBeenCalledTimes(2);
        for (const [options] of requestConfirmation.mock.calls) {
            expect(options).toMatchObject({
                confirmLabel: '验证并删除',
                tone: 'danger',
                requireCurrentPassword: true,
            });
        }
        const context = { headers: { 'x-vendure-sensitive-action-password': 'Current123!' } };
        expect(deletePayment).toHaveBeenCalledWith({
            variables: { id: 'payment-1', force: false },
            context: {
                ...context,
                adminFeedback: expect.objectContaining({ target: '支付方式“银行卡”' }),
            },
        });
        expect(deleteShipping).toHaveBeenCalledWith({
            variables: { id: 'shipping-1' },
            context: {
                ...context,
                adminFeedback: expect.objectContaining({ target: '配送方式“全马配送”' }),
            },
        });
    });

    it('uses one password confirmation for seller deletion', async () => {
        const requestConfirmation = vi
            .fn<RequestConfirmation>()
            .mockResolvedValue({ currentPassword: 'Current123!' });
        const deleteSeller = vi.fn().mockResolvedValue({
            data: { deleteSeller: { result: 'DELETED', message: null } },
        });
        apolloMocks.useMutation.mockImplementation(document =>
            document === DELETE_SELLER_MUTATION
                ? [deleteSeller, { loading: false }]
                : [vi.fn(), { loading: false }],
        );

        await act(async () => {
            root.render(
                <ConfirmDialogContext.Provider value={requestConfirmation}>
                    <SellersPanel
                        sellers={storeManagementData.sellers.items}
                        profiles={[]}
                        customFieldDefinitions={[]}
                        onChanged={async () => undefined}
                        onError={() => undefined}
                    />
                </ConfirmDialogContext.Provider>,
            );
        });

        const button = container.querySelector<HTMLButtonElement>('button[aria-label="删除美宜佳"]');
        expect(button).not.toBeNull();
        await act(async () => button?.dispatchEvent(new MouseEvent('click', { bubbles: true })));

        expect(requestConfirmation).toHaveBeenCalledWith(
            expect.objectContaining({
                confirmLabel: '验证并删除',
                tone: 'danger',
                requireCurrentPassword: true,
            }),
        );
        const context = { headers: { 'x-vendure-sensitive-action-password': 'Current123!' } };
        expect(deleteSeller).toHaveBeenCalledWith({
            variables: { id: 'seller-1' },
            context: {
                ...context,
                adminFeedback: {
                    target: '商家主体“美宜佳”',
                    failure:
                        '无法删除商家主体“美宜佳”。请先确认没有店铺 Channel 使用该主体；保留店铺时先改绑到其他商家主体，整间店铺不再使用时请到“店铺实例”使用“安全清退”。',
                    resolution: [
                        '保留店铺时，先将对应 Channel 改绑到其他商家主体',
                        '整间店铺不再使用时，到“店铺实例”执行“安全清退”',
                    ],
                },
            },
        });
    });

    it('names the stores and Channels blocking seller deletion before asking for a password', async () => {
        const requestConfirmation = vi
            .fn<RequestConfirmation>()
            .mockResolvedValue({ currentPassword: 'Current123!' });
        const deleteSeller = vi.fn();
        const onError = vi.fn();
        apolloMocks.useMutation.mockImplementation(document =>
            document === DELETE_SELLER_MUTATION
                ? [deleteSeller, { loading: false }]
                : [vi.fn(), { loading: false }],
        );
        const profiles = [
            {
                id: 'profile-1',
                channel: {
                    id: 'channel-1',
                    code: 'my-malaysia',
                    seller: { id: 'seller-1', name: '美宜佳' },
                    customFields: { storefrontNameZh: '美宜佳店铺', storefrontNameEn: 'Meiyijia' },
                },
            },
        ] as StoreManagementResult['storeProfiles'];

        await act(async () => {
            root.render(
                <ConfirmDialogContext.Provider value={requestConfirmation}>
                    <SellersPanel
                        sellers={storeManagementData.sellers.items}
                        profiles={profiles}
                        customFieldDefinitions={[]}
                        onChanged={async () => undefined}
                        onError={onError}
                    />
                </ConfirmDialogContext.Provider>,
            );
        });

        expect(container.textContent).toContain('被 美宜佳店铺（Channel：my-malaysia） 使用');
        const button = container.querySelector<HTMLButtonElement>('button[aria-label="删除美宜佳"]');
        await act(async () => button?.dispatchEvent(new MouseEvent('click', { bubbles: true })));

        expect(onError).toHaveBeenCalledWith(
            '无法删除商家主体“美宜佳”，正在占用的店铺：美宜佳店铺（Channel：my-malaysia）。处理方法：保留店铺时，请先将对应 Channel 改绑到其他商家主体；整间店铺不再使用时，请到“店铺实例”使用“安全清退”。',
        );
        expect(requestConfirmation).not.toHaveBeenCalled();
        expect(deleteSeller).not.toHaveBeenCalled();
    });

    it('does not add a second page error when global mutation feedback handles a backend refusal', async () => {
        const requestConfirmation = vi
            .fn<RequestConfirmation>()
            .mockResolvedValue({ currentPassword: 'Current123!' });
        const deleteSeller = vi.fn().mockResolvedValue({
            data: {
                deleteSeller: {
                    result: 'NOT_DELETED',
                    message: '商家主体仍被 Channel my-malaysia 使用',
                },
            },
        });
        const onError = vi.fn();
        const onChanged = vi.fn();
        apolloMocks.useMutation.mockImplementation(document =>
            document === DELETE_SELLER_MUTATION
                ? [deleteSeller, { loading: false }]
                : [vi.fn(), { loading: false }],
        );

        await act(async () => {
            root.render(
                <ConfirmDialogContext.Provider value={requestConfirmation}>
                    <SellersPanel
                        sellers={storeManagementData.sellers.items}
                        profiles={[]}
                        customFieldDefinitions={[]}
                        onChanged={onChanged}
                        onError={onError}
                    />
                </ConfirmDialogContext.Provider>,
            );
        });

        const button = container.querySelector<HTMLButtonElement>('button[aria-label="删除美宜佳"]');
        await act(async () => button?.dispatchEvent(new MouseEvent('click', { bubbles: true })));

        expect(deleteSeller).toHaveBeenCalledOnce();
        expect(onChanged).not.toHaveBeenCalled();
        expect(onError).not.toHaveBeenCalled();
    });
});
