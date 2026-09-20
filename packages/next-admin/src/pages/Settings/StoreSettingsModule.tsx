import { useMutation, useQuery } from '@apollo/client/react';
import { Plus, RefreshCw, Store } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { sensitiveActionContext } from '../../apollo';
import { useConfirmDialog } from '../../components/confirm-dialog-context';
import { FeatureHelpButton } from '../../components/FeatureHelp';

import {
    ADMINISTRATOR_ACCESS_SCOPE_QUERY,
    MY_STORE_SETTINGS_QUERY,
    PLATFORM_GOVERNANCE_REVIEW_QUERY,
    REVIEW_STORE_GOVERNANCE_CHANGE_MUTATION,
    SET_MY_STORE_PAYMENT_OPTION_ENABLED_MUTATION,
    SUBMIT_MY_STORE_USDT_WALLET_MUTATION,
    SUBMIT_STORE_GOVERNANCE_CHANGE_MUTATION,
    UPDATE_MY_STORE_COMMERCE_CONFIGURATION_MUTATION,
    UPDATE_MY_STORE_PROFILE_MUTATION,
    type AdministratorAccessScopeResult,
    type MyStoreSettingsResult,
    type PlatformGovernanceReviewResult,
    type StoreManagementResult,
    type StoreProfileRecord,
} from '../../graphql/management.graphql';
import { useAdminPermissions } from '../../hooks/use-admin-permissions';
import { useUrlTab } from '../../hooks/use-url-tab';
import { getChannelDisplayName } from '../../utils/channel-display';
import { dataTableSortPolicy } from '../../utils/data-table-sort-policy';
import { toUserFacingError } from '../../utils/user-facing-error';

import { BusinessBasicsPanel } from './BusinessSettingsPanels';
import { PaymentShippingManager } from './PaymentShippingManager';
import {
    ErrorState,
    Message,
    SettingsContentSkeleton,
    inputClass,
    mergeById,
    primaryButton,
    secondaryButton,
} from './settings-ui';
import {
    STORE_SETTINGS_TABS,
    getInitializedStoreSettings,
    useStoreManagementDocument,
    type StoreSettingsTab,
} from './store-settings-state';
import {
    ProvisionStoreDialog,
    SellerDialog,
    StoreDeprovisionDialog,
    StoreEditor,
    storeName,
} from './StoreDialogs';
import { CurrencyAndRatesPanel, StoreUsdtPanel } from './StoreFinancePanel';
import { CommerceModePanel, DomainsPanel, SellersPanel, StoresPanel } from './StorePanels';
import { StoreSettingsNavigation } from './StoreSettingsNavigation';

const directoryOptions = (skip: number) => ({ skip, take: 100, sort: dataTableSortPolicy.newestCreated });

export function StoreSettingsModule() {
    const { hasAnyPermission } = useAdminPermissions();
    const accessQuery = useQuery<AdministratorAccessScopeResult>(ADMINISTRATOR_ACCESS_SCOPE_QUERY, {
        fetchPolicy: 'cache-and-network',
    });
    if (!accessQuery.data && !accessQuery.error) {
        return <SettingsContentSkeleton label="正在识别管理账号范围" sections={2} />;
    }
    if (accessQuery.error || !accessQuery.data) {
        return (
            <ErrorState
                message={toUserFacingError(accessQuery.error, '无法识别当前管理账号范围')}
                onRetry={() => void accessQuery.refetch()}
            />
        );
    }
    if (accessQuery.data.myAdministratorAccess.scope === 'STORE') return <MyStoreSettingsModule />;
    if (hasAnyPermission(['ManageStoreLifecycle', 'SuperAdmin'])) {
        return (
            <PlatformGovernanceCenter
                allowPermanentDeprovision={accessQuery.data.myAdministratorAccess.authority === 'OWNER'}
            />
        );
    }
    if (hasAnyPermission(['ReviewStoreGovernance'])) return <PlatformGovernanceReviewCenter />;
    return <ErrorState message="当前平台岗位没有店铺治理权限" onRetry={() => void accessQuery.refetch()} />;
}

