import { useMutation, useQuery } from '@apollo/client/react';
import {
    AlertCircle,
    CheckCircle2,
    Clock3,
    LoaderCircle,
    RefreshCw,
    Save,
    ShieldCheck,
    WalletCards,
    XCircle,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import { useConfirmDialog } from '../../components/confirm-dialog-context';
import {
    PLATFORM_USDT_WALLETS_QUERY,
    REFRESH_STORE_USDT_RATE_MUTATION,
    REVIEW_STORE_USDT_WALLET_MUTATION,
    STORE_USDT_SETUP_QUERY,
    SUBMIT_STORE_USDT_WALLET_MUTATION,
    UPDATE_STORE_USDT_CONFIGURATION_MUTATION,
    type PlatformUsdtWalletsResult,
    type RefreshStoreUsdtRateResult,
    type ReviewStoreUsdtWalletResult,
    type StoreUsdtConfigurationDraft,
    type StoreUsdtSetupResult,
    type StoreUsdtWalletRecord,
    type SubmitStoreUsdtWalletResult,
    type UpdateStoreUsdtConfigurationResult,
} from '../../graphql/store-usdt.graphql';
import { useAdminPermissions } from '../../hooks/use-admin-permissions';
import { toUserFacingError } from '../../utils/user-facing-error';
import {
    buildStoreUsdtConfigurationInput,
    isPlausibleTronMainnetAddress,
    storeUsdtConfigurationChanged,
    storeUsdtWalletStatusLabel,
    toStoreUsdtConfigurationDraft,
    validateStoreUsdtConfigurationDraft,
} from './store-usdt-utils';

const intervalOptions = [5, 10, 15, 30, 60] as const;
const inputClass =
    'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100 disabled:text-slate-400';
const primaryButton =
    'inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50';
const secondaryButton =
    'inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50';

export function UsdtPaymentSetupPanel({
    onChanged,
    onError,
}: {
    onChanged: (message: string) => Promise<void>;
    onError: (message: string) => void;
}) {
    const requestConfirmation = useConfirmDialog();
    const { hasAnyPermission } = useAdminPermissions();
    const canRead = hasAnyPermission(['ReadStoreProfile']);
    const canUpdate = hasAnyPermission(['UpdateStoreProfile']);
    const isSuperAdmin = hasAnyPermission(['SuperAdmin']);
    const [draftOverride, setDraftOverride] = useState<{
        channelId: string;
        updatedAt: string;
        value: StoreUsdtConfigurationDraft;
    } | null>(null);
    const [walletAddress, setWalletAddress] = useState('');
    const [rejectionReasons, setRejectionReasons] = useState<Record<string, string>>({});

    const setupQuery = useQuery<StoreUsdtSetupResult>(STORE_USDT_SETUP_QUERY, {
        skip: !canRead,
        fetchPolicy: 'cache-and-network',
        notifyOnNetworkStatusChange: true,
    });
    const platformWalletsQuery = useQuery<PlatformUsdtWalletsResult>(PLATFORM_USDT_WALLETS_QUERY, {
        skip: !isSuperAdmin,
        fetchPolicy: 'cache-and-network',
        notifyOnNetworkStatusChange: true,
    });
    const [updateConfiguration, updateState] = useMutation<UpdateStoreUsdtConfigurationResult>(
        UPDATE_STORE_USDT_CONFIGURATION_MUTATION,
    );
    const [refreshRate, refreshState] = useMutation<RefreshStoreUsdtRateResult>(
        REFRESH_STORE_USDT_RATE_MUTATION,
    );
    const [submitWallet, submitState] = useMutation<SubmitStoreUsdtWalletResult>(
        SUBMIT_STORE_USDT_WALLET_MUTATION,
    );
    const [reviewWallet, reviewState] = useMutation<ReviewStoreUsdtWalletResult>(
        REVIEW_STORE_USDT_WALLET_MUTATION,
    );

    const configuration = setupQuery.data?.myStoreCurrencyConfiguration;
    const wallet = setupQuery.data?.myStoreUsdtWallet;
    const draft = configuration
        ? draftOverride?.channelId === configuration.channelId &&
          draftOverride.updatedAt === configuration.updatedAt
            ? draftOverride.value
            : toStoreUsdtConfigurationDraft(configuration)
        : null;
    const pendingWallets = useMemo(
        () =>
            (platformWalletsQuery.data?.storeUsdtWallets ?? []).filter(
                candidate => candidate.reviewStatus === 'PENDING',
            ),
        [platformWalletsQuery.data?.storeUsdtWallets],
    );
    const dirty = Boolean(configuration && draft && storeUsdtConfigurationChanged(configuration, draft));
    const busy = updateState.loading || refreshState.loading || submitState.loading || reviewState.loading;

    if (!canRead) return null;

    const updateDraft = (update: (current: StoreUsdtConfigurationDraft) => StoreUsdtConfigurationDraft) => {
        if (!configuration || !draft) return;
        setDraftOverride({
            channelId: configuration.channelId,
            updatedAt: configuration.updatedAt,
            value: update(draft),
        });
    };

    const refreshPanels = async (message: string) => {
        await setupQuery.refetch();
        if (isSuperAdmin) await platformWalletsQuery.refetch();
        await onChanged(message);
    };

    const saveConfiguration = async () => {
        if (!configuration || !draft || updateState.loading) return;
        const validationMessage = validateStoreUsdtConfigurationDraft(draft);
        if (validationMessage) return onError(validationMessage);
        try {
            const response = await updateConfiguration({
                variables: { input: buildStoreUsdtConfigurationInput(configuration, draft) },
            });
            if (!response.data?.updateMyStoreCurrencyConfiguration) {
                throw new Error('后端未返回更新后的 USDT 配置');
            }
            setDraftOverride(null);
            await refreshPanels('USDT 报价配置已保存');
        } catch (error) {
            onError(toUserFacingError(error, 'USDT 报价配置保存失败，请刷新后重试'));
        }
    };

    const refreshUsdtRate = async () => {
        if (dirty) return onError('请先保存 USDT 报价配置，再刷新汇率');
        try {
            const response = await refreshRate();
            if (!response.data?.refreshMyStoreUsdtRate) throw new Error('后端未返回更新后的 USDT 汇率');
            setDraftOverride(null);
            await refreshPanels('USDT 汇率已刷新');
        } catch (error) {
            onError(toUserFacingError(error, 'USDT 汇率刷新失败，请稍后重试'));
        }
    };

    const submitReceivingAddress = async () => {
        const receivingAddress = walletAddress.trim();
        if (!isPlausibleTronMainnetAddress(receivingAddress)) {
            return onError('请输入有效的 TRON 主网收款地址（T 开头，共 34 位）');
        }
        const confirmed = await requestConfirmation({
            title: wallet?.configured ? '提交新的 USDT 收款地址' : '提交 USDT 收款地址',
            description: wallet?.configured
                ? '新地址审核通过前，当前已启用地址仍继续用于新订单。请确认只提交钱包公钥地址。'
                : '提交后需由平台 SuperAdmin 核对并审核，通过前不会向客户开放 USDT 收款。',
            confirmLabel: '提交审核',
            tone: 'warning',
        });
        if (!confirmed) return;
        try {
            await submitWallet({ variables: { receivingAddress } });
            setWalletAddress('');
            await refreshPanels('USDT 收款地址已提交，等待平台审核');
        } catch (error) {
            onError(toUserFacingError(error, 'USDT 收款地址提交失败'));
        }
    };

    const decideWallet = async (candidate: StoreUsdtWalletRecord, approved: boolean) => {
        if (!candidate.canReview) {
            return onError('当前账号提交的地址不能自审，请使用另一名 SuperAdmin 账号完成复核');
        }
        const rejectionReason = rejectionReasons[candidate.channelId]?.trim() ?? '';
        if (!approved && !rejectionReason) return onError('驳回 USDT 收款地址时必须填写原因');
        const confirmed = await requestConfirmation({
            title: approved ? '审核通过 USDT 收款地址' : '驳回 USDT 收款地址',
            description: approved
                ? `通过后，店铺 ${candidate.channelCode} 的新 USDT 订单将向该地址付款。请确认已与钱包 App 和地址指纹交叉核对。`
                : `确认驳回店铺 ${candidate.channelCode} 提交的地址？商家将看到驳回原因。`,
            confirmLabel: approved ? '确认通过' : '确认驳回',
            tone: approved ? 'warning' : 'danger',
        });
        if (!confirmed) return;
        try {
            await reviewWallet({
                variables: {
                    input: {
                        channelId: candidate.channelId,
                        approved,
                        ...(approved ? {} : { rejectionReason }),
                    },
                },
            });
            setRejectionReasons(current => {
                const next = { ...current };
                delete next[candidate.channelId];
                return next;
            });
            await refreshPanels(approved ? 'USDT 收款地址已审核启用' : 'USDT 收款地址已驳回');
        } catch (error) {
            onError(toUserFacingError(error, 'USDT 收款地址审核失败'));
        }
    };

    return (
        <section className="overflow-hidden rounded-xl border border-emerald-200 bg-white">
            <div className="flex flex-col gap-3 border-b border-emerald-100 bg-emerald-50 p-5 sm:flex-row sm:items-start sm:justify-between">
                <div>
                    <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                        <WalletCards className="h-4 w-4 text-emerald-600" /> USDT-TRC20 收款
                        <FeatureHelpButton topic="settings.usdt" title="USDT-TRC20 收款" />
                    </h2>
                    <p className="mt-1 text-xs leading-5 text-slate-500">
                        收款地址审核通过后，系统会自动为当前店铺分配 USDT 支付方式，无需在上方手工新增。
                    </p>
                </div>
                {wallet && <WalletStatusBadge status={wallet.reviewStatus} />}
            </div>

            {setupQuery.loading && !setupQuery.data ? (
                <div className="flex items-center justify-center gap-2 p-10 text-xs text-slate-500">
                    <LoaderCircle className="h-4 w-4 animate-spin" /> 正在加载 USDT 配置
                </div>
            ) : setupQuery.error ? (
                <div className="p-5">
                    <InlineAlert tone="error">
                        {toUserFacingError(setupQuery.error, 'USDT 配置加载失败，请重试')}
                    </InlineAlert>
                    <button
                        type="button"
                        className={`${secondaryButton} mt-3`}
                        onClick={() => void setupQuery.refetch()}
                    >
                        <RefreshCw className="h-3.5 w-3.5" /> 重试
                    </button>
                </div>
            ) : configuration && wallet && draft ? (
                <div className="space-y-6 p-5">
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                        <Metric label="当前店铺" value={configuration.channelCode} />
                        <Metric
                            label="链上网络"
                            value={`${configuration.usdtPaymentNetwork || 'TRC20'} · 官方 USDT`}
                        />
                        <Metric label="收款地址" value={wallet.activeReceivingAddressMasked ?? '尚未启用'} />
                        <Metric
                            label="结账报价"
                            value={configuration.usdtRateAvailable ? '当前可用' : '尚不可用'}
                            tone={configuration.usdtRateAvailable ? 'success' : 'warning'}
                        />
                    </div>

                    <div className="grid gap-5 xl:grid-cols-2">
                        <section className="space-y-4 rounded-xl border border-slate-200 p-4">
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <h3 className="flex items-center gap-2 text-xs font-bold text-slate-900">
                                        报价与汇率
                                        <FeatureHelpButton topic="settings.usdt" title="USDT 报价与汇率" />
                                    </h3>
                                    <p className="mt-1 text-[10px] leading-4 text-slate-500">
                                        开启后，客户可按锁定汇率生成 10 分钟有效的 USDT 付款报价。
                                    </p>
                                </div>
                                <label className="flex shrink-0 items-center gap-2 text-[10px] font-bold text-slate-600">
                                    <input
                                        type="checkbox"
                                        checked={draft.usdtDisplayEnabled}
                                        disabled={!canUpdate || busy}
                                        onChange={event =>
                                            updateDraft(current => ({
                                                ...current,
                                                usdtDisplayEnabled: event.target.checked,
                                            }))
                                        }
                                    />
                                    启用报价
                                </label>
                            </div>

                            <div className="grid gap-3 sm:grid-cols-2">
                                <Field label="CNY / USDT">
                                    <OutputValue value={formatRate(configuration.cnyPerUsdtRate, '¥')} />
                                </Field>
                                <Field label="MYR / USDT">
                                    <OutputValue value={formatRate(configuration.myrPerUsdtRate, 'RM ')} />
                                </Field>
                                <Field label="报价加价（%）">
                                    <input
                                        type="number"
                                        min={0}
                                        max={20}
                                        step="0.01"
                                        value={draft.usdtMarkupPercent}
                                        disabled={!canUpdate || busy}
                                        onChange={event =>
                                            updateDraft(current => ({
                                                ...current,
                                                usdtMarkupPercent: Number(event.target.value),
                                            }))
                                        }
                                        className={inputClass}
                                    />
                                </Field>
                                <Field label="自动采集方式">
                                    <select
                                        value={draft.usdtRateScheduleMode}
                                        disabled={!canUpdate || busy}
                                        onChange={event =>
                                            updateDraft(current => ({
                                                ...current,
                                                usdtRateScheduleMode: event.target.value as
                                                    'INTERVAL' | 'DAILY',
                                            }))
                                        }
                                        className={inputClass}
                                    >
                                        <option value="INTERVAL">按分钟间隔</option>
                                        <option value="DAILY">每天固定时间</option>
                                    </select>
                                </Field>
                                {draft.usdtRateScheduleMode === 'INTERVAL' ? (
                                    <Field label="采集间隔">
                                        <select
                                            value={draft.usdtRateIntervalMinutes}
                                            disabled={!canUpdate || busy}
                                            onChange={event =>
                                                updateDraft(current => ({
                                                    ...current,
                                                    usdtRateIntervalMinutes: Number(event.target.value),
                                                }))
                                            }
                                            className={inputClass}
                                        >
                                            {intervalOptions.map(minutes => (
                                                <option key={minutes} value={minutes}>
                                                    {minutes === 60 ? '每 1 小时' : `每 ${minutes} 分钟`}
                                                </option>
                                            ))}
                                        </select>
                                    </Field>
                                ) : (
                                    <Field label="每日采集时间（北京时间）">
                                        <input
                                            type="time"
                                            value={draft.usdtRateDailyTime}
                                            disabled={!canUpdate || busy}
                                            onChange={event =>
                                                updateDraft(current => ({
                                                    ...current,
                                                    usdtRateDailyTime: event.target.value,
                                                }))
                                            }
                                            className={inputClass}
                                        />
                                    </Field>
                                )}
                            </div>

                            <div className="rounded-lg bg-slate-50 p-3 text-[10px] leading-5 text-slate-500">
                                <div>来源：{configuration.usdtRateSource ?? '尚未采集'}</div>
                                <div>最近更新：{formatDateTime(configuration.usdtRateUpdatedAt)}</div>
                                <div>报价有效至：{formatDateTime(configuration.usdtRateExpiresAt)}</div>
                            </div>

                            {draft.usdtRateScheduleMode === 'DAILY' && (
                                <InlineAlert tone="warning">
                                    每日模式可能导致报价接近 24 小时不变，真实收款建议使用 5–15 分钟间隔。
                                </InlineAlert>
                            )}

                            {canUpdate && (
                                <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4">
                                    <button
                                        type="button"
                                        className={secondaryButton}
                                        disabled={busy || dirty}
                                        onClick={() => void refreshUsdtRate()}
                                    >
                                        <RefreshCw
                                            className={`h-3.5 w-3.5 ${refreshState.loading ? 'animate-spin' : ''}`}
                                        />
                                        立即刷新汇率
                                    </button>
                                    <button
                                        type="button"
                                        className={primaryButton}
                                        disabled={busy || !dirty}
                                        onClick={() => void saveConfiguration()}
                                    >
                                        <Save className="h-3.5 w-3.5" /> 保存报价配置
                                    </button>
                                </div>
                            )}
                        </section>

                        <section className="space-y-4 rounded-xl border border-slate-200 p-4">
                            <div>
                                <h3 className="flex items-center gap-2 text-xs font-bold text-slate-900">
                                    本网店收款钱包
                                    <FeatureHelpButton topic="settings.usdt" title="本网店收款钱包" />
                                </h3>
                                <p className="mt-1 text-[10px] leading-4 text-slate-500">
                                    只填写 TRON 主网公钥地址。禁止提交私钥、助记词、钱包密码或付款密钥。
                                </p>
                            </div>

                            <div className="grid gap-3 text-[10px] sm:grid-cols-2">
                                <Metric
                                    label="审核状态"
                                    value={storeUsdtWalletStatusLabel(wallet.reviewStatus)}
                                />
                                <Metric
                                    label="已启用地址"
                                    value={wallet.activeReceivingAddressMasked ?? '无'}
                                />
                                <Metric
                                    label="地址指纹"
                                    value={shortFingerprint(wallet.activeReceivingAddressFingerprint)}
                                />
                                <Metric label="审核时间" value={formatDateTime(wallet.reviewedAt)} />
                            </div>

                            {wallet.pendingReceivingAddress && (
                                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-[10px] leading-5 text-amber-900">
                                    <strong className="block">待审核地址</strong>
                                    <code className="block break-all">{wallet.pendingReceivingAddress}</code>
                                    <span className="block break-all text-amber-700">
                                        指纹：{wallet.pendingReceivingAddressFingerprint}
                                    </span>
                                </div>
                            )}

                            {wallet.rejectionReason && (
                                <InlineAlert tone="error">驳回原因：{wallet.rejectionReason}</InlineAlert>
                            )}

                            {canUpdate && (
                                <div className="space-y-2 border-t border-slate-100 pt-4">
                                    <Field
                                        label={
                                            wallet.configured ? '更换 TRON 主网收款地址' : 'TRON 主网收款地址'
                                        }
                                    >
                                        <input
                                            value={walletAddress}
                                            maxLength={64}
                                            autoComplete="off"
                                            spellCheck={false}
                                            placeholder="T..."
                                            disabled={busy}
                                            onChange={event => setWalletAddress(event.target.value)}
                                            className={inputClass}
                                        />
                                    </Field>
                                    {walletAddress && !isPlausibleTronMainnetAddress(walletAddress) && (
                                        <p className="text-[10px] text-rose-600">
                                            地址应以 T 开头并包含 34 个 TRON Base58
                                            字符，最终校验由服务器完成。
                                        </p>
                                    )}
                                    <div className="flex justify-end">
                                        <button
                                            type="button"
                                            className={primaryButton}
                                            disabled={busy || !isPlausibleTronMainnetAddress(walletAddress)}
                                            onClick={() => void submitReceivingAddress()}
                                        >
                                            <ShieldCheck className="h-3.5 w-3.5" /> 提交平台审核
                                        </button>
                                    </div>
                                </div>
                            )}
                        </section>
                    </div>

                    {isSuperAdmin && (
                        <section className="space-y-4 rounded-xl border border-blue-200 bg-blue-50/40 p-4">
                            <div>
                                <h3 className="flex items-center gap-2 text-xs font-bold text-slate-900">
                                    <ShieldCheck className="h-4 w-4 text-blue-600" /> 平台待审核收款地址
                                    <FeatureHelpButton topic="settings.usdt" title="平台待审核收款地址" />
                                </h3>
                                <p className="mt-1 text-[10px] leading-4 text-slate-500">
                                    应由未参与地址提交的第二名 SuperAdmin 对照钱包 App 完整地址和指纹复核。
                                </p>
                            </div>

                            {platformWalletsQuery.loading && !platformWalletsQuery.data ? (
                                <div className="flex items-center gap-2 text-xs text-slate-500">
                                    <LoaderCircle className="h-4 w-4 animate-spin" /> 正在加载待审核地址
                                </div>
                            ) : platformWalletsQuery.error ? (
                                <InlineAlert tone="error">
                                    {toUserFacingError(platformWalletsQuery.error, '待审核地址加载失败')}
                                </InlineAlert>
                            ) : pendingWallets.length ? (
                                <div className="grid gap-3 xl:grid-cols-2">
                                    {pendingWallets.map(candidate => (
                                        <article
                                            key={candidate.channelId}
                                            className="space-y-3 rounded-lg border border-blue-200 bg-white p-4"
                                        >
                                            <div className="flex items-center justify-between gap-3">
                                                <strong className="text-xs text-slate-900">
                                                    {candidate.channelCode}
                                                </strong>
                                                <WalletStatusBadge status={candidate.reviewStatus} />
                                            </div>
                                            <div className="space-y-1 text-[10px] leading-5 text-slate-600">
                                                <div className="break-all">
                                                    地址：
                                                    <code className="font-bold text-slate-900">
                                                        {candidate.pendingReceivingAddress}
                                                    </code>
                                                </div>
                                                <div className="break-all">
                                                    指纹：{candidate.pendingReceivingAddressFingerprint}
                                                </div>
                                                <div>提交时间：{formatDateTime(candidate.submittedAt)}</div>
                                            </div>
                                            {!candidate.canReview && (
                                                <InlineAlert tone="warning">
                                                    当前账号是该地址的提交人，不能自审。请使用另一名
                                                    SuperAdmin 账号完成复核。
                                                </InlineAlert>
                                            )}
                                            <input
                                                value={rejectionReasons[candidate.channelId] ?? ''}
                                                maxLength={500}
                                                placeholder="驳回原因（驳回时必填）"
                                                disabled={busy || !candidate.canReview}
                                                onChange={event =>
                                                    setRejectionReasons(current => ({
                                                        ...current,
                                                        [candidate.channelId]: event.target.value,
                                                    }))
                                                }
                                                className={inputClass}
                                            />
                                            <div className="flex justify-end gap-2">
                                                <button
                                                    type="button"
                                                    disabled={busy || !candidate.canReview}
                                                    onClick={() => void decideWallet(candidate, false)}
                                                    className="inline-flex items-center gap-1.5 rounded-lg border border-rose-300 bg-white px-3 py-2 text-xs font-bold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                                                >
                                                    <XCircle className="h-3.5 w-3.5" /> 驳回
                                                </button>
                                                <button
                                                    type="button"
                                                    disabled={busy || !candidate.canReview}
                                                    onClick={() => void decideWallet(candidate, true)}
                                                    className={primaryButton}
                                                >
                                                    <CheckCircle2 className="h-3.5 w-3.5" /> 审核通过
                                                </button>
                                            </div>
                                        </article>
                                    ))}
                                </div>
                            ) : (
                                <div className="rounded-lg border border-dashed border-blue-200 bg-white p-6 text-center text-xs text-slate-500">
                                    暂无待审核的 USDT 收款地址
                                </div>
                            )}
                        </section>
                    )}
                </div>
            ) : null}
        </section>
    );
}

function WalletStatusBadge({ status }: { status: StoreUsdtWalletRecord['reviewStatus'] }) {
    const style =
        status === 'ACTIVE'
            ? 'bg-emerald-100 text-emerald-700'
            : status === 'PENDING'
              ? 'bg-amber-100 text-amber-700'
              : status === 'REJECTED'
                ? 'bg-rose-100 text-rose-700'
                : 'bg-slate-100 text-slate-600';
    const Icon =
        status === 'ACTIVE'
            ? CheckCircle2
            : status === 'PENDING'
              ? Clock3
              : status === 'REJECTED'
                ? XCircle
                : AlertCircle;
    return (
        <span
            className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[10px] font-bold ${style}`}
        >
            <Icon className="h-3 w-3" /> {storeUsdtWalletStatusLabel(status)}
        </span>
    );
}

function Field({ children, label }: { children: React.ReactNode; label: string }) {
    return (
        <label className="block text-[10px] font-bold text-slate-600">
            {label}
            <span className="mt-1.5 block">{children}</span>
        </label>
    );
}

function Metric({
    label,
    tone = 'default',
    value,
}: {
    label: string;
    tone?: 'default' | 'success' | 'warning';
    value: string;
}) {
    const valueStyle =
        tone === 'success' ? 'text-emerald-700' : tone === 'warning' ? 'text-amber-700' : 'text-slate-900';
    return (
        <div className="min-w-0 rounded-lg border border-slate-200 bg-white p-3">
            <span className="block text-[9px] text-slate-400">{label}</span>
            <strong className={`mt-1 block truncate text-[11px] ${valueStyle}`} title={value}>
                {value}
            </strong>
        </div>
    );
}

function OutputValue({ value }: { value: string }) {
    return (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
            {value}
        </div>
    );
}

function InlineAlert({ children, tone }: { children: React.ReactNode; tone: 'error' | 'warning' }) {
    const style =
        tone === 'error'
            ? 'border-rose-200 bg-rose-50 text-rose-700'
            : 'border-amber-200 bg-amber-50 text-amber-800';
    return <div className={`rounded-lg border p-3 text-[10px] leading-5 ${style}`}>{children}</div>;
}

function formatRate(value: number | null, prefix: string): string {
    return value == null ? '尚未采集' : `${prefix}${value.toFixed(4)} / ₮1`;
}

function formatDateTime(value: string | null): string {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    }).format(date);
}

function shortFingerprint(value: string | null): string {
    if (!value) return '无';
    return value.length > 20 ? `${value.slice(0, 16)}…${value.slice(-4)}` : value;
}
