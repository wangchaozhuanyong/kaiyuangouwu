import { useMutation } from '@apollo/client/react';
import { CircleDollarSign, RefreshCw, Save, WalletCards } from 'lucide-react';
import { useState } from 'react';
import {
    systemFieldDisplayLabel,
    systemStatusDisplayLabel,
} from '../../../../common/src/system-display-labels';
import { AdminButton, AdminInput, AdminSelect } from '../../components/AdminControls';
import { AdminField } from '../../components/AdminField';
import { useAdminQuery as useQuery } from '../../hooks/use-admin-query';
import { useStandaloneAdminPage } from '../../hooks/use-standalone-admin-page';
import { selectQueryFields } from '../../utils/select-query-fields';

import { sensitiveActionContext } from '../../apollo';
import { DraftUpdateNotice } from '../../components/DraftUpdateNotice';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import { SensitiveActionDialog } from '../../components/SensitiveActionDialog';
import {
    MY_STORE_FINANCE_QUERY,
    REFRESH_MY_STORE_EXCHANGE_RATE_MUTATION,
    REFRESH_MY_STORE_USDT_RATE_MUTATION,
    SUBMIT_MY_STORE_USDT_WALLET_MUTATION,
    UPDATE_MY_STORE_CURRENCY_MUTATION,
    type CurrencyConfigurationRecord,
    type FinanceData,
    type SupportedCurrency,
} from '../../graphql/store-finance.graphql';
import { useServerDraft } from '../../hooks/use-server-draft';
import { toUserFacingError } from '../../utils/user-facing-error';
import { formatDateTime, formatMoney } from '../Sales/sales-utils';
import {
    storePaymentMethodLabel,
    storePaymentSettlementLabel,
    storeUsdtPaymentIntentStatusLabel,
    storeUsdtWalletStatusLabel,
} from './store-usdt-utils';

interface CurrencyDraft {
    expectedUpdatedAt: string;
    defaultCurrencyCode: SupportedCurrency;
    availableCurrencyCodes: SupportedCurrency[];
    selectorEnabled: boolean;
    rateMode: 'AUTO' | 'MANUAL';
    cnyToMyrRate: number;
    markupPercent: number;
    roundingMode: 'CENT' | 'TENTH' | 'WHOLE';
    usdtDisplayEnabled: boolean;
    usdtMarkupPercent: number;
    usdtRateScheduleMode: 'INTERVAL' | 'DAILY';
    usdtRateIntervalMinutes: number;
    usdtRateDailyTime: string;
}

type ProtectedAction = 'save' | 'refresh-fiat' | 'refresh-usdt' | 'submit-wallet';

