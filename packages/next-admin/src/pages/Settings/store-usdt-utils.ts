import { paymentMethodDisplayLabel } from '../../../../common/src/system-display-labels';
import type { ConfigurableOperationDefinitionRecord } from '../../graphql/management.graphql';
import type {
    StoreUsdtConfigurationDraft,
    StoreUsdtConfigurationRecord,
    StoreUsdtWalletReviewStatus,
} from '../../graphql/store-usdt.graphql';

export const USDT_PAYMENT_METHOD_CODE = 'usdt-trc20';
export const USDT_PAYMENT_HANDLER_CODE = 'usdt-trc20-chain-handler';

const TRON_MAINNET_ADDRESS_PATTERN = /^T[1-9A-HJ-NP-Za-km-z]{33}$/u;
const USDT_PAYMENT_INTENT_STATUS_LABELS: Readonly<Record<string, string>> = {
    PENDING: '待付款',
    SETTLED: '已到账',
    MANUAL_REVIEW: '待人工复核',
    EXPIRED: '已过期',
    RESOLVED: '已人工闭环',
};

export function isPlausibleTronMainnetAddress(value: string): boolean {
    return TRON_MAINNET_ADDRESS_PATTERN.test(value.trim());
}

export function isSystemManagedUsdtPaymentMethod(method: { code: string; handler: { code: string } }) {
    return method.code === USDT_PAYMENT_METHOD_CODE || method.handler.code === USDT_PAYMENT_HANDLER_CODE;
}

export const storePaymentMethodLabel = paymentMethodDisplayLabel;

export function storeUsdtPaymentIntentStatusLabel(status?: string | null): string {
    const normalizedStatus = status?.trim();
    if (!normalizedStatus) return '未知状态';
    return USDT_PAYMENT_INTENT_STATUS_LABELS[normalizedStatus] ?? '未知状态';
}

export function selectablePaymentHandlers(definitions: ConfigurableOperationDefinitionRecord[]) {
    return definitions.filter(definition => definition.code !== USDT_PAYMENT_HANDLER_CODE);
}

export function toStoreUsdtConfigurationDraft(
    configuration: StoreUsdtConfigurationRecord,
): StoreUsdtConfigurationDraft {
    return {
        usdtDisplayEnabled: configuration.usdtDisplayEnabled,
        usdtMarkupPercent: configuration.usdtMarkupPercent,
        usdtRateScheduleMode: configuration.usdtRateScheduleMode,
        usdtRateIntervalMinutes: configuration.usdtRateIntervalMinutes,
        usdtRateDailyTime: configuration.usdtRateDailyTime,
    };
}

export function storeUsdtConfigurationChanged(
    configuration: StoreUsdtConfigurationRecord,
    draft: StoreUsdtConfigurationDraft,
): boolean {
    return JSON.stringify(toStoreUsdtConfigurationDraft(configuration)) !== JSON.stringify(draft);
}

export function buildStoreUsdtConfigurationInput(
    configuration: StoreUsdtConfigurationRecord,
    draft: StoreUsdtConfigurationDraft,
) {
    return {
        expectedUpdatedAt: configuration.updatedAt,
        defaultCurrencyCode: configuration.defaultCurrencyCode,
        availableCurrencyCodes: configuration.availableCurrencyCodes,
        selectorEnabled: configuration.selectorEnabled,
        rateMode: configuration.rateMode,
        cnyToMyrRate: configuration.cnyToMyrRate,
        markupPercent: configuration.markupPercent,
        roundingMode: configuration.roundingMode,
        ...draft,
    };
}

export function validateStoreUsdtConfigurationDraft(draft: StoreUsdtConfigurationDraft): string | null {
    if (
        !Number.isFinite(draft.usdtMarkupPercent) ||
        draft.usdtMarkupPercent < 0 ||
        draft.usdtMarkupPercent > 20
    ) {
        return 'USDT 报价加价必须在 0% 到 20% 之间';
    }
    if (
        draft.usdtRateScheduleMode === 'INTERVAL' &&
        ![5, 10, 15, 30, 60].includes(draft.usdtRateIntervalMinutes)
    ) {
        return '请选择有效的 USDT 汇率采集间隔';
    }
    if (
        draft.usdtRateScheduleMode === 'DAILY' &&
        !/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(draft.usdtRateDailyTime)
    ) {
        return '请输入有效的每日采集时间';
    }
    return null;
}

export function storeUsdtWalletStatusLabel(status: StoreUsdtWalletReviewStatus): string {
    switch (status) {
        case 'PENDING':
            return '等待平台审核';
        case 'ACTIVE':
            return '已审核启用';
        case 'REJECTED':
            return '审核未通过';
        default:
            return '尚未配置';
    }
}
