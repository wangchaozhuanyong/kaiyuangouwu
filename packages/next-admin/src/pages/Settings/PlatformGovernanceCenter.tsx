import { useMutation } from '@apollo/client/react';
import { Plus, RefreshCw, Store } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AdminButton, AdminSelect } from '../../components/AdminControls';
import { useConfirmDialog } from '../../components/confirm-dialog-context';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import {
    REVIEW_STORE_GOVERNANCE_CHANGE_MUTATION,
    type StoreManagementResult,
    type StoreProfileRecord,
} from '../../graphql/management.graphql';
import { useAdminPermissions } from '../../hooks/use-admin-permissions';
import { useAdminQuery as useQuery } from '../../hooks/use-admin-query';
import { useStandaloneAdminPage } from '../../hooks/use-standalone-admin-page';
import { useStorePublicPreview } from '../../hooks/use-store-public-preview';
import { useUrlTab } from '../../hooks/use-url-tab';
import { getChannelDisplayName } from '../../utils/channel-display';
import { dataTableSortPolicy } from '../../utils/data-table-sort-policy';
import { mergeQueryLists } from '../../utils/merge-query-lists';
import { selectQueryFields } from '../../utils/select-query-fields';
import { toUserFacingError } from '../../utils/user-facing-error';
import { BusinessBasicsPanel } from './BusinessSettingsPanels';
import { PaymentShippingManager } from './PaymentShippingManager';
import {
    ErrorState,
    Message,
    SettingsContentSkeleton,
    inputClass,
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
import { StoreGovernanceHistory } from './StoreGovernanceHistory';
import {
    governancePayloadRows,
    governanceRequestTypeLabel,
    storeSettingsSubtitle,
} from './StoreGovernanceLabels';
import { CommerceModePanel, DomainsPanel, SellersPanel, StoresPanel } from './StorePanels';
import { StoreSettingsNavigation } from './StoreSettingsNavigation';
import { UsdtPaymentSetupPanel } from './UsdtPaymentSetupPanel';
const directoryOptions = (skip: number) => ({ skip, take: 100, sort: dataTableSortPolicy.newestCreated });

export function PlatformGovernanceCenter({
    allowPermanentDeprovision,
}: {
    allowPermanentDeprovision: boolean;
}) {
    const standalonePage = useStandaloneAdminPage();
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
    const query = useQuery<StoreManagementResult>(
        standalonePage
            ? selectQueryFields(document, [
                  'activeAdministrator',
                  'activeChannel',
                  ...(standalonePage.key === 'stores'
                      ? ['storeProfiles', 'storeProvisioningTemplates']
                      : standalonePage.key === 'review' || standalonePage.key === 'payout'
                        ? ['storeGovernanceChanges', 'storeProfiles']
                        : standalonePage.key === 'audits'
                          ? ['administratorPermissionAudits']
                          : tab === 'DOMAINS'
                            ? ['storeProfiles']
                            : tab === 'SELLERS'
                              ? ['sellers', 'storeProfiles']
                              : tab === 'PAYMENT'
                                ? [
                                      'paymentMethods',
                                      'paymentMethodEligibilityCheckers',
                                      'paymentMethodHandlers',
                                  ]
                                : tab === 'SHIPPING'
                                  ? [
                                        'shippingMethods',
                                        'shippingEligibilityCheckers',
                                        'shippingCalculators',
                                        'fulfillmentHandlers',
                                    ]
                                  : []),
              ])
            : document,
        {
            variables: {
                sellerOptions: directoryOptions(0),
                paymentMethodOptions: directoryOptions(0),
                shippingMethodOptions: directoryOptions(0),
            },
        },
    );
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
        const sellerCount = data.sellers?.items.length ?? 0;
        const paymentCount = data.paymentMethods?.items.length ?? 0;
        const shippingCount = data.shippingMethods?.items.length ?? 0;
        if (
            sellerCount >= (data.sellers?.totalItems ?? 0) &&
            paymentCount >= (data.paymentMethods?.totalItems ?? 0) &&
            shippingCount >= (data.shippingMethods?.totalItems ?? 0)
        )
            return;
        loadingAllStoreSettingsRef.current = true;
        void fetchMoreStoreSettings({
            variables: {
                sellerOptions: directoryOptions(sellerCount),
                paymentMethodOptions: directoryOptions(paymentCount),
                shippingMethodOptions: directoryOptions(shippingCount),
            },
            updateQuery: (previous, { fetchMoreResult }) =>
                mergeQueryLists(previous, fetchMoreResult, ['sellers', 'paymentMethods', 'shippingMethods']),
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
        query.data?.storeGovernanceChanges?.filter(
            item =>
                item.status === 'PENDING' &&
                (!standalonePage ||
                    item.requestType ===
                        (standalonePage.detail === 'payout' ? 'PAYOUT_ACCOUNT' : 'LEGAL_IDENTITY')),
        ) ?? [];
    const pendingPayloadColumns = [
        ...new Set([
            ...(standalonePage?.detail === 'payout'
                ? ['provider', 'accountHolder', 'accountIdentifier']
                : []),
            ...pendingGovernance.flatMap(request =>
                Object.keys(request.reviewPayload ?? request.maskedSummary),
            ),
        ]),
    ].map(key => ({ key, label: governancePayloadRows({ [key]: null })[0][0] }));
    const recentPermissionAudits =
        query.data?.administratorPermissionAudits?.slice(0, standalonePage ? undefined : 5) ?? [];
    const domainProfiles = profiles.filter(profile => profile.channel.code !== '__default_channel__');
    const selectedProfile =
        domainProfiles.find(profile => profile.id === selectedStoreId) ?? domainProfiles[0] ?? null;
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

    const publicPreview = useStorePublicPreview(completed, setActionError);
    const togglePublicPreview = async (profile: StoreProfileRecord) => {
        if (profile.channel.id !== query.data?.activeChannel.id) {
            setActionError('请先将当前店铺切换到要开放预览的店铺');
            return;
        }
        await publicPreview.togglePublicPreview(profile);
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
            <header className="shrink-0 border-b border-slate-200 bg-white px-5 py-3 sm:px-6">
                <div className="mx-auto flex w-full max-w-none flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="admin-page-title-line">
                        <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
                            <Store className="h-5 w-5 text-blue-600" />
                            {standalonePage?.title ?? '平台治理中心'}
                            <FeatureHelpButton
                                topic="settings.store-profile"
                                title="平台治理中心"
                                description={'集中管理全部店铺、主体与支付审批、平台级配送和经营政策'}
                            />
                        </h1>
                        <p className="text-xs text-slate-500">{storeSettingsSubtitle(standalonePage?.key)}</p>
                    </div>
                    <div className="flex gap-2">
                        <AdminButton
                            refreshPage
                            type="button"
                            onClick={() => void query.refetch()}
                            disabled={query.loading}
                            className={secondaryButton}
                            aria-label="刷新"
                        >
                            <RefreshCw
                                className={`h-4 w-4 ${query.loading && !query.data ? 'animate-spin' : ''}`}
                            />
                        </AdminButton>
                        <AdminButton
                            hidden={Boolean(standalonePage && standalonePage.key !== 'stores')}
                            type="button"
                            onClick={() => setProvisionOpen(true)}
                            className={primaryButton}
                        >
                            <Plus className="h-4 w-4" />
                            开通网店
                        </AdminButton>
                    </div>
                </div>
            </header>
            <main className="mx-auto min-h-0 min-w-0 w-full max-w-none flex-1 space-y-4 overflow-y-auto p-4 sm:p-6">
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
                {(pendingGovernance.length > 0 ||
                    Boolean(standalonePage && ['review', 'payout'].includes(standalonePage.detail ?? ''))) &&
                    (!standalonePage || ['review', 'payout'].includes(standalonePage.detail ?? '')) && (
                        <section className="rounded-xl border border-amber-200 bg-white p-4">
                            <div className="mb-3 flex items-center justify-between">
                                <div>
                                    <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                                        待审批的店铺治理变更
                                        <FeatureHelpButton
                                            topic="settings.store-profile"
                                            title="待审批的店铺治理变更"
                                            description={
                                                '店铺提交的主体、收款和支付配置在通过前不会覆盖线上值。'
                                            }
                                        />
                                    </h2>
                                </div>
                                <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-bold text-amber-800">
                                    {pendingGovernance.length} 项
                                </span>
                            </div>
                            <div
                                className="admin-comparison-scroll overflow-x-auto"
                                role="region"
                                aria-label="待审批店铺治理变更"
                                tabIndex={0}
                            >
                                <p className="admin-mobile-table-hint">左右滑动查看完整申请资料</p>
                                <table className="admin-compact-table w-full min-w-[1060px] text-left text-xs">
                                    <thead>
                                        <tr>
                                            {['店铺', '类型', '版本'].map(label => (
                                                <th key={label}>{label}</th>
                                            ))}
                                            {pendingPayloadColumns.map(column => (
                                                <th key={column.key}>{column.label}</th>
                                            ))}
                                            {<th>操作</th>}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {pendingGovernance.map(request => {
                                            const payload = request.reviewPayload ?? request.maskedSummary;
                                            return (
                                                <tr key={request.id}>
                                                    <td className="font-semibold">
                                                        {getChannelDisplayName(request.channel)}
                                                    </td>
                                                    <td>{governanceRequestTypeLabel(request.requestType)}</td>
                                                    <td>{request.version}</td>
                                                    {pendingPayloadColumns.map(column => {
                                                        const value = governancePayloadRows({
                                                            [column.key]: payload[column.key],
                                                        })[0][1];
                                                        return (
                                                            <td
                                                                key={column.key}
                                                                className="max-w-72 truncate"
                                                                title={value}
                                                            >
                                                                {value}
                                                            </td>
                                                        );
                                                    })}
                                                    <td>
                                                        <div className="flex gap-2">
                                                            <AdminButton
                                                                type="button"
                                                                disabled={reviewGovernanceState.loading}
                                                                onClick={() =>
                                                                    void reviewRequest(request.id, 'REJECTED')
                                                                }
                                                                className={secondaryButton}
                                                            >
                                                                驳回
                                                            </AdminButton>
                                                            <AdminButton
                                                                type="button"
                                                                disabled={reviewGovernanceState.loading}
                                                                onClick={() =>
                                                                    void reviewRequest(request.id, 'APPROVED')
                                                                }
                                                                className={primaryButton}
                                                            >
                                                                通过
                                                            </AdminButton>
                                                        </div>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                            {pendingGovernance.length === 0 && (
                                <p className="py-6 text-center text-xs text-slate-500">
                                    当前没有待审批申请。
                                </p>
                            )}
                        </section>
                    )}
                {standalonePage && ['review', 'payout'].includes(standalonePage.detail ?? '') && (
                    <StoreGovernanceHistory
                        payloadType={standalonePage.detail === 'payout' ? 'payout' : 'legal'}
                        records={(query.data?.storeGovernanceChanges ?? []).filter(
                            item =>
                                item.requestType ===
                                (standalonePage.detail === 'payout' ? 'PAYOUT_ACCOUNT' : 'LEGAL_IDENTITY'),
                        )}
                    />
                )}
                {(standalonePage?.key === 'audits' || tab === 'PERMISSION_AUDITS') && (
                    <section className="rounded-xl border border-slate-200 bg-white p-4">
                        <div className="mb-3">
                            <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                                最近权限审计
                                <FeatureHelpButton
                                    topic="settings.team"
                                    title="最近权限审计"
                                    description={'这里只显示脱敏摘要，密码、密钥和凭据不会写入记录。'}
                                />
                            </h2>
                        </div>
                        <div className="divide-y divide-slate-100">
                            {recentPermissionAudits.length === 0 && (
                                <p className="text-xs text-slate-500">暂无权限变更记录。</p>
                            )}
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
                {(!standalonePage ||
                    (tab === 'DOMAINS' && domainProfiles.length > 0) ||
                    tab === 'SELLERS') && (
                    <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                        {!standalonePage && (
                            <StoreSettingsNavigation
                                tab={tab}
                                onTabChange={setTab}
                                canReadFinance={canReadFinance}
                                canReadBusinessSettings={canReadBusinessSettings}
                            />
                        )}
                        {tab === 'DOMAINS' && domainProfiles.length > 0 && (
                            <AdminSelect
                                value={selectedProfile?.id ?? ''}
                                onChange={event => setSelectedStoreId(event.target.value)}
                                className={`${inputClass} w-full xl:w-72`}
                            >
                                {domainProfiles.map(profile => (
                                    <option key={profile.id} value={profile.id}>
                                        {storeName(profile)}
                                    </option>
                                ))}
                            </AdminSelect>
                        )}
                        {tab === 'SELLERS' && (
                            <AdminButton
                                type="button"
                                onClick={() => setSellerOpen(true)}
                                className={primaryButton}
                            >
                                <Plus className="h-3.5 w-3.5" />
                                新增商家主体
                            </AdminButton>
                        )}
                    </div>
                )}
                {query.error && !query.data ? (
                    <ErrorState message={queryError} onRetry={() => void query.refetch()} />
                ) : !initializedStoreSettings ? (
                    <SettingsContentSkeleton label="正在读取平台治理中心" sections={2} />
                ) : (
                    <>
                        {tab === 'STORES' && (
                            <div className="space-y-4">
                                {(!standalonePage || standalonePage.detail === 'commerce') && (
                                    <CommerceModePanel onChanged={completed} onError={setActionError} />
                                )}
                                {(!standalonePage || standalonePage.key === 'stores') && (
                                    <StoresPanel
                                        profiles={profiles}
                                        activeChannelId={query.data?.activeChannel.id ?? ''}
                                        publicPreviewBusy={publicPreview.publicPreviewBusy}
                                        canUpdatePublicPreview={publicPreview.canUpdatePublicPreview}
                                        onTogglePublicPreview={togglePublicPreview}
                                        onEdit={setStoreEditor}
                                        onDeprovision={setDeprovisionProfile}
                                        allowPermanentDeprovision={allowPermanentDeprovision}
                                    />
                                )}
                            </div>
                        )}
                        {tab === 'DOMAINS' && (
                            <DomainsPanel
                                key={selectedProfile?.channel.id ?? 'no-store'}
                                profile={selectedProfile}
                                profiles={domainProfiles}
                                onChanged={message => completed(message)}
                                onError={setActionError}
                            />
                        )}
                        {tab === 'SELLERS' && (
                            <SellersPanel
                                sellers={query.data?.sellers?.items ?? []}
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
                        {tab === 'USDT' &&
                            canReadFinance &&
                            (standalonePage?.key === 'usdt' && hasAnyPermission(['SuperAdmin']) ? (
                                <UsdtPaymentSetupPanel onChanged={completed} onError={setActionError} />
                            ) : (
                                <StoreUsdtPanel />
                            ))}
                    </>
                )}
            </main>
            {storeEditor && (
                <StoreEditor
                    key={storeEditor.id}
                    profile={storeEditor}
                    sellers={query.data?.sellers?.items ?? []}
                    sellerOptionsReady={Boolean(
                        query.data && query.data.sellers?.items.length >= query.data.sellers?.totalItems,
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
