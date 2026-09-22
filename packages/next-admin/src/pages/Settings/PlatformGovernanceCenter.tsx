import { useMutation, useQuery } from '@apollo/client/react';
import { Plus, RefreshCw, Store } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useConfirmDialog } from '../../components/confirm-dialog-context';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import {
    REVIEW_STORE_GOVERNANCE_CHANGE_MUTATION,
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
import { governancePayloadRows, governanceRequestTypeLabel } from './StoreGovernanceLabels';
import { CommerceModePanel, DomainsPanel, SellersPanel, StoresPanel } from './StorePanels';
import { StoreSettingsNavigation } from './StoreSettingsNavigation';
const directoryOptions = (skip: number) => ({ skip, take: 100, sort: dataTableSortPolicy.newestCreated });

export function PlatformGovernanceCenter({
    allowPermanentDeprovision,
}: {
    allowPermanentDeprovision: boolean;
}) {
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
            await completed(decision === 'APPROVED' ? '申请已通过，批准记录已更新' : '申请已驳回');
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
