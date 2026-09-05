import { useMutation, useQuery } from '@apollo/client/react';
import { CircleDollarSign, RefreshCw, Save, ShieldCheck, WalletCards } from 'lucide-react';
import { useEffect, useState } from 'react';

import { sensitiveActionContext } from '../../apollo';
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
import { useUnsavedChangesWarning } from '../../hooks/use-unsaved-changes-warning';
import { toUserFacingError } from '../../utils/user-facing-error';
import { resolveVersionedDraft } from '../../utils/versioned-draft';
import { formatDateTime, formatMoney } from '../Sales/sales-utils';
import {
    storePaymentMethodLabel,
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
    const query = useQuery<FinanceData>(MY_STORE_FINANCE_QUERY, { fetchPolicy: 'cache-and-network' });
    const configuration = query.data?.myStoreCurrencyConfiguration;
    const [storedDraft, setDraft] = useState<CurrencyDraft | null>(() =>
        configuration ? toDraft(configuration) : null,
    );
    const [draftSignature, setDraftSignature] = useState(configuration?.updatedAt ?? '');
    const draft = resolveVersionedDraft(
        configuration?.updatedAt ?? '',
        draftSignature,
        configuration ? toDraft(configuration) : null,
        storedDraft,
    );
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

    /* oxlint-disable react/set-state-in-effect -- the versioned finance response initializes the edit draft. */
    useEffect(() => {
        if (!configuration || configuration.updatedAt === draftSignature) return;
        setDraft(toDraft(configuration));
        setDraftSignature(configuration.updatedAt);
    }, [configuration, draftSignature]);
    /* oxlint-enable react/set-state-in-effect */
    const dirty = Boolean(
        configuration && draft && JSON.stringify(draft) !== JSON.stringify(toDraft(configuration)),
    );
    useUnsavedChangesWarning(dirty, '币种与汇率尚未保存，确定离开？');
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
        if (!protectedAction) return;
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
                setDraft(toDraft(saved));
                setNotice('币种、汇率和取整规则已保存');
            } else {
                const saved =
                    protectedAction === 'refresh-fiat'
                        ? (await refreshFiat({ context: sensitiveActionContext(password) })).data
                              ?.refreshMyStoreExchangeRate
                        : (await refreshUsdt({ context: sensitiveActionContext(password) })).data
                              ?.refreshMyStoreUsdtRate;
                if (!saved) throw new Error('后端未返回新汇率');
                setDraft(toDraft(saved));
                setNotice(protectedAction === 'refresh-fiat' ? '已更新 CNY/MYR 汇率' : '已更新 USDT 收购价');
            }
            setProtectedAction(null);
            await query.refetch();
        } catch (cause) {
            setError(toUserFacingError(cause, '敏感配置操作失败'));
        }
    };

    return (
        <section className="space-y-5 rounded-xl border border-slate-200 bg-white p-5">
            <PanelHeading
                icon={<CircleDollarSign className="h-5 w-5 text-blue-600" />}
                title="网站币种与换算"
                description="设置主币、前台币种切换、CNY/MYR 汇率及 USDT 收购价采集计划。"
            />
            {notice && <Notice tone="success" message={notice} />}
            {error && !protectedAction && <Notice tone="error" message={error} />}
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
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
                <div className="flex items-end gap-3 rounded-lg border border-slate-200 px-3 py-2">
                    {(['CNY', 'MYR'] as const).map(currency => (
                        <label
                            key={currency}
                            className="flex items-center gap-2 text-xs font-bold text-slate-700"
                        >
                            <input
                                type="checkbox"
                                checked={draft.availableCurrencyCodes.includes(currency)}
                                disabled={currency === draft.defaultCurrencyCode}
                                onChange={() => toggleCurrency(currency)}
                            />{' '}
                            {currency}
                        </label>
                    ))}
                </div>
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
                <ToggleField
                    label="前台显示 USDT 参考价"
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
                    <label className="text-xs font-bold text-slate-600">
                        每日采集时间
                        <input
                            type="time"
                            value={draft.usdtRateDailyTime}
                            onChange={event => update('usdtRateDailyTime', event.target.value)}
                            className={inputClass}
                        />
                    </label>
                )}
            </div>
            <div className="grid gap-3 rounded-xl bg-slate-50 p-4 text-xs text-slate-600 md:grid-cols-2">
                <p>
                    <strong className="block text-slate-900">CNY/MYR</strong>1 CNY ={' '}
                    {configuration.cnyToMyrRate.toFixed(4)} MYR
                    <br />
                    {configuration.rateSource ?? '尚未采集'} · {date(configuration.rateUpdatedAt)}
                </p>
                <p>
                    <strong className="block text-slate-900">USDT</strong>CNY{' '}
                    {configuration.cnyPerUsdtRate?.toFixed(4) ?? '—'} / MYR{' '}
                    {configuration.myrPerUsdtRate?.toFixed(4) ?? '—'}
                    <br />
                    {configuration.usdtRateSource ?? '尚未采集'} · {date(configuration.usdtRateUpdatedAt)}
                </p>
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
                <button
                    type="button"
                    onClick={() => setProtectedAction('save')}
                    disabled={!dirty}
                    className={primaryButton}
                >
                    <Save className="h-4 w-4" />
                    保存配置
                </button>
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
    const query = useQuery<FinanceData>(MY_STORE_FINANCE_QUERY, { fetchPolicy: 'cache-and-network' });
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
    if (query.error || !wallet)
        return <PanelState tone="error" label="USDT 收款配置加载失败" action={() => void query.refetch()} />;

    return (
        <div className="space-y-4">
            {notice && <Notice tone="success" message={notice} />}
            {error && !dialogOpen && <Notice tone="error" message={error} />}
            <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
                <PanelHeading
                    icon={<WalletCards className="h-5 w-5 text-emerald-600" />}
                    title="USDT TRC20 收款地址"
                    description="新地址提交后须经超级管理员审核；激活前不会影响现有收款。"
                />
                <div className="grid gap-3 md:grid-cols-3">
                    <Metric label="审核状态" value={storeUsdtWalletStatusLabel(wallet.reviewStatus)} />
                    <Metric label="当前地址" value={wallet.activeReceivingAddressMasked ?? '未配置'} mono />
                    <Metric label="地址校验码" value={wallet.activeReceivingAddressFingerprint ?? '—'} mono />
                </div>
                {wallet.rejectionReason && (
                    <Notice tone="error" message={`驳回原因：${wallet.rejectionReason}`} />
                )}
                <div className="flex flex-col gap-2 sm:flex-row">
                    <input
                        value={address}
                        onChange={event => setAddress(event.target.value.trim())}
                        placeholder="T 开头的 TRC20 收款地址"
                        className={`${inputClass} flex-1 font-mono`}
                    />
                    <button
                        type="button"
                        onClick={() => {
                            setError('');
                            setDialogOpen(true);
                        }}
                        disabled={!address}
                        className={primaryButton}
                    >
                        <ShieldCheck className="h-4 w-4" />
                        提交审核
                    </button>
                </div>
            </section>
            <section className="rounded-xl border border-slate-200 bg-white p-5">
                <PanelHeading title="收款概览" description="同时对账 USDT 链上意向与所有支付方式净收。" />
                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <Metric label="USDT 意向" value={String(stats?.totalCount ?? 0)} />
                    <Metric label="已到账" value={String(stats?.settledCount ?? 0)} />
                    <Metric label="待复核" value={String(stats?.manualReviewCount ?? 0)} />
                    <Metric label="实收 USDT" value={(stats?.receivedUsdtTotal ?? 0).toFixed(6)} />
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {paymentStats.map(item => (
                        <article
                            key={`${item.paymentMethodCode}:${item.currencyCode}`}
                            className="rounded-lg border border-slate-200 p-3 text-xs"
                        >
                            <strong title={`系统标识：${item.paymentMethodCode}`}>
                                {storePaymentMethodLabel(item.paymentMethodCode)}
                            </strong>
                            <span className="ml-2 text-slate-500">{item.currencyCode}</span>
                            <b className="mt-2 block text-lg">
                                {formatMoney(item.netAmount, item.currencyCode)}
                            </b>
                            <small className="text-slate-500">
                                实收 {formatMoney(item.grossAmount, item.currencyCode)} · 退款{' '}
                                {formatMoney(item.refundedAmount, item.currencyCode)}
                            </small>
                        </article>
                    ))}
                    {!paymentStats.length && <p className="text-xs text-slate-500">暂无已结算支付</p>}
                </div>
            </section>
            <section className="rounded-xl border border-slate-200 bg-white p-5">
                <PanelHeading title="USDT 最新收款意向" description="显示报价、到账、过期与人工复核结果。" />
                <div className="mt-4 max-h-[34rem] space-y-2 overflow-auto">
                    {intents.map(intent => (
                        <article
                            key={intent.id}
                            className="flex flex-col gap-2 rounded-lg border border-slate-200 p-3 text-xs sm:flex-row sm:items-center sm:justify-between"
                        >
                            <span>
                                <strong>订单 {intent.orderCode}</strong>
                                <small className="ml-2 text-slate-500">
                                    <span title={`系统状态：${intent.status}`}>
                                        {storeUsdtPaymentIntentStatusLabel(intent.status)}
                                    </span>{' '}
                                    · {formatDateTime(intent.createdAt)}
                                </small>
                                <span className="mt-1 block font-mono text-[10px] text-slate-500">
                                    {intent.transactionId ?? '尚无交易号'}
                                </span>
                            </span>
                            <b>{intent.expectedUsdtAmount.toFixed(6)} USDT</b>
                        </article>
                    ))}
                    {!intents.length && (
                        <p className="py-8 text-center text-xs text-slate-500">暂无 USDT 收款记录</p>
                    )}
                </div>
            </section>
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
        <div>
            <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                {icon}
                {title}
                <FeatureHelpButton topic="settings.finance" title={title} />
            </h2>
            <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>
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
        <label className="text-xs font-bold text-slate-600">
            {label}
            <select value={value} onChange={event => onChange(event.target.value)} className={inputClass}>
                {options.map(([id, text]) => (
                    <option key={id} value={id}>
                        {text}
                    </option>
                ))}
            </select>
        </label>
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
        <label className="text-xs font-bold text-slate-600">
            {label}
            <input
                type="number"
                value={value}
                min={min}
                max={max}
                step={step}
                disabled={disabled}
                onChange={event => onChange(Number(event.target.value))}
                className={`${inputClass} disabled:bg-slate-100`}
            />
        </label>
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
            <input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} />
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
        <button
            type="button"
            onClick={onClick}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700"
        >
            {icon}
            {children}
        </button>
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
                <button
                    type="button"
                    onClick={action}
                    className="mt-3 rounded-lg border px-3 py-2 text-xs font-bold"
                >
                    重试
                </button>
            )}
        </div>
    );
}