export function CurrencyAndRatesPanel() {
    const query = useQuery<FinanceData>(
        selectQueryFields(MY_STORE_FINANCE_QUERY, ['myStoreCurrencyConfiguration']),
        {},
    );
    const configuration = query.data?.myStoreCurrencyConfiguration;
    const serverDraft = useServerDraft<CurrencyDraft>(
        'currency-config',
        configuration?.updatedAt ?? '',
        configuration ? toDraft(configuration) : null,
    );
    const { draft, setDraft, dirty, sourceChanged } = serverDraft;
    const [protectedAction, setProtectedAction] = useState<ProtectedAction | null>(null);
    const [notice, setNotice] = useState('');
    const [error, setError] = useState('');
    const [saveConfig, saveState] = useMutation<{
        updateMyStoreCurrencyConfiguration: CurrencyConfigurationRecord;
    }>(UPDATE_MY_STORE_CURRENCY_MUTATION);
    const [refreshFiat, fiatState] = useMutation<{
        refreshMyStoreExchangeRate: CurrencyConfigurationRecord;
    }>(REFRESH_MY_STORE_EXCHANGE_RATE_MUTATION);
    const [refreshUsdt, usdtState] = useMutation<{
        refreshMyStoreUsdtRate: CurrencyConfigurationRecord;
    }>(REFRESH_MY_STORE_USDT_RATE_MUTATION);

    const loading = saveState.loading || fiatState.loading || usdtState.loading;

    if (query.loading && !configuration) return <PanelState label="正在读取币种与汇率…" />;
    if (query.error || !configuration || !draft) {
        return <PanelState tone="error" label="币种与汇率加载失败" action={() => void query.refetch()} />;
    }

    const update = <K extends keyof CurrencyDraft>(field: K, value: CurrencyDraft[K]) =>
        setDraft(current => (current ? { ...current, [field]: value } : current));
    const setDefaultCurrency = (currency: SupportedCurrency) => {
        setDraft(current =>
            current
                ? {
                      ...current,
                      defaultCurrencyCode: currency,
                      availableCurrencyCodes: [...new Set([...current.availableCurrencyCodes, currency])],
                  }
                : current,
        );
    };
    const toggleCurrency = (currency: SupportedCurrency) => {
        if (currency === draft.defaultCurrencyCode) return;
        update(
            'availableCurrencyCodes',
            draft.availableCurrencyCodes.includes(currency)
                ? draft.availableCurrencyCodes.filter(item => item !== currency)
                : [...draft.availableCurrencyCodes, currency],
        );
    };
    const execute = async (password: string) => {
        if (!protectedAction || (protectedAction === 'save' && sourceChanged)) return;
        setError('');
        setNotice('');
        try {
            if (protectedAction === 'save') {
                validateDraft(draft);
                const result = await saveConfig({
                    variables: { input: draft },
                    context: sensitiveActionContext(password),
                });
                const saved = result.data?.updateMyStoreCurrencyConfiguration as
                    CurrencyConfigurationRecord | undefined;
                if (!saved) throw new Error('后端未返回已保存配置');
                serverDraft.accept(toDraft(saved), saved.updatedAt);
                setNotice('币种、汇率和取整规则已保存');
            } else {
                const saved =
                    protectedAction === 'refresh-fiat'
                        ? (await refreshFiat({ context: sensitiveActionContext(password) })).data
                              ?.refreshMyStoreExchangeRate
                        : (await refreshUsdt({ context: sensitiveActionContext(password) })).data
                              ?.refreshMyStoreUsdtRate;
                if (!saved) throw new Error('后端未返回新汇率');
                if (!dirty) serverDraft.accept(toDraft(saved), saved.updatedAt);
                setNotice(protectedAction === 'refresh-fiat' ? '已更新 CNY/MYR 汇率' : '已更新 USDT 收购价');
            }
            setProtectedAction(null);
            try {
                await query.refetch();
            } catch {
                setError('操作已完成，但最新配置读取失败。请重试读取核对结果，勿重复提交。');
            }
        } catch (cause) {
            setError(toUserFacingError(cause, '敏感配置操作失败'));
        }
    };

    return (
        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
            {sourceChanged && <DraftUpdateNotice onReload={serverDraft.reload} />}
            <PanelHeading
                icon={<CircleDollarSign className="h-5 w-5 text-blue-600" />}
                title="网站币种与换算"
                description="设置主币、前台币种切换、CNY/MYR 汇率及 USDT 收购价采集计划。"
            />
            {notice && <Notice tone="success" message={notice} />}
            {error && !protectedAction && <Notice tone="error" message={error} />}
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <h3 className="col-span-full border-b border-slate-100 pb-2 text-xs font-bold text-slate-800">
                    币种设置
                </h3>
                <SelectField
                    label="网站主币"
                    value={draft.defaultCurrencyCode}
                    onChange={value => setDefaultCurrency(value as SupportedCurrency)}
                    options={[
                        ['CNY', '人民币 CNY'],
                        ['MYR', '马来西亚林吉 MYR'],
                    ]}
                />
                <ToggleField
                    label="允许客户切换币种"
                    checked={draft.selectorEnabled}
                    onChange={value => update('selectorEnabled', value)}
                />
                <AdminField label="可用币种">
                    <div className="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2">
                        {(['CNY', 'MYR'] as const).map(currency => (
                            <label
                                key={currency}
                                className="flex items-center gap-2 text-xs font-bold text-slate-700"
                            >
                                <AdminInput
                                    type="checkbox"
                                    checked={draft.availableCurrencyCodes.includes(currency)}
                                    disabled={currency === draft.defaultCurrencyCode}
                                    onChange={() => toggleCurrency(currency)}
                                />{' '}
                                {currency}
                            </label>
                        ))}
                    </div>
                </AdminField>
                <h3 className="col-span-full border-b border-slate-100 pb-2 pt-1 text-xs font-bold text-slate-800">
                    法币换算
                </h3>
                <SelectField
                    label="CNY/MYR 汇率模式"
                    value={draft.rateMode}
                    onChange={value => update('rateMode', value as CurrencyDraft['rateMode'])}
                    options={[
                        ['AUTO', '自动'],
                        ['MANUAL', '手动'],
                    ]}
                />
                <NumberField
                    label="1 CNY 兑换 MYR"
                    value={draft.cnyToMyrRate}
                    disabled={draft.rateMode === 'AUTO'}
                    step="0.0001"
                    onChange={value => update('cnyToMyrRate', value)}
                />
                <NumberField
                    label="汇率加价 (%)"
                    value={draft.markupPercent}
                    min={-20}
                    max={100}
                    onChange={value => update('markupPercent', value)}
                />
                <SelectField
                    label="换算后取整"
                    value={draft.roundingMode}
                    onChange={value => update('roundingMode', value as CurrencyDraft['roundingMode'])}
                    options={[
                        ['CENT', '分'],
                        ['TENTH', '角'],
                        ['WHOLE', '整数'],
                    ]}
                />
                <h3 className="col-span-full border-b border-slate-100 pb-2 pt-1 text-xs font-bold text-slate-800">
                    USDT 采集
                </h3>
                <ToggleField
                    label="前台启用 USDT 付款"
                    checked={draft.usdtDisplayEnabled}
                    onChange={value => update('usdtDisplayEnabled', value)}
                />
                <NumberField
                    label="USDT 加价 (%)"
                    value={draft.usdtMarkupPercent}
                    min={0}
                    max={20}
                    onChange={value => update('usdtMarkupPercent', value)}
                />
                <SelectField
                    label="USDT 采集计划"
                    value={draft.usdtRateScheduleMode}
                    onChange={value =>
                        update('usdtRateScheduleMode', value as CurrencyDraft['usdtRateScheduleMode'])
                    }
                    options={[
                        ['INTERVAL', '按间隔'],
                        ['DAILY', '每日定时'],
                    ]}
                />
                {draft.usdtRateScheduleMode === 'INTERVAL' ? (
                    <SelectField
                        label="采集间隔"
                        value={String(draft.usdtRateIntervalMinutes)}
                        onChange={value => update('usdtRateIntervalMinutes', Number(value))}
                        options={[5, 10, 15, 30, 60].map(value => [String(value), `${value} 分钟`])}
                    />
                ) : (
                    <AdminField className="text-xs font-bold text-slate-600" label="每日采集时间">
                        <AdminInput
                            type="time"
                            value={draft.usdtRateDailyTime}
                            onChange={event => update('usdtRateDailyTime', event.target.value)}
                            className={inputClass}
                        />
                    </AdminField>
                )}
            </div>
            <div
                className="admin-comparison-scroll overflow-x-auto rounded-lg border border-slate-200"
                role="region"
                aria-label="当前报价"
                tabIndex={0}
            >
                <p className="admin-mobile-table-hint">左右滑动查看完整报价</p>
                <table className="admin-compact-table w-full min-w-[800px] text-left text-xs">
                    <thead>
                        <tr>
                            {['报价', 'CNY', 'MYR', '来源', '更新时间'].map(label => (
                                <th key={label}>{label}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td className="font-semibold">1 CNY</td>
                            <td>1.0000</td>
                            <td>{configuration.cnyToMyrRate.toFixed(4)}</td>
                            <td
                                className="max-w-96 truncate"
                                title={
                                    systemFieldDisplayLabel('rateSource', configuration.rateSource) ??
                                    '尚未采集'
                                }
                            >
                                {systemFieldDisplayLabel('rateSource', configuration.rateSource) ??
                                    '尚未采集'}
                            </td>
                            <td>{date(configuration.rateUpdatedAt)}</td>
                        </tr>
                        <tr>
                            <td className="font-semibold">1 USDT</td>
                            <td>{configuration.cnyPerUsdtRate?.toFixed(4) ?? '—'}</td>
                            <td>{configuration.myrPerUsdtRate?.toFixed(4) ?? '—'}</td>
                            <td
                                className="max-w-96 truncate"
                                title={configuration.usdtRateSource ?? '尚未采集'}
                            >
                                {configuration.usdtRateSource ?? '尚未采集'}
                            </td>
                            <td>{date(configuration.usdtRateUpdatedAt)}</td>
                        </tr>
                    </tbody>
                </table>
            </div>
            <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
                <SecondaryButton
                    onClick={() => setProtectedAction('refresh-fiat')}
                    icon={<RefreshCw className="h-4 w-4" />}
                >
                    刷新法币汇率
                </SecondaryButton>
                <SecondaryButton
                    onClick={() => setProtectedAction('refresh-usdt')}
                    icon={<RefreshCw className="h-4 w-4" />}
                >
                    刷新 USDT 价格
                </SecondaryButton>
                <AdminButton
                    type="button"
                    onClick={() => setProtectedAction('save')}
                    disabled={!dirty || sourceChanged}
                    className={primaryButton}
                >
                    <Save className="h-4 w-4" />
                    保存配置
                </AdminButton>
            </div>
            <SensitiveActionDialog
                open={protectedAction !== null}
                title="确认执行币种与汇率操作"
                description="该操作会影响前台展示价格或客户付款金额。系统将使用当前管理员密码在后端再次验证。"
                confirmLabel="验证并执行"
                loading={loading}
                error={error}
                onClose={() => {
                    if (!loading) {
                        setProtectedAction(null);
                        setError('');
                    }
                }}
                onConfirm={execute}
            />
        </section>
    );
}

export function StoreUsdtPanel() {
    const standalonePage = useStandaloneAdminPage();
    const view = standalonePage?.detail ?? 'settings';
    const query = useQuery<FinanceData>(
        selectQueryFields(MY_STORE_FINANCE_QUERY, [
            'myStoreUsdtWallet',
            ...(view === 'payments'
                ? ['myStorePaymentStats', 'myStorePaymentDetails']
                : view === 'refunds'
                  ? ['myStoreUsdtManualRefunds']
                  : view === 'intents'
                    ? ['myStoreUsdtPaymentIntents', 'myStoreUsdtPaymentStats']
                    : []),
        ]),
        {},
    );
    const [address, setAddress] = useState('');
    const [dialogOpen, setDialogOpen] = useState(false);
    const [notice, setNotice] = useState('');
    const [error, setError] = useState('');
    const [submitWallet, submitState] = useMutation<{
        submitMyStoreUsdtWallet: FinanceData['myStoreUsdtWallet'];
    }>(SUBMIT_MY_STORE_USDT_WALLET_MUTATION);
    const wallet = query.data?.myStoreUsdtWallet;
    const stats = query.data?.myStoreUsdtPaymentStats;
    const intents = query.data?.myStoreUsdtPaymentIntents ?? [];
    const paymentStats = query.data?.myStorePaymentStats ?? [];

    const submit = async (password: string) => {
        setError('');
        try {
            const clean = validateTronAddress(address);
            const result = await submitWallet({
                variables: { receivingAddress: clean },
                context: sensitiveActionContext(password),
            });
            if (!result.data?.submitMyStoreUsdtWallet) throw new Error('后端未返回收款地址审核状态');
            setAddress('');
            setDialogOpen(false);
            setNotice('收款地址已加密保存并提交平台审核');
            await query.refetch();
        } catch (cause) {
            setError(toUserFacingError(cause, 'USDT 收款地址提交失败'));
        }
    };
    if (query.loading && !query.data) return <PanelState label="正在读取 USDT 收款配置…" />;
    if ((query.error && !query.data) || !wallet)
        return <PanelState tone="error" label="USDT 收款配置加载失败" action={() => void query.refetch()} />;

    return (
        <div className="space-y-4">
            {notice && <Notice tone="success" message={notice} />}
            {error && !dialogOpen && <Notice tone="error" message={error} />}
            {view === 'settings' && (
                <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
                    <PanelHeading
                        icon={<WalletCards className="h-5 w-5 text-emerald-600" />}
                        title="USDT TRC20 收款地址"
                        description="收款地址由平台管理中心统一配置，本店只查看状态。"
                    />
                    <div className="grid gap-3 md:grid-cols-3">
                        <Metric label="审核状态" value={storeUsdtWalletStatusLabel(wallet.reviewStatus)} />
                        <Metric
                            label="当前地址"
                            value={wallet.activeReceivingAddressMasked ?? '未配置'}
                            mono
                        />
                        <Metric
                            label="地址校验码"
                            value={wallet.activeReceivingAddressFingerprint ?? '—'}
                            mono
                        />
                    </div>
                    {wallet.rejectionReason && (
                        <Notice tone="error" message={`驳回原因：${wallet.rejectionReason}`} />
                    )}
                    <p className="text-xs text-slate-500">平台统一收款，本店支付开关在店铺设置管理。</p>
                </section>
            )}
            {view === 'payments' && (
                <section className="rounded-xl border border-slate-200 bg-white p-5">
                    <PanelHeading
                        title="收款概览"
                        description="按支付方式对账；受控模拟支付单列，不代表真实到账。"
                    />
                    <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        <Metric label="USDT 意向" value={stats ? String(stats.totalCount) : '未取得'} />
                        <Metric label="已到账" value={stats ? String(stats.settledCount) : '未取得'} />
                        <Metric label="待复核" value={stats ? String(stats.manualReviewCount) : '未取得'} />
                        <Metric
                            label="实收 USDT"
                            value={stats ? stats.receivedUsdtTotal.toFixed(6) : '未取得'}
                        />
                    </div>
                    <div
                        className="admin-comparison-scroll mt-4 overflow-x-auto"
                        role="region"
                        aria-label="支付方式收款概览"
                        tabIndex={0}
                    >
                        <p className="admin-mobile-table-hint">左右滑动比较支付方式</p>
                        <table className="admin-compact-table w-full min-w-[760px] text-left text-xs">
                            <thead>
                                <tr>
                                    {['支付方式', '币种', '收入类型', '收款金额', '退款金额', '净额'].map(
                                        label => (
                                            <th key={label}>{label}</th>
                                        ),
                                    )}
                                </tr>
                            </thead>
                            <tbody>
                                {paymentStats.map(item => (
                                    <tr key={`${item.paymentMethodCode}:${item.currencyCode}`}>
                                        <td className="font-semibold">
                                            {storePaymentMethodLabel(item.paymentMethodCode)}
                                        </td>
                                        <td>{item.currencyCode}</td>
                                        <td>{storePaymentSettlementLabel(item.paymentMethodCode)}</td>
                                        <td>{formatMoney(item.grossAmount, item.currencyCode)}</td>
                                        <td>{formatMoney(item.refundedAmount, item.currencyCode)}</td>
                                        <td className="font-semibold">
                                            {formatMoney(item.netAmount, item.currencyCode)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    {!paymentStats.length && (
                        <p className="py-6 text-center text-xs text-slate-500">暂无已结算支付</p>
                    )}
                </section>
            )}
            {view === 'intents' && (
                <section className="rounded-xl border border-slate-200 bg-white p-5">
                    <PanelHeading
                        title="USDT 最新收款意向"
                        description="显示报价、到账、过期与人工复核结果。"
                    />
                    <div
                        className="admin-comparison-scroll mt-4 overflow-x-auto"
                        role="region"
                        aria-label="USDT 收款意向"
                        tabIndex={0}
                    >
                        <p className="admin-mobile-table-hint">左右滑动查看完整收款意向</p>
                        <table className="admin-compact-table w-full min-w-[860px] text-left text-xs">
                            <thead>
                                <tr>
                                    {['订单', '状态', '报价 USDT', '创建时间', '交易号'].map(label => (
                                        <th key={label}>{label}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {intents.map(intent => (
                                    <tr key={intent.id}>
                                        <td className="font-semibold">{intent.orderCode}</td>
                                        <td>{storeUsdtPaymentIntentStatusLabel(intent.status)}</td>
                                        <td className="font-mono">{intent.expectedUsdtAmount.toFixed(6)}</td>
                                        <td>{formatDateTime(intent.createdAt)}</td>
                                        <td
                                            className="max-w-72 truncate font-mono"
                                            title={intent.transactionId ?? '尚无交易号'}
                                        >
                                            {intent.transactionId ?? '尚无交易号'}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    {!intents.length && (
                        <p className="py-8 text-center text-xs text-slate-500">暂无 USDT 收款记录</p>
                    )}
                </section>
            )}
            {view === 'payments' && (
                <section className="rounded-xl border border-slate-200 bg-white p-5">
                    <PanelHeading title="支付流水" description="仅显示本店支付明细。" />
                    <div
                        tabIndex={0}
                        role="region"
                        aria-label="收款财务明细"
                        className="admin-comparison-scroll mt-4 overflow-x-auto"
                    >
                        <p className="admin-mobile-table-hint">左右滑动查看完整收款财务明细</p>
                        <table className="admin-compact-table w-full min-w-[760px] text-left text-xs">
                            <thead>
                                <tr>
                                    {['订单', '支付方式', '状态', '金额', '创建时间'].map(label => (
                                        <th key={label} className="p-2">
                                            {label}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {(query.data?.myStorePaymentDetails?.items ?? []).map(item => (
                                    <tr key={item.id}>
                                        <td className="p-2">{item.orderCode}</td>
                                        <td>{storePaymentMethodLabel(item.paymentMethodCode)}</td>
                                        <td>{systemStatusDisplayLabel(item.paymentState)}</td>
                                        <td>{formatMoney(item.amount, item.currencyCode)}</td>
                                        <td>{formatDateTime(item.createdAt)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        {!query.data?.myStorePaymentDetails?.items.length && (
                            <p className="py-8 text-center text-xs text-slate-500">暂无支付记录</p>
                        )}
                    </div>
                </section>
            )}
            {view === 'refunds' && (
                <section className="rounded-xl border border-slate-200 bg-white p-5">
                    <PanelHeading title="人工退款审计" description="仅显示本店已登记的退款证据。" />
                    <div
                        className="admin-comparison-scroll mt-4 overflow-x-auto"
                        role="region"
                        aria-label="人工退款审计"
                        tabIndex={0}
                    >
                        <p className="admin-mobile-table-hint">左右滑动查看完整退款证据</p>
                        <table className="admin-compact-table w-full min-w-[760px] text-left text-xs">
                            <thead>
                                <tr>
                                    {['订单', '退款 USDT', '登记时间', '交易号'].map(label => (
                                        <th key={label}>{label}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {(query.data?.myStoreUsdtManualRefunds?.items ?? []).map(item => (
                                    <tr key={item.id}>
                                        <td className="font-semibold">{item.orderCode}</td>
                                        <td className="font-mono">{Number(item.usdtAmount).toFixed(6)}</td>
                                        <td>{formatDateTime(item.createdAt)}</td>
                                        <td
                                            className="max-w-72 truncate font-mono"
                                            title={item.transactionId}
                                        >
                                            {item.transactionId}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    {!query.data?.myStoreUsdtManualRefunds?.items.length && (
                        <p className="py-8 text-center text-xs text-slate-500">暂无退款记录</p>
                    )}
                </section>
            )}
            <SensitiveActionDialog
                open={dialogOpen}
                title="确认提交 USDT 收款地址"
                description="请核对网络为 TRC20。后端会验证当前管理员密码，审核通过前不会替换活动地址。"
                confirmLabel="验证并提交"
                loading={submitState.loading}
                error={error}
                onClose={() => {
                    if (!submitState.loading) {
                        setDialogOpen(false);
                        setError('');
                    }
                }}
                onConfirm={submit}
            />
        </div>
    );
}

function toDraft(value: CurrencyConfigurationRecord): CurrencyDraft {
    return {
        expectedUpdatedAt: value.updatedAt,
        defaultCurrencyCode: value.defaultCurrencyCode,
        availableCurrencyCodes: [...value.availableCurrencyCodes],
        selectorEnabled: value.selectorEnabled,
        rateMode: value.rateMode,
        cnyToMyrRate: value.cnyToMyrRate,
        markupPercent: value.markupPercent,
        roundingMode: value.roundingMode,
        usdtDisplayEnabled: value.usdtDisplayEnabled,
        usdtMarkupPercent: value.usdtMarkupPercent,
        usdtRateScheduleMode: value.usdtRateScheduleMode,
        usdtRateIntervalMinutes: value.usdtRateIntervalMinutes,
        usdtRateDailyTime: value.usdtRateDailyTime,
    };
}
function validateDraft(value: CurrencyDraft) {
    if (!value.availableCurrencyCodes.includes(value.defaultCurrencyCode))
        throw new Error('主币必须包含在可用币种中');
    if (!Number.isFinite(value.cnyToMyrRate) || value.cnyToMyrRate <= 0)
        throw new Error('CNY/MYR 汇率必须大于 0');
    if (value.markupPercent < -20 || value.markupPercent > 100)
        throw new Error('法币加价必须在 -20% 到 100% 之间');
    if (value.usdtMarkupPercent < 0 || value.usdtMarkupPercent > 20)
        throw new Error('USDT 加价必须在 0% 到 20% 之间');
    if (![5, 10, 15, 30, 60].includes(value.usdtRateIntervalMinutes)) throw new Error('USDT 采集间隔不合法');
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value.usdtRateDailyTime))
        throw new Error('USDT 每日采集时间不合法');
}
function validateTronAddress(value: string) {
    const clean = value.trim();
    if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(clean))
        throw new Error('请输入有效的 TRC20 地址（34 位，T 开头）');
    return clean;
}
function date(value: string | null) {
    return value ? formatDateTime(value) : '尚未执行';
}

const inputClass = 'mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal';
const primaryButton =
    'inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-xs font-bold text-white disabled:opacity-40';
function PanelHeading({
    icon,
    title,
    description,
}: {
    icon?: React.ReactNode;
    title: string;
    description: string;
}) {
    return (
        <div className="admin-section-title-line">
            <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                {icon}
                {title}
                <FeatureHelpButton topic="settings.finance" title={title} description={description} />
            </h2>
            <p className="text-xs text-slate-500">{description}</p>
        </div>
    );
}
function SelectField({
    label,
    value,
    onChange,
    options,
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    options: Array<readonly [string, string]>;
}) {
    return (
        <AdminField className="text-xs font-bold text-slate-600" label={label}>
            <AdminSelect
                value={value}
                onChange={event => onChange(event.target.value)}
                className={inputClass}
            >
                {options.map(([id, text]) => (
                    <option key={id} value={id}>
                        {text}
                    </option>
                ))}
            </AdminSelect>
        </AdminField>
    );
}
function NumberField({
    label,
    value,
    onChange,
    min = 0,
    max,
    step = '0.01',
    disabled = false,
}: {
    label: string;
    value: number;
    onChange: (value: number) => void;
    min?: number;
    max?: number;
    step?: string;
    disabled?: boolean;
}) {
    return (
        <AdminField className="text-xs font-bold text-slate-600" label={label}>
            <AdminInput
                type="number"
                value={value}
                min={min}
                max={max}
                step={step}
                disabled={disabled}
                onChange={event => onChange(Number(event.target.value))}
                className={`${inputClass} disabled:bg-slate-100`}
            />
        </AdminField>
    );
}
function ToggleField({
    label,
    checked,
    onChange,
}: {
    label: string;
    checked: boolean;
    onChange: (value: boolean) => void;
}) {
    return (
        <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2.5 text-xs font-bold text-slate-700">
            <AdminInput
                type="checkbox"
                checked={checked}
                onChange={event => onChange(event.target.checked)}
            />
            {label}
        </label>
    );
}
function SecondaryButton({
    onClick,
    icon,
    children,
}: {
    onClick: () => void;
    icon: React.ReactNode;
    children: React.ReactNode;
}) {
    return (
        <AdminButton
            type="button"
            onClick={onClick}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700"
        >
            {icon}
            {children}
        </AdminButton>
    );
}
function Metric({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
    return (
        <div className="rounded-lg border border-slate-200 p-3">
            <span className="text-xs text-slate-500">{label}</span>
            <strong className={`mt-1 block truncate text-sm text-slate-900 ${mono ? 'font-mono' : ''}`}>
                {value}
            </strong>
        </div>
    );
}
function Notice({ tone, message }: { tone: 'success' | 'error'; message: string }) {
    return (
        <div
            role={tone === 'error' ? 'alert' : 'status'}
            className={`rounded-lg border p-3 text-xs ${tone === 'error' ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}
        >
            {message}
        </div>
    );
}
function PanelState({
    label,
    tone = 'default',
    action,
}: {
    label: string;
    tone?: 'default' | 'error';
    action?: () => void;
}) {
    return (
        <div
            role={tone === 'error' ? 'alert' : 'status'}
            className={`rounded-xl border p-8 text-center text-sm ${tone === 'error' ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-slate-200 bg-white text-slate-500'}`}
        >
            <p>{label}</p>
            {action && (
                <AdminButton
                    type="button"
                    onClick={action}
                    className="mt-3 rounded-lg border px-3 py-2 text-xs font-bold"
                >
                    重试
                </AdminButton>
            )}
        </div>
    );
}
