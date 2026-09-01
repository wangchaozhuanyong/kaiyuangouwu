import { describe, expect, it } from 'vitest';
import type { ConfigurableOperationDefinitionRecord } from '../../graphql/management.graphql';
import type {
    StoreUsdtConfigurationDraft,
    StoreUsdtConfigurationRecord,
} from '../../graphql/store-usdt.graphql';
import {
    USDT_PAYMENT_HANDLER_CODE,
    buildStoreUsdtConfigurationInput,
    isPlausibleTronMainnetAddress,
    isSystemManagedUsdtPaymentMethod,
    selectablePaymentHandlers,
    storeUsdtConfigurationChanged,
    storeUsdtWalletStatusLabel,
    toStoreUsdtConfigurationDraft,
    validateStoreUsdtConfigurationDraft,
} from './store-usdt-utils';

const configuration: StoreUsdtConfigurationRecord = {
    channelId: '1',
    channelCode: 'default-channel',
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
    usdtRateAvailable: false,
    usdtPaymentConfigured: false,
    usdtPaymentNetwork: 'TRC20',
    usdtReceivingAddressMasked: null,
    usdtReceivingAddressFingerprint: null,
    usdtWalletReviewStatus: 'UNCONFIGURED',
};

describe('store USDT setup helpers', () => {
    it('accepts only a plausible TRON mainnet public address shape', () => {
        expect(isPlausibleTronMainnetAddress('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t')).toBe(true);
        expect(isPlausibleTronMainnetAddress('  TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t  ')).toBe(true);
        expect(isPlausibleTronMainnetAddress('0x1234567890abcdef')).toBe(false);
        expect(isPlausibleTronMainnetAddress('private-key-value')).toBe(false);
    });

    it('removes the system-managed USDT handler from the generic payment editor', () => {
        const definitions: ConfigurableOperationDefinitionRecord[] = [
            operationDefinition(USDT_PAYMENT_HANDLER_CODE),
            operationDefinition('stripe-handler'),
        ];

        expect(selectablePaymentHandlers(definitions).map(definition => definition.code)).toEqual([
            'stripe-handler',
        ]);
        expect(
            isSystemManagedUsdtPaymentMethod({
                code: 'alternate-code',
                handler: { code: USDT_PAYMENT_HANDLER_CODE },
            }),
        ).toBe(true);
    });

    it('preserves non-USDT currency settings when saving the USDT draft', () => {
        const draft: StoreUsdtConfigurationDraft = {
            ...toStoreUsdtConfigurationDraft(configuration),
            usdtDisplayEnabled: true,
            usdtMarkupPercent: 1.25,
            usdtRateIntervalMinutes: 10,
        };

        expect(storeUsdtConfigurationChanged(configuration, draft)).toBe(true);
        expect(buildStoreUsdtConfigurationInput(configuration, draft)).toEqual({
            expectedUpdatedAt: configuration.updatedAt,
            defaultCurrencyCode: 'CNY',
            availableCurrencyCodes: ['CNY', 'MYR'],
            selectorEnabled: true,
            rateMode: 'AUTO',
            cnyToMyrRate: 0.61,
            markupPercent: 1,
            roundingMode: 'CENT',
            ...draft,
        });
    });

    it('validates quote limits and maps wallet statuses for the UI', () => {
        expect(
            validateStoreUsdtConfigurationDraft({
                ...toStoreUsdtConfigurationDraft(configuration),
                usdtMarkupPercent: 21,
            }),
        ).toContain('0% 到 20%');
        expect(
            validateStoreUsdtConfigurationDraft({
                ...toStoreUsdtConfigurationDraft(configuration),
                usdtRateScheduleMode: 'DAILY',
                usdtRateDailyTime: '25:90',
            }),
        ).toContain('每日采集时间');
        expect(storeUsdtWalletStatusLabel('PENDING')).toBe('等待平台审核');
        expect(storeUsdtWalletStatusLabel('ACTIVE')).toBe('已审核启用');
    });
});

function operationDefinition(code: string): ConfigurableOperationDefinitionRecord {
    return {
        code,
        description: code,
        args: [],
    };
}
