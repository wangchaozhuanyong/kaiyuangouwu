import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ConfirmDialogContext } from '../../components/confirm-dialog-context';
import { FeatureHelpProvider } from '../../components/FeatureHelp';
import type { StoreUsdtSetupResult } from '../../graphql/store-usdt.graphql';
import { AdminPermissionsContext } from '../../hooks/use-admin-permissions';
import type { AdminPermission } from '../../utils/admin-permissions';

import { UsdtPaymentSetupPanel } from './UsdtPaymentSetupPanel';

const apolloMocks = vi.hoisted(() => ({
    useMutation: vi.fn(),
    useQuery: vi.fn(),
}));

vi.mock('@apollo/client/react', () => apolloMocks);

const unconfiguredSetup: StoreUsdtSetupResult = {
    myStoreCurrencyConfiguration: {
        channelId: '1',
        channelCode: '__default_channel__',
        updatedAt: '2026-09-01T00:00:00.000Z',
        defaultCurrencyCode: 'CNY',
        availableCurrencyCodes: ['CNY', 'MYR'],
        selectorEnabled: true,
        rateMode: 'AUTO',
        cnyToMyrRate: 0.61,
        markupPercent: 1,
        roundingMode: 'CENT',
        usdtDisplayEnabled: false,
        usdtMarkupPercent: 0.5,
        usdtRateScheduleMode: 'INTERVAL',
        usdtRateIntervalMinutes: 5,
        usdtRateDailyTime: '10:00',
        cnyPerUsdtRate: 7.2,
        myrPerUsdtRate: 4.392,
        usdtRateSource: 'Binance + OKX',
        usdtRateUpdatedAt: '2026-09-01T00:00:00.000Z',
        usdtRateNextRunAt: '2026-09-01T00:05:00.000Z',
        usdtRateExpiresAt: '2026-09-01T00:15:00.000Z',
        usdtRateAvailable: true,
        usdtPaymentConfigured: false,
        usdtPaymentNetwork: 'TRC20',
        usdtReceivingAddressMasked: null,
        usdtReceivingAddressFingerprint: null,
        usdtWalletReviewStatus: 'UNCONFIGURED',
    },
    myStoreUsdtWallet: {
        channelId: '1',
        channelCode: '__default_channel__',
        reviewStatus: 'UNCONFIGURED',
        configured: false,
        network: 'TRC20',
        activeReceivingAddressMasked: null,
        activeReceivingAddressFingerprint: null,
        pendingReceivingAddress: null,
        pendingReceivingAddressFingerprint: null,
        canReview: false,
        submittedAt: null,
        reviewedAt: null,
        rejectionReason: null,
    },
};

describe('UsdtPaymentSetupPanel', () => {
    beforeEach(() => {
        apolloMocks.useMutation.mockReturnValue([vi.fn(), { loading: false }]);
        apolloMocks.useQuery.mockReturnValue({
            data: unconfiguredSetup,
            error: undefined,
            loading: false,
            refetch: vi.fn(),
        });
    });

    it('keeps the platform wallet submission form hidden from an ordinary store administrator', () => {
        const html = renderPanel(['ReadStoreProfile', 'UpdateStoreProfile']);

        expect(html).toContain('USDT-TRC20 收款');
        expect(html).toContain('尚未配置');
        expect(html).not.toContain('TRON 主网收款地址');
        expect(html).not.toContain('提交平台审核');
        expect(html).toContain('平台统一收款钱包');
    });

    it('allows wallet submission only for SuperAdmin in platform context', () => {
        expect(renderPanel(['ReadStoreProfile', 'UpdateStoreProfile', 'SuperAdmin'])).toContain(
            '提交平台审核',
        );
        apolloMocks.useQuery.mockReturnValue({
            data: {
                ...unconfiguredSetup,
                myStoreCurrencyConfiguration: {
                    ...unconfiguredSetup.myStoreCurrencyConfiguration,
                    channelCode: 'store-b',
                },
            },
            loading: false,
            refetch: vi.fn(),
        });
        const html = renderPanel(['ReadStoreProfile', 'UpdateStoreProfile', 'SuperAdmin']);
        expect(html).not.toContain('提交平台审核');
        expect(html).not.toContain('平台待审核收款地址');
        expect(apolloMocks.useQuery.mock.calls.at(-1)?.[1].skip).toBe(true);
    });

    it('does not render store wallet data without store profile read permission', () => {
        expect(renderPanel([])).toBe('');
    });

    it('blocks the submitting SuperAdmin from reviewing the same wallet', () => {
        const pendingWallet = {
            ...unconfiguredSetup.myStoreUsdtWallet,
            reviewStatus: 'PENDING' as const,
            pendingReceivingAddress: 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb',
            pendingReceivingAddressFingerprint: 'a'.repeat(64),
            canReview: false,
            submittedAt: '2026-09-01T01:00:00.000Z',
        };
        apolloMocks.useQuery
            .mockReset()
            .mockReturnValueOnce({
                data: { ...unconfiguredSetup, myStoreUsdtWallet: pendingWallet },
                error: undefined,
                loading: false,
                refetch: vi.fn(),
            })
            .mockReturnValueOnce({
                data: { storeUsdtWallets: [pendingWallet] },
                error: undefined,
                loading: false,
                refetch: vi.fn(),
            });

        const html = renderPanel(['ReadStoreProfile', 'UpdateStoreProfile', 'SuperAdmin']);

        expect(html).toContain('当前账号是该地址的提交人，不能自审');
        expect(html.match(/disabled=""/gu)?.length).toBeGreaterThanOrEqual(3);
    });
});

function renderPanel(permissions: readonly AdminPermission[]): string {
    return renderToStaticMarkup(
        <AdminPermissionsContext.Provider
            value={{
                permissions,
                hasAnyPermission: required => required.some(item => permissions.includes(item)),
            }}
        >
            <ConfirmDialogContext.Provider value={async () => false}>
                <FeatureHelpProvider>
                    <UsdtPaymentSetupPanel onChanged={async () => undefined} onError={() => undefined} />
                </FeatureHelpProvider>
            </ConfirmDialogContext.Provider>
        </AdminPermissionsContext.Provider>,
    );
}

// The business fixtures own mocked data; lifecycle behavior is tested with real Apollo.
vi.mock('../../hooks/use-admin-query', () => import('../../test/admin-query-mock'));
