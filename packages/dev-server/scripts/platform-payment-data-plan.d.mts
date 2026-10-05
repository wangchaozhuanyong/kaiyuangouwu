export interface PaymentDataPlanAdapter {
    query(sql: string): Promise<Array<Record<string, unknown>>>;
    tableExists(table: string): Promise<boolean>;
    columnExists?(table: string, column: string): Promise<boolean>;
    kind?: string;
}

export interface PlatformPaymentDataPlan {
    format: 1;
    productionReady: false;
    mutatesData: false;
    platformChannelId: string;
    operatingChannels: Array<{ id: string; code: string }>;
    entries: Array<{
        id: string | number;
        code: string;
        enabled: boolean | number;
        channelIds: string[];
        scope: 'PLATFORM_CONFIGURATION' | 'LEGACY_STORE_CONFIGURATION';
        decision: 'KEEP_PLATFORM_CONFIGURATION' | 'REVIEW_EXPLICIT_MAPPING_KEEP_PAYMENT_HISTORY';
        automaticMigration: false;
        configurationEvidence: unknown;
    }>;
    switches: Array<Record<string, unknown>>;
    wallets: Array<Record<string, unknown>>;
    historicalPayments: Array<Record<string, unknown>>;
    historicalIntents: Array<Record<string, unknown>>;
    applyRequirements: string[];
}

export declare function collectPlatformPaymentDataPlan(
    adapter: PaymentDataPlanAdapter,
): Promise<PlatformPaymentDataPlan>;