function PlatformGovernanceReviewCenter() {
    const requestConfirmation = useConfirmDialog();
    const [notice, setNotice] = useState('');
    const [actionError, setActionError] = useState('');
    const query = useQuery<PlatformGovernanceReviewResult>(PLATFORM_GOVERNANCE_REVIEW_QUERY, {
        fetchPolicy: 'cache-and-network',
    });
    const [reviewGovernance, reviewState] = useMutation(REVIEW_STORE_GOVERNANCE_CHANGE_MUTATION);
    const reviewRequest = async (id: string, decision: 'APPROVED' | 'REJECTED') => {
        const reason = decision === 'REJECTED' ? window.prompt('请输入驳回原因')?.trim() : '';
        if (decision === 'REJECTED' && !reason) return;
        const confirmation = await requestConfirmation({
            title: decision === 'APPROVED' ? '确认通过治理申请' : '确认驳回治理申请',
            description: '该操作会记录审核人和脱敏审计摘要，请验证当前账号密码。',
            confirmLabel: decision === 'APPROVED' ? '验证并通过' : '验证并驳回',
            tone: decision === 'APPROVED' ? 'default' : 'warning',
            requireCurrentPassword: true,
        });
        if (!confirmation) return;
        try {
            await reviewGovernance({
                variables: {
                    input: {
                        id,
                        decision,
                        reason: reason || null,
                        currentPassword: confirmation.currentPassword ?? '',
                    },
                },
            });
            setNotice(decision === 'APPROVED' ? '申请已通过并应用' : '申请已驳回');
            setActionError('');
            await query.refetch();
        } catch (error) {
            setActionError(toUserFacingError(error, '审核店铺治理变更失败'));
        }
    };
    if (query.error && !query.data) {
        return (
            <ErrorState
                message={toUserFacingError(query.error, '治理审批队列读取失败')}
                onRetry={() => void query.refetch()}
            />
        );
    }
    if (!query.data) return <SettingsContentSkeleton label="正在读取治理审批队列" sections={2} />;
    const pending = query.data.storeGovernanceChanges.filter(request => request.status === 'PENDING');
    return (
        <div className="flex h-full flex-col bg-slate-50">
            <header className="shrink-0 border-b border-slate-200 bg-white px-5 py-4 sm:px-8">
                <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
                    <Store className="h-5 w-5 text-blue-600" />
                    店铺治理审批
                    <FeatureHelpButton topic="settings.store-profile" title="店铺治理审批" />
                </h1>
                <p className="mt-1 text-xs text-slate-500">
                    此岗位只能审核店铺提交的主体与支付治理申请，不会读取平台密钥或其他设置。
                </p>
            </header>
            <main className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5 sm:p-8">
                {notice && (
                    <Message kind="success" onClose={() => setNotice('')}>
                        {notice}
                    </Message>
                )}
                {actionError && (
                    <Message kind="error" onClose={() => setActionError('')}>
                        {actionError}
                    </Message>
                )}
                <section className="rounded-xl border border-slate-200 bg-white p-4">
                    <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                        待审批申请
                        <FeatureHelpButton topic="settings.store-profile" title="待审批申请" />
                    </h2>
                    {pending.length === 0 ? (
                        <p className="mt-3 text-xs text-slate-500">当前没有待审批申请。</p>
                    ) : (
                        <div className="mt-3 space-y-2">
                            {pending.map(request => (
                                <div
                                    key={request.id}
                                    className="flex flex-col gap-3 rounded-lg border border-slate-200 p-3 sm:flex-row sm:items-center sm:justify-between"
                                >
                                    <div className="text-xs">
                                        <div className="font-bold text-slate-800">
                                            {getChannelDisplayName(request.channel)} ·{' '}
                                            {governanceRequestTypeLabel(request.requestType)}
                                        </div>
                                        <div className="mt-1 space-y-0.5 text-slate-500">
                                            <div>版本 {request.version}</div>
                                            {governancePayloadRows(
                                                request.reviewPayload ?? request.maskedSummary,
                                            ).map(([label, value]) => (
                                                <div key={label}>
                                                    {label}：{value}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                    <div className="flex gap-2">
                                        <button
                                            type="button"
                                            disabled={reviewState.loading}
                                            onClick={() => void reviewRequest(request.id, 'REJECTED')}
                                            className={secondaryButton}
                                        >
                                            驳回
                                        </button>
                                        <button
                                            type="button"
                                            disabled={reviewState.loading}
                                            onClick={() => void reviewRequest(request.id, 'APPROVED')}
                                            className={primaryButton}
                                        >
                                            通过
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </section>
            </main>
        </div>
    );
}

function MyStoreSettingsModule() {
    const [notice, setNotice] = useState('');
    const [actionError, setActionError] = useState('');
    const query = useQuery<MyStoreSettingsResult>(MY_STORE_SETTINGS_QUERY, {
        fetchPolicy: 'cache-and-network',
    });
    if (query.error && !query.data) {
        return (
            <ErrorState
                message={toUserFacingError(query.error, '我的店铺设置读取失败')}
                onRetry={() => void query.refetch()}
            />
        );
    }
    if (!query.data) return <SettingsContentSkeleton label="正在读取我的店铺设置" sections={3} />;
    const {
        myStoreProfile: profile,
        myStoreCommerceConfiguration: commerce,
        myStoreCurrencyConfiguration: currency,
    } = query.data;
    const legalRequest = query.data.myStoreGovernanceChanges.find(
        item => item.requestType === 'LEGAL_IDENTITY',
    );
    const payoutRequest = query.data.myStoreGovernanceChanges.find(
        item => item.requestType === 'PAYOUT_ACCOUNT',
    );
    const completed = async (message: string) => {
        setNotice(message);
        setActionError('');
        await query.refetch();
    };
    return (
        <div className="flex h-full flex-col bg-slate-50">
            <header className="shrink-0 border-b border-slate-200 bg-white px-5 py-4 sm:px-8">
                <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
                    <Store className="h-5 w-5 text-blue-600" />
                    我的店铺设置
                    <FeatureHelpButton topic="settings.store-profile" title="我的店铺设置" />
                </h1>
                <p className="mt-1 text-xs text-slate-500">
                    此页只操作当前店铺数据，不包含其他店铺、平台角色或原始支付密钥。
                </p>
            </header>
            <main className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5 sm:p-8">
                {notice && (
                    <Message kind="success" onClose={() => setNotice('')}>
                        {notice}
                    </Message>
                )}
                {actionError && (
                    <Message kind="error" onClose={() => setActionError('')}>
                        {actionError}
                    </Message>
                )}
                <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    <StoreScopeCard
                        title="店铺资料"
                        rows={[
                            ['店铺', getChannelDisplayName(profile.channel)],
                            [
                                '状态',
                                profile.status === 'ACTIVE'
                                    ? '已上线'
                                    : profile.status === 'SUSPENDED'
                                      ? '已停用'
                                      : '草稿',
                            ],
                            ['主域名', profile.primaryDomain ?? '尚未验证'],
                            [
                                '主体审核',
                                legalRequest?.status === 'PENDING'
                                    ? '待平台审核'
                                    : legalRequest?.status === 'REJECTED'
                                      ? `已驳回：${legalRequest.reviewReason ?? '未填写原因'}`
                                      : legalRequest?.status === 'APPROVED'
                                        ? '已通过'
                                        : '无待审申请',
                            ],
                        ]}
                    />
                    <StoreScopeCard
                        title="经营配置"
                        rows={[
                            ['记账币种', commerce.currencyCode],
                            ['配送方式', commerce.shippingMethodNameZh || commerce.shippingMethodNameEn],
                            ['基础运费', String(commerce.baseRate)],
                            ['预计送达', `${commerce.estimateMinDays}-${commerce.estimateMaxDays} 天`],
                        ]}
                    />
                    <StoreScopeCard
                        title="支付与汇率"
                        rows={[
                            ['默认币种', currency.defaultCurrencyCode],
                            ['可用币种', currency.availableCurrencyCodes.join('、')],
                            ['USDT 展示', currency.usdtDisplayEnabled ? '已开启' : '已关闭'],
                            ['USDT 钱包审核', currency.usdtWalletReviewStatus],
                            ['收款账户审核', governanceStatusLabel(payoutRequest)],
                        ]}
                    />
                </section>
                <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-xs leading-6 text-blue-900">
                    公开品牌资料、客服邮箱可由店铺管理；主体名称、收款账户、USDT
                    钱包和支付配置需提交平台审核，审核前不影响线上已批准值。
                </div>
                <MyStoreProfileEditor
                    key={profile.updatedAt}
                    profile={profile}
                    legalRequestStatus={legalRequest?.status ?? null}
                    onCompleted={completed}
                    onError={setActionError}
                />
                <MyStoreCommerceEditor
                    key={commerce.updatedAt}
                    commerce={commerce}
                    onCompleted={completed}
                    onError={setActionError}
                />
                <MyStorePaymentOptions
                    options={query.data.myStorePaymentOptions}
                    onCompleted={completed}
                    onError={setActionError}
                />
                <MyStorePayoutAccount
                    latestRequest={payoutRequest}
                    onCompleted={completed}
                    onError={setActionError}
                />
                <MyStoreUsdtWallet
                    wallet={query.data.myStoreUsdtWallet}
                    onCompleted={completed}
                    onError={setActionError}
                />
                <DomainsPanel
                    profile={profile}
                    profiles={[profile]}
                    onChanged={completed}
                    onError={setActionError}
                />
            </main>
        </div>
    );
}

function MyStorePayoutAccount({
    latestRequest,
    onCompleted,
    onError,
}: {
    latestRequest: MyStoreSettingsResult['myStoreGovernanceChanges'][number] | undefined;
    onCompleted: (message: string) => Promise<void>;
    onError: (message: string) => void;
}) {
    const [provider, setProvider] = useState('');
    const [accountHolder, setAccountHolder] = useState('');
    const [accountIdentifier, setAccountIdentifier] = useState('');
    const [submit, state] = useMutation(SUBMIT_STORE_GOVERNANCE_CHANGE_MUTATION);
    const save = async () => {
        if (!provider.trim() || !accountHolder.trim() || !accountIdentifier.trim()) {
            onError('请完整填写收款机构、账户持有人和收款账号');
            return;
        }
        try {
            await submit({
                variables: {
                    input: {
                        requestType: 'PAYOUT_ACCOUNT',
                        payload: {
                            provider: provider.trim(),
                            accountHolder: accountHolder.trim(),
                            accountIdentifier: accountIdentifier.trim(),
                        },
                    },
                },
            });
            setAccountIdentifier('');
            await onCompleted('收款账户已加密提交平台审核，审核前不会替换已批准记录');
        } catch (error) {
            onError(toUserFacingError(error, '提交收款账户审核失败'));
        }
    };
    return (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                收款账户审核
                <FeatureHelpButton topic="settings.finance" title="收款账户审核" />
            </h2>
            <p className="mt-1 text-xs text-slate-500">
                资料会加密保存；提交后进入平台审批，审核前继续沿用已批准记录。
            </p>
            <div className="mt-4 grid gap-4 md:grid-cols-3">
                <FieldInput label="收款机构" value={provider} onChange={setProvider} />
                <FieldInput label="账户持有人" value={accountHolder} onChange={setAccountHolder} />
                <FieldInput label="收款账号" value={accountIdentifier} onChange={setAccountIdentifier} />
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
                <span>当前状态：{governanceStatusLabel(latestRequest)}</span>
                <button
                    type="button"
                    onClick={() => void save()}
                    disabled={state.loading}
                    className={secondaryButton}
                >
                    提交审核
                </button>
            </div>
        </section>
    );
}

function MyStoreUsdtWallet({
    wallet,
    onCompleted,
    onError,
}: {
    wallet: MyStoreSettingsResult['myStoreUsdtWallet'];
    onCompleted: (message: string) => Promise<void>;
    onError: (message: string) => void;
}) {
    const requestConfirmation = useConfirmDialog();
    const [address, setAddress] = useState(wallet.pendingReceivingAddress ?? '');
    const [submitWallet, state] = useMutation(SUBMIT_MY_STORE_USDT_WALLET_MUTATION);
    const submit = async () => {
        if (!address.trim()) return onError('请输入 TRON 主网收款地址');
        const confirmation = await requestConfirmation({
            title: '提交本店 USDT 收款地址？',
            description: '地址将加密保存并等待平台审核，通过前不会影响当前线上收款地址。',
            confirmLabel: '验证并提交',
            tone: 'warning',
            requireCurrentPassword: true,
        });
        if (!confirmation) return;
        try {
            await submitWallet({
                variables: { receivingAddress: address.trim() },
                context: sensitiveActionContext(confirmation.currentPassword ?? ''),
            });
            await onCompleted('USDT 收款地址已提交平台审核');
        } catch (error) {
            onError(toUserFacingError(error, '提交 USDT 收款地址失败'));
        }
    };
    return (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                USDT 收款钱包
                <FeatureHelpButton topic="settings.usdt" title="USDT 收款钱包" />
            </h2>
            <p className="mt-1 text-xs text-slate-500">
                只提交公开收款地址，禁止填写私钥或助记词；平台审核通过后仅影响新订单。
            </p>
            <div className="mt-4 grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
                <FieldInput label={`${wallet.network} 收款地址`} value={address} onChange={setAddress} />
                <button
                    type="button"
                    onClick={() => void submit()}
                    disabled={state.loading}
                    className={secondaryButton}
                >
                    提交审核
                </button>
            </div>
            <div className="mt-3 text-xs text-slate-500">
                状态：
                {wallet.reviewStatus === 'PENDING'
                    ? '待平台审核'
                    : wallet.reviewStatus === 'ACTIVE'
                      ? '已审核启用'
                      : wallet.reviewStatus === 'REJECTED'
                        ? `已驳回：${wallet.rejectionReason ?? '未填写原因'}`
                        : '未配置'}
                {wallet.activeReceivingAddressMasked
                    ? ` · 当前地址 ${wallet.activeReceivingAddressMasked}`
                    : ''}
            </div>
        </section>
    );
}

function MyStorePaymentOptions({
    options,
    onCompleted,
    onError,
}: {
    options: MyStoreSettingsResult['myStorePaymentOptions'];
    onCompleted: (message: string) => Promise<void>;
    onError: (message: string) => void;
}) {
    const [setEnabled, state] = useMutation(SET_MY_STORE_PAYMENT_OPTION_ENABLED_MUTATION);
    const toggle = async (id: string, enabled: boolean) => {
        try {
            await setEnabled({ variables: { id, enabled } });
            await onCompleted(enabled ? '本店支付方式已启用' : '本店支付方式已停用');
        } catch (error) {
            onError(toUserFacingError(error, '更新本店支付方式失败'));
        }
    };
    return (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                本店支付选项
                <FeatureHelpButton topic="settings.payment-shipping" title="本店支付选项" />
            </h2>
            <p className="mt-1 text-xs text-slate-500">
                只能启停平台已经分配给本店的支付方式；处理器参数与密钥不会返回。
            </p>
            <div className="mt-4 divide-y divide-slate-100">
                {options.map(option => (
                    <label key={option.id} className="flex items-center justify-between gap-4 py-3 text-xs">
                        <span>
                            <strong className="block text-slate-800">{option.name}</strong>
                            <span className="mt-1 block text-slate-400">平台批准的支付方式</span>
                        </span>
                        <input
                            type="checkbox"
                            checked={option.enabled}
                            disabled={state.loading}
                            onChange={event => void toggle(option.id, event.target.checked)}
                            aria-label={`${option.name}启用状态`}
                        />
                    </label>
                ))}
                {!options.length && (
                    <div className="py-8 text-center text-xs text-slate-400">平台尚未给本店分配支付方式</div>
                )}
            </div>
        </section>
    );
}

function MyStoreCommerceEditor({
    commerce,
    onCompleted,
    onError,
}: {
    commerce: MyStoreSettingsResult['myStoreCommerceConfiguration'];
    onCompleted: (message: string) => Promise<void>;
    onError: (message: string) => void;
}) {
    const [updateCommerce, updateState] = useMutation(UPDATE_MY_STORE_COMMERCE_CONFIGURATION_MUTATION);
    const [draft, setDraft] = useState({ ...commerce, countryCode: commerce.countryCode ?? '' });
    const update = <K extends keyof typeof draft>(field: K, value: (typeof draft)[K]) =>
        setDraft(current => ({ ...current, [field]: value }));
    const save = async () => {
        if (!draft.countryCode.trim()) return onError('请填写经营国家或地区代码');
        if (draft.estimateMinDays < 0 || draft.estimateMaxDays < draft.estimateMinDays) {
            return onError('预计送达天数范围不正确');
        }
        try {
            await updateCommerce({
                variables: {
                    input: {
                        expectedUpdatedAt: commerce.updatedAt,
                        pricesIncludeTax: draft.pricesIncludeTax,
                        countryCode: draft.countryCode.trim().toUpperCase(),
                        taxRate: draft.taxRate,
                        shippingMethodNameZh: draft.shippingMethodNameZh.trim(),
                        shippingMethodNameEn: draft.shippingMethodNameEn.trim(),
                        shippingDescriptionZh: draft.shippingDescriptionZh.trim(),
                        shippingDescriptionEn: draft.shippingDescriptionEn.trim(),
                        baseRate: draft.baseRate,
                        freeShippingThreshold: draft.freeShippingThreshold,
                        shippingTaxRate: draft.shippingTaxRate,
                        shippingPriceIncludesTax: draft.shippingPriceIncludesTax,
                        estimateMinDays: draft.estimateMinDays,
                        estimateMaxDays: draft.estimateMaxDays,
                        blockedPostalPrefixes: draft.blockedPostalPrefixes.trim(),
                    },
                },
            });
            await onCompleted('本店税务与配送设置已保存');
        } catch (error) {
            onError(toUserFacingError(error, '保存本店税务与配送设置失败'));
        }
    };
    return (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="mb-4">
                <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                    本店税务与配送
                    <FeatureHelpButton topic="settings.payment-shipping" title="本店税务与配送" />
                </h2>
                <p className="mt-1 text-xs text-slate-500">
                    只修改当前店铺的经营规则；承运商凭据仍由平台维护。
                </p>
            </div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <FieldInput
                    label="国家/地区代码"
                    value={draft.countryCode}
                    onChange={value => update('countryCode', value)}
                />
                <NumberField
                    label="商品税率（%）"
                    value={draft.taxRate}
                    onChange={value => update('taxRate', value)}
                />
                <NumberField
                    label={`基础运费（${draft.currencyCode} 最小单位）`}
                    value={draft.baseRate}
                    onChange={value => update('baseRate', value)}
                />
                <NumberField
                    label={`免运费门槛（${draft.currencyCode} 最小单位）`}
                    value={draft.freeShippingThreshold}
                    onChange={value => update('freeShippingThreshold', value)}
                />
                <FieldInput
                    label="配送名称"
                    value={draft.shippingMethodNameZh}
                    onChange={value => update('shippingMethodNameZh', value)}
                />
                <FieldInput
                    label="英文配送名称"
                    value={draft.shippingMethodNameEn}
                    onChange={value => update('shippingMethodNameEn', value)}
                />
                <NumberField
                    label="配送税率（%）"
                    value={draft.shippingTaxRate}
                    onChange={value => update('shippingTaxRate', value)}
                />
                <FieldInput
                    label="禁运邮编前缀"
                    value={draft.blockedPostalPrefixes}
                    onChange={value => update('blockedPostalPrefixes', value)}
                />
                <NumberField
                    label="最少送达天数"
                    value={draft.estimateMinDays}
                    onChange={value => update('estimateMinDays', Math.round(value))}
                />
                <NumberField
                    label="最多送达天数"
                    value={draft.estimateMaxDays}
                    onChange={value => update('estimateMaxDays', Math.round(value))}
                />
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="flex items-center gap-2 text-xs font-medium text-slate-700">
                    <input
                        type="checkbox"
                        checked={draft.pricesIncludeTax}
                        onChange={event => update('pricesIncludeTax', event.target.checked)}
                    />{' '}
                    商品价格含税
                </label>
                <label className="flex items-center gap-2 text-xs font-medium text-slate-700">
                    <input
                        type="checkbox"
                        checked={draft.shippingPriceIncludesTax}
                        onChange={event => update('shippingPriceIncludesTax', event.target.checked)}
                    />{' '}
                    运费含税
                </label>
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
                <FieldArea
                    label="配送说明"
                    value={draft.shippingDescriptionZh}
                    onChange={value => update('shippingDescriptionZh', value)}
                />
                <FieldArea
                    label="英文配送说明"
                    value={draft.shippingDescriptionEn}
                    onChange={value => update('shippingDescriptionEn', value)}
                />
            </div>
            <div className="mt-4 flex justify-end">
                <button
                    type="button"
                    onClick={() => void save()}
                    disabled={updateState.loading}
                    className={primaryButton}
                >
                    保存税务与配送
                </button>
            </div>
        </section>
    );
}

function NumberField({
    label,
    value,
    onChange,
}: {
    label: string;
    value: number;
    onChange: (value: number) => void;
}) {
    return (
        <FieldInput
            label={label}
            type="number"
            value={String(value)}
            onChange={value => onChange(Number.isFinite(Number(value)) ? Number(value) : 0)}
        />
    );
}

function MyStoreProfileEditor({
    profile,
    legalRequestStatus,
    onCompleted,
    onError,
}: {
    profile: StoreProfileRecord;
    legalRequestStatus: string | null;
    onCompleted: (message: string) => Promise<void>;
    onError: (message: string) => void;
}) {
    const [updateProfile, updateState] = useMutation(UPDATE_MY_STORE_PROFILE_MUTATION);
    const [submitGovernance, submitState] = useMutation(SUBMIT_STORE_GOVERNANCE_CHANGE_MUTATION);
    const [draft, setDraft] = useState({
        storefrontNameZh: profile.channel.customFields.storefrontNameZh ?? '',
        storefrontNameEn: profile.channel.customFields.storefrontNameEn ?? '',
        descriptionZh: profile.descriptionZh ?? '',
        descriptionEn: profile.descriptionEn ?? '',
        taglineZh: profile.taglineZh ?? '',
        taglineEn: profile.taglineEn ?? '',
        brandBackgroundColor: profile.brandBackgroundColor ?? '',
        brandPrimaryColor: profile.brandPrimaryColor ?? '',
        brandAccentColor: profile.brandAccentColor ?? '',
        brandHighlightColor: profile.brandHighlightColor ?? '',
        supportEmail: profile.supportEmail ?? '',
        privacyEmail: profile.privacyEmail ?? '',
        legalEntityName: profile.legalEntityName ?? '',
        legalRegistrationCountry: profile.legalRegistrationCountry ?? '',
    });
    const change = (field: keyof typeof draft, value: string) =>
        setDraft(current => ({ ...current, [field]: value }));
    const save = async () => {
        if (!draft.storefrontNameZh.trim()) return onError('店铺名称不能为空');
        if (
            ![draft.supportEmail, draft.privacyEmail].every(value => !value || /^\S+@\S+\.\S+$/.test(value))
        ) {
            return onError('请填写有效的客服邮箱和隐私邮箱');
        }
        try {
            await updateProfile({
                variables: {
                    input: {
                        expectedUpdatedAt: profile.updatedAt,
                        storefrontNameZh: draft.storefrontNameZh.trim(),
                        storefrontNameEn: draft.storefrontNameEn.trim(),
                        descriptionZh: draft.descriptionZh.trim(),
                        descriptionEn: draft.descriptionEn.trim(),
                        taglineZh: draft.taglineZh.trim(),
                        taglineEn: draft.taglineEn.trim(),
                        brandBackgroundColor: draft.brandBackgroundColor || null,
                        brandPrimaryColor: draft.brandPrimaryColor || null,
                        brandAccentColor: draft.brandAccentColor || null,
                        brandHighlightColor: draft.brandHighlightColor || null,
                        supportEmail: draft.supportEmail.trim() || null,
                        privacyEmail: draft.privacyEmail.trim() || null,
                    },
                },
            });
            await onCompleted('本店公开资料已保存');
        } catch (error) {
            onError(toUserFacingError(error, '保存本店资料失败'));
        }
    };
    const submitLegal = async () => {
        if (!draft.legalEntityName.trim() || !draft.legalRegistrationCountry.trim()) {
            return onError('请填写主体名称和注册国家或地区');
        }
        try {
            await submitGovernance({
                variables: {
                    input: {
                        requestType: 'LEGAL_IDENTITY',
                        payload: {
                            legalEntityName: draft.legalEntityName.trim(),
                            legalRegistrationCountry: draft.legalRegistrationCountry.trim(),
                        },
                    },
                },
            });
            await onCompleted('主体资料已提交平台审核，审核前线上值保持不变');
        } catch (error) {
            onError(toUserFacingError(error, '提交主体审核失败'));
        }
    };
    return (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="mb-4">
                <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                    本店公开资料
                    <FeatureHelpButton topic="settings.store-profile" title="本店公开资料" />
                </h2>
                <p className="mt-1 text-xs text-slate-500">
                    品牌与联系信息直接保存；法律主体单独提交平台审批。
                </p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
                <FieldInput
                    label="店铺名称"
                    value={draft.storefrontNameZh}
                    onChange={value => change('storefrontNameZh', value)}
                />
                <FieldInput
                    label="英文店铺名称"
                    value={draft.storefrontNameEn}
                    onChange={value => change('storefrontNameEn', value)}
                />
                <FieldInput
                    label="品牌口号"
                    value={draft.taglineZh}
                    onChange={value => change('taglineZh', value)}
                />
                <FieldInput
                    label="英文品牌口号"
                    value={draft.taglineEn}
                    onChange={value => change('taglineEn', value)}
                />
                <FieldInput
                    label="客服邮箱"
                    type="email"
                    value={draft.supportEmail}
                    onChange={value => change('supportEmail', value)}
                />
                <FieldInput
                    label="隐私邮箱"
                    type="email"
                    value={draft.privacyEmail}
                    onChange={value => change('privacyEmail', value)}
                />
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
                <FieldArea
                    label="公开简介"
                    value={draft.descriptionZh}
                    onChange={value => change('descriptionZh', value)}
                />
                <FieldArea
                    label="英文公开简介"
                    value={draft.descriptionEn}
                    onChange={value => change('descriptionEn', value)}
                />
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {(
                    [
                        ['brandBackgroundColor', '背景色'],
                        ['brandPrimaryColor', '主色'],
                        ['brandAccentColor', '强调色'],
                        ['brandHighlightColor', '高亮色'],
                    ] as const
                ).map(([field, label]) => (
                    <FieldInput
                        key={field}
                        label={label}
                        type="color"
                        value={draft[field] || '#ffffff'}
                        onChange={value => change(field, value)}
                    />
                ))}
            </div>
            <div className="mt-4 flex justify-end">
                <button
                    type="button"
                    onClick={() => void save()}
                    disabled={updateState.loading}
                    className={primaryButton}
                >
                    保存本店资料
                </button>
            </div>
            <div className="mt-5 border-t border-slate-100 pt-5">
                <div className="grid gap-4 md:grid-cols-2">
                    <FieldInput
                        label="法定经营主体"
                        value={draft.legalEntityName}
                        onChange={value => change('legalEntityName', value)}
                    />
                    <FieldInput
                        label="注册国家或地区"
                        value={draft.legalRegistrationCountry}
                        onChange={value => change('legalRegistrationCountry', value)}
                    />
                </div>
                <div className="mt-4 flex items-center justify-between gap-3">
                    <span className="text-xs text-slate-500">
                        当前申请：
                        {legalRequestStatus === 'PENDING'
                            ? '待审核'
                            : legalRequestStatus === 'REJECTED'
                              ? '已驳回，可重新提交'
                              : legalRequestStatus === 'APPROVED'
                                ? '已通过'
                                : '未提交'}
                    </span>
                    <button
                        type="button"
                        onClick={() => void submitLegal()}
                        disabled={submitState.loading}
                        className={secondaryButton}
                    >
                        提交主体审核
                    </button>
                </div>
            </div>
        </section>
    );
}

function FieldInput({
    label,
    value,
    onChange,
    type = 'text',
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    type?: string;
}) {
    return (
        <label className="text-xs font-bold text-slate-700">
            <span className="mb-1.5 block">{label}</span>
            <input
                type={type}
                value={value}
                onChange={event => onChange(event.target.value)}
                className={inputClass}
            />
        </label>
    );
}

function FieldArea({
    label,
    value,
    onChange,
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
}) {
    return (
        <label className="text-xs font-bold text-slate-700">
            <span className="mb-1.5 block">{label}</span>
            <textarea
                value={value}
                onChange={event => onChange(event.target.value)}
                rows={4}
                className={inputClass}
            />
        </label>
    );
}

function StoreScopeCard({ title, rows }: { title: string; rows: Array<[string, string]> }) {
    return (
        <section className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-bold text-slate-900">{title}</h2>
            <dl className="mt-3 space-y-2 text-xs">
                {rows.map(([label, value]) => (
                    <div key={label} className="flex items-start justify-between gap-3">
                        <dt className="text-slate-500">{label}</dt>
                        <dd className="text-right font-medium text-slate-800">{value || '—'}</dd>
                    </div>
                ))}
            </dl>
        </section>
    );
}

function PlatformGovernanceCenter({ allowPermanentDeprovision }: { allowPermanentDeprovision: boolean }) {
    const requestConfirmation = useConfirmDialog();
    const [reviewGovernance, reviewGovernanceState] = useMutation(REVIEW_STORE_GOVERNANCE_CHANGE_MUTATION);
    const { hasAnyPermission } = useAdminPermissions();
    const { document, paymentMethodCustomFields, sellerCustomFields, shippingMethodCustomFields } =
        useStoreManagementDocument();
    const [tab, setTab] = useUrlTab<StoreSettingsTab>(STORE_SETTINGS_TABS, 'stores');
    const [selectedStoreId, setSelectedStoreId] = useState('');
    const [storeEditor, setStoreEditor] = useState<StoreProfileRecord | null>(null);
    const [deprovisionProfile, setDeprovisionProfile] = useState<StoreProfileRecord | null>(null);
    const [provisionOpen, setProvisionOpen] = useState(false);
    const [sellerOpen, setSellerOpen] = useState(false);
    const [notice, setNotice] = useState('');
    const [actionError, setActionError] = useState('');
    const [initialSupplementSettled, setInitialSupplementSettled] = useState(false);
    const loadingAllStoreSettingsRef = useRef(false);
    const query = useQuery<StoreManagementResult>(document, {
        variables: {
            sellerOptions: directoryOptions(0),
            paymentMethodOptions: directoryOptions(0),
            shippingMethodOptions: directoryOptions(0),
        },
        fetchPolicy: 'cache-and-network',
    });
    const {
        data: storeSettingsData,
        error: storeSettingsError,
        fetchMore: fetchMoreStoreSettings,
        loading: storeSettingsLoading,
    } = query;
    const initializedStoreSettings = getInitializedStoreSettings(
        storeSettingsData,
        Boolean(storeSettingsError),
        initialSupplementSettled,
    );
    const queryError = query.error ? toUserFacingError(query.error, '平台治理中心读取失败') : '';
    useEffect(() => {
        const data = storeSettingsData;
        if (!data || storeSettingsLoading || storeSettingsError || loadingAllStoreSettingsRef.current) return;
        const sellerCount = data.sellers.items.length;
        const paymentCount = data.paymentMethods.items.length;
        const shippingCount = data.shippingMethods.items.length;
        if (
            sellerCount >= data.sellers.totalItems &&
            paymentCount >= data.paymentMethods.totalItems &&
            shippingCount >= data.shippingMethods.totalItems
        )
            return;
        loadingAllStoreSettingsRef.current = true;
        void fetchMoreStoreSettings({
            variables: {
                sellerOptions: directoryOptions(sellerCount),
                paymentMethodOptions: directoryOptions(paymentCount),
                shippingMethodOptions: directoryOptions(shippingCount),
            },
            updateQuery: (previous, { fetchMoreResult }) => ({
                ...previous,
                sellers: {
                    ...fetchMoreResult.sellers,
                    items: mergeById(previous.sellers.items, fetchMoreResult.sellers.items),
                },
                paymentMethods: {
                    ...fetchMoreResult.paymentMethods,
                    items: mergeById(previous.paymentMethods.items, fetchMoreResult.paymentMethods.items),
                },
                shippingMethods: {
                    ...fetchMoreResult.shippingMethods,
                    items: mergeById(previous.shippingMethods.items, fetchMoreResult.shippingMethods.items),
                },
            }),
        })
            .catch(fetchError => {
                setActionError(toUserFacingError(fetchError, '店铺基础数据未能全部加载'));
            })
            .finally(() => {
                loadingAllStoreSettingsRef.current = false;
                setInitialSupplementSettled(true);
            });
    }, [fetchMoreStoreSettings, storeSettingsData, storeSettingsError, storeSettingsLoading]);
    const profiles = useMemo(
        () => [...(query.data?.storeProfiles ?? [])].sort((a, b) => a.sortOrder - b.sortOrder),
        [query.data?.storeProfiles],
    );
    const pendingGovernance =
        query.data?.storeGovernanceChanges.filter(item => item.status === 'PENDING') ?? [];
    const recentPermissionAudits = query.data?.administratorPermissionAudits.slice(0, 5) ?? [];
    const selectedProfile = profiles.find(profile => profile.id === selectedStoreId) ?? profiles[0] ?? null;
    const canReadBusinessSettings = hasAnyPermission([
        'ReadSettings',
        'ReadChannel',
        'ReadCountry',
        'ReadZone',
        'ReadTaxCategory',
        'ReadTaxRate',
    ]);
    const canReadFinance = hasAnyPermission(['ReadStoreProfile']);

    const completed = async (message: string) => {
        setNotice(message);
        setActionError('');
        setStoreEditor(null);
        setSellerOpen(false);
        await query.refetch();
    };

    const reviewRequest = async (id: string, decision: 'APPROVED' | 'REJECTED') => {
        const reason = decision === 'REJECTED' ? window.prompt('请填写驳回原因')?.trim() : '';
        if (decision === 'REJECTED' && !reason) return;
        const confirmation = await requestConfirmation({
            title: decision === 'APPROVED' ? '通过该店铺治理变更？' : '驳回该店铺治理变更？',
            description: '通过后才会将申请值应用到线上，请输入当前管理员密码确认。',
            confirmLabel: decision === 'APPROVED' ? '验证并通过' : '验证并驳回',
            tone: decision === 'APPROVED' ? 'warning' : 'danger',
            requireCurrentPassword: true,
        });
        if (!confirmation) return;
        try {
            await reviewGovernance({
                variables: {
                    input: {
                        id,
                        decision,
                        reason: reason || null,
                        currentPassword: confirmation.currentPassword ?? '',
                    },
                },
            });
            await completed(decision === 'APPROVED' ? '申请已通过并应用' : '申请已驳回');
        } catch (error) {
            setActionError(toUserFacingError(error, '审核店铺治理变更失败'));
        }
    };

    return (
        <div className="flex h-full flex-col bg-slate-50">
            <header className="shrink-0 border-b border-slate-200 bg-white px-5 py-4 sm:px-8">
                <div className="mx-auto flex w-full max-w-none flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
                            <Store className="h-5 w-5 text-blue-600" />
                            平台治理中心
                            <FeatureHelpButton topic="settings.store-profile" title="平台治理中心" />
                        </h1>
                        <p className="mt-1 text-xs text-slate-500">
                            集中管理全部店铺、主体与支付审批、平台级配送和经营政策
                        </p>
                    </div>
                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={() => void query.refetch()}
                            disabled={query.loading}
                            className={secondaryButton}
                            aria-label="刷新"
                        >
                            <RefreshCw className={`h-4 w-4 ${query.loading ? 'animate-spin' : ''}`} />
                        </button>
                        <button
                            type="button"
                            onClick={() => setProvisionOpen(true)}
                            className={primaryButton}
                        >
                            <Plus className="h-4 w-4" />
                            开通网店
                        </button>
                    </div>
                </div>
            </header>
            <main className="mx-auto min-h-0 w-full max-w-none flex-1 space-y-4 overflow-y-auto p-5 sm:p-8">
                {notice && (
                    <Message kind="success" onClose={() => setNotice('')}>
                        {notice}
                    </Message>
                )}
                {actionError && (
                    <Message kind="error" onClose={() => setActionError('')}>
                        {actionError}
                    </Message>
                )}
                {pendingGovernance.length > 0 && (
                    <section className="rounded-xl border border-amber-200 bg-white p-4">
                        <div className="mb-3 flex items-center justify-between">
                            <div>
                                <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                                    待审批的店铺治理变更
                                    <FeatureHelpButton
                                        topic="settings.store-profile"
                                        title="待审批的店铺治理变更"
                                    />
                                </h2>
                                <p className="mt-1 text-xs text-slate-500">
                                    店铺提交的主体、收款和支付配置在通过前不会覆盖线上值。
                                </p>
                            </div>
                            <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-bold text-amber-800">
                                {pendingGovernance.length} 项
                            </span>
                        </div>
                        <div className="space-y-2">
                            {pendingGovernance.map(request => (
                                <div
                                    key={request.id}
                                    className="flex flex-col gap-3 rounded-lg border border-slate-200 p-3 sm:flex-row sm:items-center sm:justify-between"
                                >
                                    <div className="text-xs">
                                        <div className="font-bold text-slate-800">
                                            {getChannelDisplayName(request.channel)} ·{' '}
                                            {governanceRequestTypeLabel(request.requestType)}
                                        </div>
                                        <div className="mt-1 space-y-0.5 text-slate-500">
                                            <div>版本 {request.version}</div>
                                            {governancePayloadRows(
                                                request.reviewPayload ?? request.maskedSummary,
                                            ).map(([label, value]) => (
                                                <div key={label}>
                                                    {label}：{value}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                    <div className="flex gap-2">
                                        <button
                                            type="button"
                                            disabled={reviewGovernanceState.loading}
                                            onClick={() => void reviewRequest(request.id, 'REJECTED')}
                                            className={secondaryButton}
                                        >
                                            驳回
                                        </button>
                                        <button
                                            type="button"
                                            disabled={reviewGovernanceState.loading}
                                            onClick={() => void reviewRequest(request.id, 'APPROVED')}
                                            className={primaryButton}
                                        >
                                            通过
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </section>
                )}
                {recentPermissionAudits.length > 0 && (
                    <section className="rounded-xl border border-slate-200 bg-white p-4">
                        <div className="mb-3">
                            <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                                最近权限审计
                                <FeatureHelpButton topic="settings.team" title="最近权限审计" />
                            </h2>
                            <p className="mt-1 text-xs text-slate-500">
                                这里只显示脱敏摘要，密码、密钥和凭据不会写入记录。
                            </p>
                        </div>
                        <div className="divide-y divide-slate-100">
                            {recentPermissionAudits.map(entry => (
                                <div
                                    key={entry.id}
                                    className="grid gap-1 py-2 text-xs sm:grid-cols-[180px_1fr_auto] sm:items-center"
                                >
                                    <span className="text-slate-500">
                                        {new Date(entry.createdAt).toLocaleString('zh-CN')}
                                    </span>
                                    <span className="font-medium text-slate-800">
                                        {permissionAuditLabel(entry.action)}
                                    </span>
                                    <span
                                        className={
                                            entry.result === 'SUCCESS' ? 'text-emerald-700' : 'text-rose-700'
                                        }
                                    >
                                        {entry.result === 'SUCCESS' ? '成功' : '失败'}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </section>
                )}
                <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                    <StoreSettingsNavigation
                        tab={tab}
                        onTabChange={setTab}
                        canReadFinance={canReadFinance}
                        canReadBusinessSettings={canReadBusinessSettings}
                    />
                    {tab === 'DOMAINS' && profiles.length > 0 && (
                        <select
                            value={selectedProfile?.id ?? ''}
                            onChange={event => setSelectedStoreId(event.target.value)}
                            className={`${inputClass} w-full xl:w-72`}
                        >
                            {profiles.map(profile => (
                                <option key={profile.id} value={profile.id}>
                                    {storeName(profile)} · {getChannelDisplayName(profile.channel.code)}
                                </option>
                            ))}
                        </select>
                    )}
                    {tab === 'SELLERS' && (
                        <button type="button" onClick={() => setSellerOpen(true)} className={primaryButton}>
                            <Plus className="h-3.5 w-3.5" />
                            新增商家主体
                        </button>
                    )}
                </div>
                {query.error && !query.data ? (
                    <ErrorState message={queryError} onRetry={() => void query.refetch()} />
                ) : !initializedStoreSettings ? (
                    <SettingsContentSkeleton label="正在读取平台治理中心" sections={2} />
                ) : (
                    <>
                        {tab === 'STORES' && (
                            <div className="space-y-4">
                                <CommerceModePanel onChanged={completed} onError={setActionError} />
                                <StoresPanel
                                    profiles={profiles}
                                    onEdit={setStoreEditor}
                                    onDeprovision={setDeprovisionProfile}
                                    allowPermanentDeprovision={allowPermanentDeprovision}
                                />
                            </div>
                        )}
                        {tab === 'DOMAINS' && (
                            <DomainsPanel
                                profile={selectedProfile}
                                profiles={profiles}
                                onChanged={message => completed(message)}
                                onError={setActionError}
                            />
                        )}
                        {tab === 'SELLERS' && (
                            <SellersPanel
                                sellers={query.data?.sellers.items ?? []}
                                profiles={profiles}
                                customFieldDefinitions={sellerCustomFields}
                                onChanged={completed}
                                onError={setActionError}
                            />
                        )}
                        {(tab === 'PAYMENT' || tab === 'SHIPPING') && (
                            <PaymentShippingManager
                                key={tab}
                                section={tab === 'PAYMENT' ? 'payment' : 'shipping'}
                                data={initializedStoreSettings}
                                paymentMethodCustomFields={paymentMethodCustomFields}
                                shippingMethodCustomFields={shippingMethodCustomFields}
                                onChanged={completed}
                                onError={setActionError}
                            />
                        )}
                        {tab === 'BUSINESS' && canReadBusinessSettings && (
                            <BusinessBasicsPanel onChanged={completed} onError={setActionError} />
                        )}
                        {tab === 'CURRENCY' && canReadFinance && <CurrencyAndRatesPanel />}
                        {tab === 'USDT' && canReadFinance && <StoreUsdtPanel />}
                    </>
                )}
            </main>
            {storeEditor && (
                <StoreEditor
                    key={storeEditor.id}
                    profile={storeEditor}
                    sellers={query.data?.sellers.items ?? []}
                    sellerOptionsReady={Boolean(
                        query.data && query.data.sellers.items.length >= query.data.sellers.totalItems,
                    )}
                    onClose={() => setStoreEditor(null)}
                    onCompleted={completed}
                    onError={setActionError}
                />
            )}
            {deprovisionProfile && (
                <StoreDeprovisionDialog
                    profile={deprovisionProfile}
                    allowPermanentDeprovision={allowPermanentDeprovision}
                    onClose={() => {
                        setDeprovisionProfile(null);
                        void query.refetch();
                    }}
                    onCompleted={async message => {
                        setDeprovisionProfile(null);
                        await completed(message);
                    }}
                    onError={setActionError}
                />
            )}
            {provisionOpen && (
                <ProvisionStoreDialog
                    templates={query.data?.storeProvisioningTemplates ?? []}
                    onClose={() => setProvisionOpen(false)}
                    onCompleted={async message => {
                        setNotice(message);
                        setActionError('');
                        await query.refetch();
                    }}
                    onError={setActionError}
                />
            )}
            {sellerOpen && (
                <SellerDialog
                    customFieldDefinitions={sellerCustomFields}
                    onClose={() => setSellerOpen(false)}
                    onCompleted={completed}
                    onError={setActionError}
                />
            )}
        </div>
    );
}

function permissionAuditLabel(action: string): string {
    const labels: Record<string, string> = {
        CREATE_MANAGED_ADMINISTRATOR: '创建受管管理员',
        UPDATE_MANAGED_ADMINISTRATOR: '更新受管管理员',
        SUSPEND_MANAGED_ADMINISTRATOR: '停用受管管理员',
        CREATE_MANAGED_ROLE: '创建岗位角色',
        UPDATE_MANAGED_ROLE: '更新岗位角色',
        TRANSFER_PLATFORM_OWNERSHIP: '转移平台所有权',
        TRANSFER_STORE_ADMINISTRATION: '转移店铺主管理员',
    };
    return labels[action] ?? '权限设置变更';
}

function governanceRequestTypeLabel(requestType: string): string {
    const labels: Record<string, string> = {
        LEGAL_IDENTITY: '法律主体资料',
        PAYOUT_ACCOUNT: '收款账户',
        PAYMENT_CONFIGURATION: '支付配置',
        USDT_WALLET: 'USDT 收款钱包',
    };
    return labels[requestType] ?? '店铺治理申请';
}

function governanceStatusLabel(
    request: MyStoreSettingsResult['myStoreGovernanceChanges'][number] | undefined,
): string {
    if (!request) return '尚未提交';
    if (request.status === 'PENDING') return '待平台审核';
    if (request.status === 'APPROVED') return '已批准';
    if (request.status === 'REJECTED') return `已驳回：${request.reviewReason ?? '未填写原因'}`;
    return '已取消';
}

function governancePayloadRows(payload: Record<string, unknown>): Array<[string, string]> {
    const labels: Record<string, string> = {
        legalEntityName: '主体名称',
        legalRegistrationCountry: '注册国家或地区',
        provider: '收款机构',
        accountHolder: '账户持有人',
        accountIdentifier: '收款账号',
    };
    return Object.entries(payload).map(([key, value]) => [
        labels[key] ?? '申请内容',
        typeof value === 'string' ? value : String(value ?? '—'),
    ]);
}
