/** Read-only IDs and state audit. Never reads credentials, wallet ciphertext, addresses or card payloads. */
export async function collectPlatformPaymentDataPlan(adapter) {
    const channels = await adapter.query('SELECT id, code FROM channel ORDER BY id');
    const platform = channels.find(c => c.code === '__default_channel__');
    if (!platform) throw new Error('DEFAULT_CHANNEL_MISSING');
    const optional = async (table, columns) => {
        if (!(await adapter.tableExists(table))) return [];
        if (
            adapter.columnExists &&
            !(await Promise.all(columns.map(c => adapter.columnExists(table, c)))).every(Boolean)
        )
            return [];
        return adapter.query(`SELECT ${columns.map(c => `\`${c}\``).join(', ')} FROM \`${table}\``);
    };
    const [methods, links, switches, wallets, payments, intents] = await Promise.all([
        optional('payment_method', ['id', 'code', 'enabled']),
        optional('payment_method_channels_channel', ['paymentMethodId', 'channelId']),
        optional('store_payment_method_state', ['id', 'paymentMethodId', 'channelId', 'enabled']),
        optional('store_usdt_wallet', ['id', 'channelId', 'reviewStatus']),
        optional('payment', ['id', 'method', 'orderId', 'state']),
        optional('storefront_usdt_payment_intent', ['id', 'channelId', 'orderId', 'status']),
    ]);
    const platformIds = new Set(
        links.filter(l => String(l.channelId) === String(platform.id)).map(l => String(l.paymentMethodId)),
    );
    const entries = methods.map(method => ({
        ...method,
        channelIds: links
            .filter(l => String(l.paymentMethodId) === String(method.id))
            .map(l => String(l.channelId)),
        scope: platformIds.has(String(method.id)) ? 'PLATFORM_CONFIGURATION' : 'LEGACY_STORE_CONFIGURATION',
        decision: platformIds.has(String(method.id))
            ? 'KEEP_PLATFORM_CONFIGURATION'
            : 'REVIEW_EXPLICIT_MAPPING_KEEP_PAYMENT_HISTORY',
        automaticMigration: false,
    }));
    return {
        format: 1,
        productionReady: false,
        mutatesData: false,
        platformChannelId: String(platform.id),
        entries,
        switches: switches.map(s => ({
            ...s,
            decision:
                String(s.channelId) === String(platform.id) || !platformIds.has(String(s.paymentMethodId))
                    ? 'INVALID_SWITCH_REVIEW'
                    : 'KEEP_LOCAL_SWITCH',
        })),
        wallets: wallets.map(w => ({
            ...w,
            decision:
                String(w.channelId) === String(platform.id)
                    ? 'KEEP_PLATFORM_WALLET'
                    : 'KEEP_LEGACY_HISTORY_DO_NOT_USE_FOR_NEW_INTENTS',
        })),
        historicalPayments: payments,
        historicalIntents: intents,
        applyRequirements: [
            'verified backup',
            'explicit old/new method IDs and configuration evidence',
            'reviewed local enable states',
            'preserve existing payment/intent method and recipient snapshots',
            'separate production authorization',
        ],
    };
}
