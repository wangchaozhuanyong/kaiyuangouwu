import { useMutation, useQuery } from '@apollo/client/react';
import {
    AlertCircle,
    Building2,
    CheckCircle2,
    CircleDollarSign,
    Copy,
    CreditCard,
    ExternalLink,
    Globe2,
    Languages,
    LoaderCircle,
    MapPin,
    Pencil,
    Plus,
    ReceiptText,
    RefreshCw,
    Store,
    Trash2,
    WalletCards,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { client } from '../../apollo';
import { useConfirmDialog } from '../../components/confirm-dialog-context';
import { DynamicCustomFieldsForm } from '../../custom-fields/DynamicCustomFieldsForm';
import type { CustomFieldValueMap } from '../../custom-fields/custom-field-types';
// Shared Settings UI components and CSS constants
import {
    addCustomFieldsToDocument,
    customFieldInputFromValues,
    customFieldValuesFromEntity,
    validateCustomFieldValues,
} from '../../custom-fields/custom-field-utils';
import { useCustomFieldDefinitions } from '../../custom-fields/custom-fields-context';
import {
    STORE_COMMERCE_MODE_QUERY,
    UPDATE_STORE_COMMERCE_MODE_MUTATION,
    type StoreCommerceMode,
    type StoreCommerceModeData,
} from '../../graphql/commerce.graphql';
import {
    ADD_BUSINESS_ZONE_MEMBERS_MUTATION,
    BUSINESS_SETTINGS_QUERY,
    CREATE_BUSINESS_COUNTRY_MUTATION,
    CREATE_BUSINESS_TAX_CATEGORY_MUTATION,
    CREATE_BUSINESS_TAX_RATE_MUTATION,
    CREATE_BUSINESS_ZONE_MUTATION,
    CREATE_SELLER_MUTATION,
    CREATE_STORE_DOMAIN_MUTATION,
    DELETE_BUSINESS_COUNTRY_MUTATION,
    DELETE_BUSINESS_TAX_CATEGORY_MUTATION,
    DELETE_BUSINESS_TAX_RATE_MUTATION,
    DELETE_BUSINESS_ZONE_MUTATION,
    DELETE_SELLER_MUTATION,
    DELETE_STORE_DOMAIN_MUTATION,
    DEPROVISION_STORE_MUTATION,
    PROVISION_STORE_MUTATION,
    REMOVE_BUSINESS_ZONE_MEMBERS_MUTATION,
    SET_PRIMARY_STORE_DOMAIN_MUTATION,
    STORE_DEPROVISION_IMPACT_QUERY,
    STORE_DOMAINS_QUERY,
    STORE_MANAGEMENT_QUERY,
    SUSPEND_STORE_MUTATION,
    UPDATE_BUSINESS_CHANNEL_MUTATION,
    UPDATE_BUSINESS_COUNTRY_MUTATION,
    UPDATE_BUSINESS_TAX_CATEGORY_MUTATION,
    UPDATE_BUSINESS_TAX_RATE_MUTATION,
    UPDATE_BUSINESS_ZONE_MUTATION,
    UPDATE_GLOBAL_SETTINGS_MUTATION,
    UPDATE_SELLER_MUTATION,
    UPDATE_STORE_PROFILE_MUTATION,
    VERIFY_STORE_DOMAIN_MUTATION,
    type BusinessSettingsResult,
    type StoreDeprovisionImpactRecord,
    type StoreDomainRecord,
    type StoreDomainsResult,
    type StoreManagementResult,
    type StoreProfileRecord,
} from '../../graphql/management.graphql';
import { useAdminPermissions } from '../../hooks/use-admin-permissions';
import { useUrlTab } from '../../hooks/use-url-tab';
import { getChannelDisplayName } from '../../utils/channel-display';
import { toUserFacingError } from '../../utils/user-facing-error';
import { formatDateTime } from '../Sales/sales-utils';
import { PaymentShippingManager } from './PaymentShippingManager';
import { CurrencyAndRatesPanel, StoreUsdtPanel } from './StoreFinancePanel';
import {
    EmptyState,
    ErrorState,
    Field,
    ImpactStat,
    LoadingState,
    Message,
    Modal,
    ModalActions,
    StatusBadge,
    StoreInfo,
    TabButton,
    errorText,
    inputClass,
    mergeById,
    primaryButton,
    secondaryButton,
    splitCodes,
    theadClass,
} from './settings-ui';

type Tab = 'STORES' | 'DOMAINS' | 'SELLERS' | 'PAYMENT_SHIPPING' | 'BUSINESS' | 'CURRENCY' | 'USDT';
const STORE_SETTINGS_TABS = {
    stores: 'STORES',
    domains: 'DOMAINS',
    sellers: 'SELLERS',
    'payment-shipping': 'PAYMENT_SHIPPING',
    business: 'BUSINESS',
    currency: 'CURRENCY',
    usdt: 'USDT',
} as const;

export function StoreSettingsModule() {
    const { hasAnyPermission } = useAdminPermissions();
    const sellerCustomFields = useCustomFieldDefinitions('Seller');
    const paymentMethodCustomFields = useCustomFieldDefinitions('PaymentMethod');
    const shippingMethodCustomFields = useCustomFieldDefinitions('ShippingMethod');
    const storeManagementDocument = useMemo(() => {
        const withSellers = addCustomFieldsToDocument(STORE_MANAGEMENT_QUERY, 'Seller', sellerCustomFields);
        const withPaymentMethods = addCustomFieldsToDocument(
            withSellers,
            'PaymentMethod',
            paymentMethodCustomFields,
        );
        return addCustomFieldsToDocument(withPaymentMethods, 'ShippingMethod', shippingMethodCustomFields);
    }, [paymentMethodCustomFields, sellerCustomFields, shippingMethodCustomFields]);
    const [tab, setTab] = useUrlTab<Tab>(STORE_SETTINGS_TABS, 'stores');
    const [selectedStoreId, setSelectedStoreId] = useState('');
    const [storeEditor, setStoreEditor] = useState<StoreProfileRecord | null>(null);
    const [deprovisionProfile, setDeprovisionProfile] = useState<StoreProfileRecord | null>(null);
    const [provisionOpen, setProvisionOpen] = useState(false);
    const [sellerOpen, setSellerOpen] = useState(false);
    const [notice, setNotice] = useState('');
    const [actionError, setActionError] = useState('');
    const loadingAllStoreSettingsRef = useRef(false);
    const query = useQuery<StoreManagementResult>(storeManagementDocument, {
        variables: {
            sellerOptions: { skip: 0, take: 100, sort: { createdAt: 'DESC' } },
            paymentMethodOptions: { skip: 0, take: 100, sort: { createdAt: 'DESC' } },
            shippingMethodOptions: { skip: 0, take: 100, sort: { createdAt: 'DESC' } },
        },
        fetchPolicy: 'cache-and-network',
    });
    const {
        data: storeSettingsData,
        error: storeSettingsError,
        fetchMore: fetchMoreStoreSettings,
        loading: storeSettingsLoading,
    } = query;

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
                sellerOptions: { skip: sellerCount, take: 100, sort: { createdAt: 'DESC' } },
                paymentMethodOptions: { skip: paymentCount, take: 100, sort: { createdAt: 'DESC' } },
                shippingMethodOptions: { skip: shippingCount, take: 100, sort: { createdAt: 'DESC' } },
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
            });
    }, [fetchMoreStoreSettings, storeSettingsData, storeSettingsError, storeSettingsLoading]);
    const profiles = useMemo(
        () => [...(query.data?.storeProfiles ?? [])].sort((a, b) => a.sortOrder - b.sortOrder),
        [query.data?.storeProfiles],
    );
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

    return (
        <div className="flex h-full flex-col bg-slate-50">
            <header className="shrink-0 border-b border-slate-200 bg-white px-5 py-4 sm:px-8">
                <div className="mx-auto flex w-full max-w-none flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
                            <Store className="h-5 w-5 text-blue-600" />
                            店铺综合设置
                        </h1>
                        <p className="mt-1 text-xs text-slate-500">
                            店铺、域名、商家、支付交付及平台业务基础配置集中管理
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
            <main className="mx-auto w-full max-w-none flex-1 space-y-4 overflow-y-auto p-5 sm:p-8">
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
                <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                    <div className="scrollbar-hidden flex w-max max-w-full overflow-x-auto rounded-lg border border-slate-200 bg-white p-1">
                        <TabButton
                            active={tab === 'STORES'}
                            onClick={() => setTab('STORES')}
                            icon={<Store className="h-3.5 w-3.5" />}
                        >
                            店铺实例
                        </TabButton>
                        <TabButton
                            active={tab === 'DOMAINS'}
                            onClick={() => setTab('DOMAINS')}
                            icon={<Globe2 className="h-3.5 w-3.5" />}
                        >
                            独立域名
                        </TabButton>
                        <TabButton
                            active={tab === 'SELLERS'}
                            onClick={() => setTab('SELLERS')}
                            icon={<Building2 className="h-3.5 w-3.5" />}
                        >
                            商家主体
                        </TabButton>
                        <TabButton
                            active={tab === 'PAYMENT_SHIPPING'}
                            onClick={() => setTab('PAYMENT_SHIPPING')}
                            icon={<CreditCard className="h-3.5 w-3.5" />}
                        >
                            支付与交付
                        </TabButton>
                        {canReadFinance && (
                            <TabButton
                                active={tab === 'CURRENCY'}
                                onClick={() => setTab('CURRENCY')}
                                icon={<CircleDollarSign className="h-3.5 w-3.5" />}
                            >
                                币种与汇率
                            </TabButton>
                        )}
                        {canReadFinance && (
                            <TabButton
                                active={tab === 'USDT'}
                                onClick={() => setTab('USDT')}
                                icon={<WalletCards className="h-3.5 w-3.5" />}
                            >
                                USDT 收款
                            </TabButton>
                        )}
                        {canReadBusinessSettings && (
                            <TabButton
                                active={tab === 'BUSINESS'}
                                onClick={() => setTab('BUSINESS')}
                                icon={<ReceiptText className="h-3.5 w-3.5" />}
                            >
                                业务基础
                            </TabButton>
                        )}
                    </div>
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
                {query.loading && !query.data ? (
                    <LoadingState />
                ) : query.error ? (
                    <ErrorState message={query.error.message} onRetry={() => void query.refetch()} />
                ) : (
                    <>
                        {tab === 'STORES' && (
                            <div className="space-y-4">
                                <CommerceModePanel onChanged={completed} onError={setActionError} />
                                <StoresPanel
                                    profiles={profiles}
                                    onEdit={setStoreEditor}
                                    onDeprovision={setDeprovisionProfile}
                                />
                            </div>
                        )}
                        {tab === 'DOMAINS' && (
                            <DomainsPanel
                                profile={selectedProfile}
                                onChanged={message => completed(message)}
                                onError={setActionError}
                            />
                        )}
                        {tab === 'SELLERS' && (
                            <SellersPanel
                                sellers={query.data?.sellers.items ?? []}
                                customFieldDefinitions={sellerCustomFields}
                                onChanged={completed}
                                onError={setActionError}
                            />
                        )}
                        {tab === 'PAYMENT_SHIPPING' && (
                            <PaymentShippingManager
                                data={query.data!}
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
                    profile={storeEditor}
                    onClose={() => setStoreEditor(null)}
                    onCompleted={completed}
                    onError={setActionError}
                />
            )}
            {deprovisionProfile && (
                <StoreDeprovisionDialog
                    profile={deprovisionProfile}
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

function CommerceModePanel({
    onChanged,
    onError,
}: {
    onChanged: (message: string) => Promise<void>;
    onError: (message: string) => void;
}) {
    const requestConfirmation = useConfirmDialog();
    const modeQuery = useQuery<StoreCommerceModeData>(STORE_COMMERCE_MODE_QUERY, {
        fetchPolicy: 'cache-and-network',
    });
    const currentMode = modeQuery.data?.myStoreCommerceMode.mode ?? 'DIGITAL_ONLY';
    const [selectedMode, setSelectedMode] = useState<StoreCommerceMode>(currentMode);
    const [updateMode, updateState] = useMutation<{
        updateMyStoreCommerceMode: StoreCommerceModeData['myStoreCommerceMode'];
    }>(UPDATE_STORE_COMMERCE_MODE_MUTATION);

    /* oxlint-disable react/set-state-in-effect */
    useEffect(() => setSelectedMode(currentMode), [currentMode]);
    /* oxlint-enable react/set-state-in-effect */

    const submit = async () => {
        if (selectedMode === currentMode) return;
        const confirmation = await requestConfirmation({
            title: '确认切换店铺经营模式？',
            description:
                '系统会检查不兼容商品、未完成订单和包装配置。存在冲突时会阻止切换，并且不会产生半完成修改。',
            confirmLabel: '检查并切换',
            tone: 'warning',
        });
        if (!confirmation) return;
        try {
            await updateMode({ variables: { mode: selectedMode } });
            await Promise.all([
                modeQuery.refetch(),
                client.refetchQueries({
                    include: ['NextAdminAppShellBootstrap', 'GetProducts'],
                }),
            ]);
            await onChanged('当前店铺经营模式已更新，商品与后台模块已按新模式刷新');
        } catch (error) {
            onError(toUserFacingError(error, '经营模式切换失败，请检查冲突后重试'));
        }
    };

    if (modeQuery.loading && !modeQuery.data) {
        return (
            <section className="rounded-xl border border-slate-200 bg-white p-5 text-xs text-slate-500">
                正在读取当前店铺经营模式…
            </section>
        );
    }

    return (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex flex-col gap-4 border-b border-slate-100 pb-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                    <h2 className="text-sm font-bold text-slate-900">当前店铺经营模式</h2>
                    <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-400">
                        控制可创建的商品类型、结账收货信息，以及后台显示的库存仓库或数字交付模块。
                    </p>
                </div>
                <button
                    type="button"
                    onClick={() => void submit()}
                    disabled={selectedMode === currentMode || updateState.loading}
                    className={primaryButton}
                >
                    {updateState.loading ? '冲突检查中…' : '保存经营模式'}
                </button>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
                {(
                    [
                        [
                            'DIGITAL_ONLY',
                            '仅虚拟商品',
                            '只收集交付邮箱；显示自动发卡、人工交付、文件下载和虚拟库存。',
                        ],
                        [
                            'PHYSICAL_ONLY',
                            '仅实物商品',
                            '只收集实际地址；显示库存、仓库、物流、包装与自动拆箱。',
                        ],
                        [
                            'HYBRID',
                            '混合经营',
                            '允许分别创建实物或虚拟商品；混合订单同时收集地址和交付邮箱。',
                        ],
                    ] as const
                ).map(([mode, title, detail]) => (
                    <button
                        key={mode}
                        type="button"
                        onClick={() => setSelectedMode(mode)}
                        aria-pressed={selectedMode === mode}
                        className={`rounded-xl border p-4 text-left transition-colors ${selectedMode === mode ? 'border-blue-500 bg-blue-50' : 'border-slate-200 hover:bg-slate-50'}`}
                    >
                        <span className="flex items-center justify-between gap-2 text-xs font-bold text-slate-900">
                            {title}
                            {currentMode === mode && (
                                <span className="rounded bg-emerald-100 px-2 py-0.5 text-[10px] text-emerald-700">
                                    当前
                                </span>
                            )}
                        </span>
                        <span className="mt-2 block text-[11px] leading-5 text-slate-500">{detail}</span>
                    </button>
                ))}
            </div>
        </section>
    );
}

function StoresPanel({
    profiles,
    onEdit,
    onDeprovision,
}: {
    profiles: StoreProfileRecord[];
    onEdit: (profile: StoreProfileRecord) => void;
    onDeprovision: (profile: StoreProfileRecord) => void;
}) {
    if (!profiles.length)
        return (
            <EmptyState
                icon={<Store className="h-8 w-8" />}
                title="还没有店铺实例"
                detail="点击右上角“开通网店”创建独立店铺、商家账号和权限角色。"
            />
        );
    return (
        <div className="grid gap-4 lg:grid-cols-2">
            {profiles.map(profile => (
                <article
                    key={profile.id}
                    className="overflow-hidden rounded-xl border border-slate-200 bg-white"
                >
                    <div className="flex items-start justify-between gap-4 border-b border-slate-100 p-5">
                        <div className="flex min-w-0 gap-3">
                            {profile.logoAsset?.preview ? (
                                <img
                                    src={profile.logoAsset.preview}
                                    alt=""
                                    className="h-11 w-11 rounded-lg border border-slate-200 object-cover"
                                />
                            ) : (
                                <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
                                    <Store className="h-5 w-5" />
                                </div>
                            )}
                            <div className="min-w-0">
                                <h2 className="truncate text-sm font-bold text-slate-900">
                                    {storeName(profile)}
                                </h2>
                                <p className="mt-1 font-mono text-[10px] text-slate-400">
                                    {getChannelDisplayName(profile.channel.code)}
                                </p>
                            </div>
                        </div>
                        <StatusBadge status={profile.status} operational={profile.isOperational} />
                    </div>
                    <div className="grid grid-cols-2 gap-px bg-slate-100 text-xs">
                        <StoreInfo label="商家主体" value={profile.channel.seller?.name ?? '未绑定'} />
                        <StoreInfo label="默认币种" value={profile.channel.defaultCurrencyCode} />
                        <StoreInfo label="主域名" value={profile.primaryDomain ?? '待绑定'} />
                        <StoreInfo
                            label="上线检查"
                            value={
                                profile.activationReadiness.ready
                                    ? '已通过'
                                    : `${profile.activationReadiness.checks.filter(item => !item.ready).length} 项待处理`
                            }
                            tone={profile.activationReadiness.ready ? 'green' : 'amber'}
                        />
                    </div>
                    <div className="p-5">
                        <p className="line-clamp-2 min-h-10 text-xs leading-5 text-slate-500">
                            {profile.descriptionZh || '暂未填写店铺介绍'}
                        </p>
                        {!profile.activationReadiness.ready && (
                            <div className="mt-3 rounded-lg bg-amber-50 p-3 text-[10px] leading-4 text-amber-800">
                                {profile.activationReadiness.checks
                                    .filter(item => !item.ready)
                                    .map(item => item.message)
                                    .join('；')}
                            </div>
                        )}
                        <div className="mt-4 flex justify-between">
                            <span className="text-[10px] text-slate-400">
                                更新于 {formatDateTime(profile.updatedAt)}
                            </span>
                            <div className="flex gap-2">
                                <button
                                    type="button"
                                    onClick={() => onDeprovision(profile)}
                                    className={`${secondaryButton} text-rose-600`}
                                >
                                    <Trash2 className="h-3.5 w-3.5" />
                                    安全清退
                                </button>
                                {profile.storefrontUrl && (
                                    <a
                                        href={profile.storefrontUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                        className={secondaryButton}
                                    >
                                        <ExternalLink className="h-3.5 w-3.5" />
                                        访问店铺
                                    </a>
                                )}
                                <button
                                    type="button"
                                    onClick={() => onEdit(profile)}
                                    className={secondaryButton}
                                >
                                    <Pencil className="h-3.5 w-3.5" />
                                    编辑档案
                                </button>
                            </div>
                        </div>
                    </div>
                </article>
            ))}
        </div>
    );
}

function DomainsPanel({
    profile,
    onChanged,
    onError,
}: {
    profile: StoreProfileRecord | null;
    onChanged: (message: string) => Promise<void>;
    onError: (message: string) => void;
}) {
    const requestConfirmation = useConfirmDialog();
    const [domain, setDomain] = useState('');
    const query = useQuery<StoreDomainsResult>(STORE_DOMAINS_QUERY, {
        variables: { channelId: profile?.channel.id ?? '' },
        skip: !profile,
        fetchPolicy: 'cache-and-network',
    });
    const [create, createState] = useMutation(CREATE_STORE_DOMAIN_MUTATION);
    const [verify, verifyState] = useMutation<{ verifyStoreDomain: { success: boolean; message: string } }>(
        VERIFY_STORE_DOMAIN_MUTATION,
    );
    const [setPrimary, primaryState] = useMutation(SET_PRIMARY_STORE_DOMAIN_MUTATION);
    const [remove, removeState] = useMutation<{
        deleteStoreDomain: { result: string; message: string | null };
    }>(DELETE_STORE_DOMAIN_MUTATION);
    if (!profile)
        return (
            <EmptyState
                icon={<Globe2 className="h-8 w-8" />}
                title="没有可管理的店铺"
                detail="请先开通网店。"
            />
        );
    const refresh = async (message: string) => {
        await query.refetch();
        await onChanged(message);
    };
    const add = async () => {
        if (!domain.trim()) return onError('请输入需要绑定的域名');
        try {
            await create({
                variables: {
                    input: {
                        channelId: profile.channel.id,
                        domain: domain.trim().toLowerCase(),
                        isPrimary: (query.data?.storeDomains.length ?? 0) === 0,
                    },
                },
            });
            setDomain('');
            await refresh('域名已添加，请按提示配置 DNS 后执行验证');
        } catch (error) {
            onError(errorText(error));
        }
    };
    const verifyDomain = async (item: StoreDomainRecord) => {
        try {
            const response = await verify({ variables: { id: item.id } });
            const result = response.data?.verifyStoreDomain;
            if (!result?.success) throw new Error(result?.message || '验证失败');
            await refresh('域名 DNS 验证已通过');
        } catch (error) {
            onError(errorText(error));
        }
    };
    const makePrimary = async (item: StoreDomainRecord) => {
        try {
            await setPrimary({ variables: { id: item.id } });
            await refresh('主域名已切换');
        } catch (error) {
            onError(errorText(error));
        }
    };
    const destroy = async (item: StoreDomainRecord) => {
        if (
            !(await requestConfirmation({
                title: `移除域名 ${item.domain}？`,
                description: item.isPrimary
                    ? '这是当前主域名。移除后店铺访问地址可能受到影响，请先确认已有可用域名。'
                    : '移除后该域名将不再指向当前店铺。',
                confirmLabel: '确认移除',
                tone: 'danger',
            }))
        )
            return;
        try {
            const response = await remove({ variables: { id: item.id } });
            const result = response.data?.deleteStoreDomain;
            if (!result || result.result !== 'DELETED') throw new Error(result?.message || '移除失败');
            await refresh('域名已移除');
        } catch (error) {
            onError(errorText(error));
        }
    };
    const busy = createState.loading || verifyState.loading || primaryState.loading || removeState.loading;
    return (
        <div className="space-y-4">
            <section className="rounded-xl border border-slate-200 bg-white p-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                    <div>
                        <h2 className="text-sm font-bold text-slate-900">{storeName(profile)} · 独立域名</h2>
                        <p className="mt-1 text-xs text-slate-400">
                            先将域名 CNAME 指向{' '}
                            <code className="font-mono text-slate-600">
                                {query.data?.storeDomainConfiguration.cnameTarget ?? '读取中…'}
                            </code>
                            ，再点击验证
                        </p>
                    </div>
                    <div className="flex w-full gap-2 lg:w-auto">
                        <input
                            value={domain}
                            onChange={event => setDomain(event.target.value)}
                            onKeyDown={event => {
                                if (event.key === 'Enter') void add();
                            }}
                            placeholder="shop.example.com"
                            className={`${inputClass} lg:w-72`}
                        />
                        <button
                            type="button"
                            onClick={() => void add()}
                            disabled={busy || !domain.trim()}
                            className={primaryButton}
                        >
                            <Plus className="h-3.5 w-3.5" />
                            添加域名
                        </button>
                    </div>
                </div>
            </section>
            {query.loading && !query.data ? (
                <LoadingState />
            ) : query.error ? (
                <ErrorState message={query.error.message} onRetry={() => void query.refetch()} />
            ) : (
                <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                    <div className="divide-y divide-slate-100">
                        {(query.data?.storeDomains ?? []).map(item => (
                            <div
                                key={item.id}
                                className="flex flex-col gap-4 p-5 xl:flex-row xl:items-center xl:justify-between"
                            >
                                <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <strong className="font-mono text-sm text-slate-900">
                                            {item.domain}
                                        </strong>
                                        <span
                                            className={`rounded px-2 py-0.5 text-[9px] font-bold ${item.status === 'ACTIVE' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}
                                        >
                                            {item.status === 'ACTIVE' ? '已验证' : '待验证'}
                                        </span>
                                        {item.isPrimary && (
                                            <span className="rounded bg-blue-50 px-2 py-0.5 text-[9px] font-bold text-blue-700">
                                                主域名
                                            </span>
                                        )}
                                    </div>
                                    {item.status !== 'ACTIVE' && (
                                        <div className="mt-2 space-y-1 text-[10px] text-slate-500">
                                            <div>
                                                记录名：
                                                <code className="select-all font-mono text-slate-700">
                                                    {item.verificationRecordName}
                                                </code>
                                            </div>
                                            <div>
                                                记录值：
                                                <code className="select-all break-all font-mono text-slate-700">
                                                    {item.verificationRecordValue}
                                                </code>
                                            </div>
                                        </div>
                                    )}
                                    {item.lastVerificationError && (
                                        <p className="mt-2 text-[10px] text-rose-600">
                                            {item.lastVerificationError}
                                        </p>
                                    )}
                                </div>
                                <div className="flex shrink-0 flex-wrap gap-2">
                                    {item.status !== 'ACTIVE' && (
                                        <button
                                            type="button"
                                            onClick={() => void verifyDomain(item)}
                                            disabled={busy}
                                            className={secondaryButton}
                                        >
                                            验证 DNS
                                        </button>
                                    )}
                                    {item.status === 'ACTIVE' && !item.isPrimary && (
                                        <button
                                            type="button"
                                            onClick={() => void makePrimary(item)}
                                            disabled={busy}
                                            className={secondaryButton}
                                        >
                                            设为主域名
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => void destroy(item)}
                                        disabled={busy}
                                        className={`${secondaryButton} text-rose-600`}
                                    >
                                        <Trash2 className="h-3.5 w-3.5" />
                                        移除
                                    </button>
                                </div>
                            </div>
                        ))}
                        {!query.data?.storeDomains.length && (
                            <div className="p-12 text-center text-xs text-slate-400">
                                当前店铺尚未绑定独立域名
                            </div>
                        )}
                    </div>
                </section>
            )}
        </div>
    );
}

function SellersPanel({
    sellers,
    customFieldDefinitions,
    onChanged,
    onError,
}: {
    sellers: StoreManagementResult['sellers']['items'];
    customFieldDefinitions: ReturnType<typeof useCustomFieldDefinitions>;
    onChanged: (message: string) => Promise<void>;
    onError: (message: string) => void;
}) {
    const requestConfirmation = useConfirmDialog();
    const [editing, setEditing] = useState<StoreManagementResult['sellers']['items'][number] | null>(null);
    const [remove, state] = useMutation<{
        deleteSeller: { result: string; message?: string | null };
    }>(DELETE_SELLER_MUTATION);
    const deleteSeller = async (seller: StoreManagementResult['sellers']['items'][number]) => {
        const confirmed = await requestConfirmation({
            title: '删除商家主体',
            description: `确定删除“${seller.name}”？如果仍被 Channel 使用，后端会拒绝删除。`,
            confirmLabel: '确认删除',
            tone: 'danger',
        });
        if (!confirmed) return;
        try {
            const response = await remove({ variables: { id: seller.id } });
            if (response.data?.deleteSeller.result !== 'DELETED')
                throw new Error(response.data?.deleteSeller.message || '商家主体未删除');
            await onChanged('商家主体已删除');
        } catch (error) {
            onError(errorText(error));
        }
    };
    return (
        <>
            <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                <div className="overflow-x-auto">
                    <table className="w-full min-w-[760px] border-collapse text-left text-xs">
                        <thead>
                            <tr className={theadClass}>
                                <th
                                    scope="col"
                                    className="sticky left-0 z-20 w-52 whitespace-nowrap bg-slate-50 px-3 py-3"
                                >
                                    商家主体
                                </th>
                                <th scope="col" className="w-56 whitespace-nowrap px-3 py-3">
                                    ID
                                </th>
                                <th scope="col" className="w-40 whitespace-nowrap px-3 py-3">
                                    创建时间
                                </th>
                                <th scope="col" className="w-40 whitespace-nowrap px-3 py-3">
                                    更新时间
                                </th>
                                <th
                                    scope="col"
                                    className="sticky right-0 z-20 w-24 whitespace-nowrap border-l border-slate-200 bg-slate-50 px-3 py-3 text-right"
                                >
                                    操作
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {sellers.map(seller => (
                                <tr key={seller.id} className="group h-[52px] hover:bg-slate-50/80">
                                    <td className="sticky left-0 z-10 h-[52px] max-w-52 bg-white px-3 py-0 font-bold text-slate-900 group-hover:bg-slate-50">
                                        <span className="block truncate" title={seller.name}>
                                            {seller.name}
                                        </span>
                                    </td>
                                    <td className="h-[52px] max-w-56 px-3 py-0 font-mono text-[10px] text-slate-400">
                                        <span className="block truncate" title={seller.id}>
                                            {seller.id}
                                        </span>
                                    </td>
                                    <td className="h-[52px] whitespace-nowrap px-3 py-0 font-mono text-[10px] text-slate-500">
                                        {formatDateTime(seller.createdAt)}
                                    </td>
                                    <td className="h-[52px] whitespace-nowrap px-3 py-0 font-mono text-[10px] text-slate-500">
                                        {formatDateTime(seller.updatedAt)}
                                    </td>
                                    <td className="sticky right-0 z-10 h-[52px] whitespace-nowrap border-l border-slate-100 bg-white px-3 py-0 group-hover:bg-slate-50">
                                        <div className="flex justify-end gap-1">
                                            <button
                                                type="button"
                                                onClick={() => setEditing(seller)}
                                                className="rounded-md p-1.5 text-blue-600 hover:bg-blue-50"
                                                aria-label={`编辑${seller.name}`}
                                            >
                                                <Pencil className="h-3.5 w-3.5" />
                                            </button>
                                            <button
                                                type="button"
                                                disabled={state.loading}
                                                onClick={() => void deleteSeller(seller)}
                                                className="rounded-md p-1.5 text-rose-600 hover:bg-rose-50"
                                                aria-label={`删除${seller.name}`}
                                            >
                                                <Trash2 className="h-3.5 w-3.5" />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                            {!sellers.length && (
                                <tr>
                                    <td colSpan={5} className="p-12 text-center text-slate-400">
                                        暂无商家主体
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </section>
            {editing && (
                <SellerDialog
                    existing={editing}
                    customFieldDefinitions={customFieldDefinitions}
                    onClose={() => setEditing(null)}
                    onCompleted={async message => {
                        setEditing(null);
                        await onChanged(message);
                    }}
                    onError={onError}
                />
            )}
        </>
    );
}

function BusinessBasicsPanel({
    onChanged,
    onError,
}: {
    onChanged: (message: string) => Promise<void>;
    onError: (message: string) => void;
}) {
    const loadingAllBusinessSettingsRef = useRef(false);
    const channelCustomFieldDefinitions = useCustomFieldDefinitions('Channel');
    const businessSettingsDocument = useMemo(
        () =>
            addCustomFieldsToDocument(BUSINESS_SETTINGS_QUERY, 'Channel', channelCustomFieldDefinitions, [
                'activeChannel',
            ]),
        [channelCustomFieldDefinitions],
    );
    const query = useQuery<BusinessSettingsResult>(businessSettingsDocument, {
        variables: {
            zoneOptions: { skip: 0, take: 100, sort: { name: 'ASC' } },
            countryOptions: { skip: 0, take: 100, sort: { name: 'ASC' } },
            taxCategoryOptions: { skip: 0, take: 100, sort: { name: 'ASC' } },
            taxRateOptions: { skip: 0, take: 100, sort: { name: 'ASC' } },
        },
        fetchPolicy: 'cache-and-network',
    });
    const {
        data: businessSettingsData,
        error: businessSettingsError,
        fetchMore: fetchMoreBusinessSettings,
        loading: businessSettingsLoading,
    } = query;
    useEffect(() => {
        const data = businessSettingsData;
        if (
            !data ||
            businessSettingsLoading ||
            businessSettingsError ||
            loadingAllBusinessSettingsRef.current
        )
            return;
        const zoneCount = data.zones.items.length;
        const countryCount = data.countries.items.length;
        const categoryCount = data.taxCategories.items.length;
        const rateCount = data.taxRates.items.length;
        if (
            zoneCount >= data.zones.totalItems &&
            countryCount >= data.countries.totalItems &&
            categoryCount >= data.taxCategories.totalItems &&
            rateCount >= data.taxRates.totalItems
        )
            return;
        loadingAllBusinessSettingsRef.current = true;
        void fetchMoreBusinessSettings({
            variables: {
                zoneOptions: { skip: zoneCount, take: 100, sort: { name: 'ASC' } },
                countryOptions: { skip: countryCount, take: 100, sort: { name: 'ASC' } },
                taxCategoryOptions: { skip: categoryCount, take: 100, sort: { name: 'ASC' } },
                taxRateOptions: { skip: rateCount, take: 100, sort: { name: 'ASC' } },
            },
            updateQuery: (previous, { fetchMoreResult }) => ({
                ...previous,
                zones: {
                    ...fetchMoreResult.zones,
                    items: mergeById(previous.zones.items, fetchMoreResult.zones.items),
                },
                countries: {
                    ...fetchMoreResult.countries,
                    items: mergeById(previous.countries.items, fetchMoreResult.countries.items),
                },
                taxCategories: {
                    ...fetchMoreResult.taxCategories,
                    items: mergeById(previous.taxCategories.items, fetchMoreResult.taxCategories.items),
                },
                taxRates: {
                    ...fetchMoreResult.taxRates,
                    items: mergeById(previous.taxRates.items, fetchMoreResult.taxRates.items),
                },
            }),
        })
            .catch(fetchError => {
                onError(toUserFacingError(fetchError, '区域、国家或税率数据未能全部加载'));
            })
            .finally(() => {
                loadingAllBusinessSettingsRef.current = false;
            });
    }, [
        businessSettingsData,
        businessSettingsError,
        businessSettingsLoading,
        fetchMoreBusinessSettings,
        onError,
    ]);
    if (query.loading && !query.data) return <LoadingState />;
    if (query.error || !query.data)
        return (
            <ErrorState
                message={query.error?.message ?? '业务基础配置读取失败'}
                onRetry={() => void query.refetch()}
            />
        );
    const refresh = async (message: string) => {
        await query.refetch();
        await onChanged(message);
    };
    return (
        <div className="space-y-4">
            <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-xs leading-5 text-blue-800">
                这里集中管理平台级语言、币种、计税方式、国家区域和税率。普通店铺管理员只使用平台分配的配置，不能修改。
            </div>
            <GlobalBusinessSettings
                settings={query.data.globalSettings}
                onChanged={refresh}
                onError={onError}
            />
            <ChannelBusinessSettings
                channel={query.data.activeChannel}
                zones={query.data.zones.items}
                customFieldDefinitions={channelCustomFieldDefinitions}
                onChanged={refresh}
                onError={onError}
            />
            <div className="grid gap-4 xl:grid-cols-2">
                <TaxBusinessSettings
                    categories={query.data.taxCategories.items}
                    rates={query.data.taxRates.items}
                    zones={query.data.zones.items}
                    onChanged={refresh}
                    onError={onError}
                />
                <ZoneBusinessSettings
                    zones={query.data.zones.items}
                    countries={query.data.countries.items}
                    languageCode={query.data.activeChannel.defaultLanguageCode}
                    onChanged={refresh}
                    onError={onError}
                />
            </div>
        </div>
    );
}

function GlobalBusinessSettings({
    settings,
    onChanged,
    onError,
}: {
    settings: BusinessSettingsResult['globalSettings'];
    onChanged: (message: string) => Promise<void>;
    onError: (message: string) => void;
}) {
    const [languages, setLanguages] = useState(settings.availableLanguages.join(', '));
    const [trackInventory, setTrackInventory] = useState(settings.trackInventory);
    const [outOfStockThreshold, setOutOfStockThreshold] = useState(String(settings.outOfStockThreshold));
    const [update, state] = useMutation<{
        updateGlobalSettings: {
            __typename: 'GlobalSettings' | 'ChannelDefaultLanguageError';
            message?: string;
        };
    }>(UPDATE_GLOBAL_SETTINGS_MUTATION);
    const submit = async () => {
        const availableLanguages = splitCodes(languages);
        const threshold = Number(outOfStockThreshold);
        if (!availableLanguages.length) return onError('至少保留一种平台可用语言');
        if (!Number.isInteger(threshold) || threshold < 0) return onError('全局缺货阈值必须为非负整数');
        try {
            const response = await update({
                variables: {
                    input: {
                        availableLanguages,
                        trackInventory,
                        outOfStockThreshold: threshold,
                    },
                },
            });
            if (response.data?.updateGlobalSettings.__typename !== 'GlobalSettings')
                throw new Error(response.data?.updateGlobalSettings.message || '全局设置更新被拒绝');
            await onChanged('平台全局语言和库存默认值已更新');
        } catch (error) {
            onError(errorText(error));
        }
    };
    return (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4">
                <div>
                    <h2 className="text-sm font-bold text-slate-900">平台全局设置</h2>
                    <p className="mt-1 text-xs text-slate-400">影响所有 Channel 可选语言和库存默认行为</p>
                </div>
                <button
                    type="button"
                    onClick={() => void submit()}
                    disabled={state.loading}
                    className={primaryButton}
                >
                    {state.loading ? '保存中…' : '保存全局设置'}
                </button>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
                <Field label="平台可用语言代码">
                    <input
                        value={languages}
                        onChange={event => setLanguages(event.target.value)}
                        className={inputClass}
                        placeholder="zh_Hans, en"
                    />
                </Field>
                <Field label="全局缺货阈值">
                    <input
                        type="number"
                        min="0"
                        value={outOfStockThreshold}
                        onChange={event => setOutOfStockThreshold(event.target.value)}
                        className={inputClass}
                    />
                </Field>
                <label className="flex items-center gap-2 pt-7 text-xs text-slate-700">
                    <input
                        type="checkbox"
                        checked={trackInventory}
                        onChange={event => setTrackInventory(event.target.checked)}
                    />
                    默认跟踪库存
                </label>
            </div>
        </section>
    );
}

function ChannelBusinessSettings({
    channel,
    zones,
    customFieldDefinitions,
    onChanged,
    onError,
}: {
    channel: BusinessSettingsResult['activeChannel'];
    zones: BusinessSettingsResult['zones']['items'];
    customFieldDefinitions: ReturnType<typeof useCustomFieldDefinitions>;
    onChanged: (message: string) => Promise<void>;
    onError: (message: string) => void;
}) {
    const [languages, setLanguages] = useState(channel.availableLanguageCodes.join(', '));
    const [currencies, setCurrencies] = useState(channel.availableCurrencyCodes.join(', '));
    const [defaultLanguage, setDefaultLanguage] = useState(channel.defaultLanguageCode);
    const [defaultCurrency, setDefaultCurrency] = useState(channel.defaultCurrencyCode);
    const [taxZoneId, setTaxZoneId] = useState(channel.defaultTaxZone?.id ?? '');
    const [shippingZoneId, setShippingZoneId] = useState(channel.defaultShippingZone?.id ?? '');
    const [pricesIncludeTax, setPricesIncludeTax] = useState(channel.pricesIncludeTax);
    const [trackInventory, setTrackInventory] = useState(channel.trackInventory ?? true);
    const [outOfStockThreshold, setOutOfStockThreshold] = useState(String(channel.outOfStockThreshold ?? 0));
    const [customFieldValues, setCustomFieldValues] = useState<CustomFieldValueMap>(() =>
        customFieldValuesFromEntity(customFieldDefinitions, channel.customFields),
    );
    const [update, state] = useMutation<{
        updateChannel: { __typename: 'Channel' | 'LanguageNotAvailableError'; message?: string };
    }>(UPDATE_BUSINESS_CHANNEL_MUTATION);
    /* oxlint-disable react/set-state-in-effect */
    useEffect(() => {
        setCustomFieldValues(customFieldValuesFromEntity(customFieldDefinitions, channel.customFields));
    }, [channel.customFields, channel.id, customFieldDefinitions]);
    /* oxlint-enable react/set-state-in-effect */
    const submit = async () => {
        const availableLanguageCodes = splitCodes(languages);
        const availableCurrencyCodes = splitCodes(currencies);
        if (!availableLanguageCodes.includes(defaultLanguage)) return onError('默认语言必须包含在可用语言中');
        if (!availableCurrencyCodes.includes(defaultCurrency)) return onError('默认币种必须包含在可用币种中');
        const threshold = Number(outOfStockThreshold);
        if (!Number.isInteger(threshold) || threshold < 0) return onError('缺货阈值必须为非负整数');
        const customFieldErrors = validateCustomFieldValues(customFieldDefinitions, customFieldValues);
        if (Object.keys(customFieldErrors).length > 0) {
            return onError(Object.values(customFieldErrors)[0] ?? '店铺扩展字段校验失败');
        }
        try {
            const response = await update({
                variables: {
                    input: {
                        id: channel.id,
                        availableLanguageCodes,
                        defaultLanguageCode: defaultLanguage,
                        availableCurrencyCodes,
                        defaultCurrencyCode: defaultCurrency,
                        defaultTaxZoneId: taxZoneId || undefined,
                        defaultShippingZoneId: shippingZoneId || undefined,
                        pricesIncludeTax,
                        trackInventory,
                        outOfStockThreshold: threshold,
                        customFields: customFieldInputFromValues(customFieldDefinitions, customFieldValues),
                    },
                },
            });
            if (response.data?.updateChannel.__typename !== 'Channel')
                throw new Error(response.data?.updateChannel.message || '后端拒绝更新渠道配置');
            await onChanged('当前店铺的语言、币种和业务参数已更新');
        } catch (error) {
            onError(errorText(error));
        }
    };
    return (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4">
                <div>
                    <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                        <Languages className="h-4 w-4 text-blue-600" />
                        当前店铺语言与币种
                    </h2>
                    <p className="mt-1 text-xs text-slate-400">{channel.code} · 多个代码用逗号分隔</p>
                </div>
                <button
                    type="button"
                    onClick={() => void submit()}
                    disabled={state.loading}
                    className={primaryButton}
                >
                    {state.loading ? '保存中…' : '保存基础参数'}
                </button>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <Field label="可用语言代码">
                    <input
                        value={languages}
                        onChange={event => setLanguages(event.target.value)}
                        className={inputClass}
                        placeholder="zh_Hans, en"
                    />
                </Field>
                <Field label="默认语言">
                    <input
                        value={defaultLanguage}
                        onChange={event => setDefaultLanguage(event.target.value.trim())}
                        className={inputClass}
                    />
                </Field>
                <Field label="可用币种代码">
                    <input
                        value={currencies}
                        onChange={event => setCurrencies(event.target.value)}
                        className={inputClass}
                        placeholder="CNY, USD"
                    />
                </Field>
                <Field label="默认币种">
                    <input
                        value={defaultCurrency}
                        onChange={event => setDefaultCurrency(event.target.value.trim().toUpperCase())}
                        className={inputClass}
                    />
                </Field>
                <Field label="默认计税区域">
                    <select
                        value={taxZoneId}
                        onChange={event => setTaxZoneId(event.target.value)}
                        className={inputClass}
                    >
                        <option value="">未设置</option>
                        {zones.map(zone => (
                            <option key={zone.id} value={zone.id}>
                                {zone.name}
                            </option>
                        ))}
                    </select>
                </Field>
                <Field label="默认配送区域">
                    <select
                        value={shippingZoneId}
                        onChange={event => setShippingZoneId(event.target.value)}
                        className={inputClass}
                    >
                        <option value="">未设置</option>
                        {zones.map(zone => (
                            <option key={zone.id} value={zone.id}>
                                {zone.name}
                            </option>
                        ))}
                    </select>
                </Field>
                <Field label="缺货阈值">
                    <input
                        type="number"
                        min="0"
                        value={outOfStockThreshold}
                        onChange={event => setOutOfStockThreshold(event.target.value)}
                        className={inputClass}
                    />
                </Field>
                <div className="space-y-2 pt-1">
                    <label className="flex items-center gap-2 text-xs text-slate-700">
                        <input
                            type="checkbox"
                            checked={pricesIncludeTax}
                            onChange={event => setPricesIncludeTax(event.target.checked)}
                        />
                        商品价格已含税
                    </label>
                    <label className="flex items-center gap-2 text-xs text-slate-700">
                        <input
                            type="checkbox"
                            checked={trackInventory}
                            onChange={event => setTrackInventory(event.target.checked)}
                        />
                        默认跟踪库存
                    </label>
                </div>
            </div>
            <div className="mt-4">
                <DynamicCustomFieldsForm
                    fields={customFieldDefinitions}
                    values={customFieldValues}
                    onChange={setCustomFieldValues}
                    disabled={state.loading}
                    title="当前店铺扩展参数"
                />
            </div>
        </section>
    );
}

function TaxBusinessSettings({
    categories,
    rates,
    zones,
    onChanged,
    onError,
}: {
    categories: BusinessSettingsResult['taxCategories']['items'];
    rates: BusinessSettingsResult['taxRates']['items'];
    zones: BusinessSettingsResult['zones']['items'];
    onChanged: (message: string) => Promise<void>;
    onError: (message: string) => void;
}) {
    const requestConfirmation = useConfirmDialog();
    const [editingCategoryId, setEditingCategoryId] = useState('');
    const [categoryName, setCategoryName] = useState('');
    const [categoryDefault, setCategoryDefault] = useState(false);
    const [editingRateId, setEditingRateId] = useState('');
    const [rateName, setRateName] = useState('');
    const [rateValue, setRateValue] = useState('');
    const [categoryId, setCategoryId] = useState(categories[0]?.id ?? '');
    const [zoneId, setZoneId] = useState(zones[0]?.id ?? '');
    const [createCategory, categoryState] = useMutation(CREATE_BUSINESS_TAX_CATEGORY_MUTATION);
    const [updateCategory, updateCategoryState] = useMutation(UPDATE_BUSINESS_TAX_CATEGORY_MUTATION);
    const [deleteCategory, deleteCategoryState] = useMutation<{
        deleteTaxCategory: { result: string; message?: string | null };
    }>(DELETE_BUSINESS_TAX_CATEGORY_MUTATION);
    const [createRate, rateState] = useMutation(CREATE_BUSINESS_TAX_RATE_MUTATION);
    const [updateRate, updateState] = useMutation(UPDATE_BUSINESS_TAX_RATE_MUTATION);
    const [deleteRate, deleteRateState] = useMutation<{
        deleteTaxRate: { result: string; message?: string | null };
    }>(DELETE_BUSINESS_TAX_RATE_MUTATION);
    const addCategory = async () => {
        if (!categoryName.trim()) return;
        try {
            if (editingCategoryId) {
                await updateCategory({
                    variables: {
                        input: {
                            id: editingCategoryId,
                            name: categoryName.trim(),
                            isDefault: categoryDefault,
                        },
                    },
                });
            } else {
                await createCategory({
                    variables: { input: { name: categoryName.trim(), isDefault: categoryDefault } },
                });
            }
            setEditingCategoryId('');
            setCategoryName('');
            setCategoryDefault(false);
            await onChanged(editingCategoryId ? '税类已更新' : '税类已创建');
        } catch (error) {
            onError(errorText(error));
        }
    };
    const addRate = async () => {
        const value = Number(rateValue);
        if (!rateName.trim() || !categoryId || !zoneId || !Number.isFinite(value) || value < 0)
            return onError('请完整填写税率名称、税类、区域和非负税率');
        try {
            const input = { name: rateName.trim(), value, categoryId, zoneId, enabled: true };
            if (editingRateId) await updateRate({ variables: { input: { id: editingRateId, ...input } } });
            else await createRate({ variables: { input } });
            setEditingRateId('');
            setRateName('');
            setRateValue('');
            await onChanged(editingRateId ? '税率已更新' : '税率已创建');
        } catch (error) {
            onError(errorText(error));
        }
    };
    const toggleRate = async (id: string, enabled: boolean) => {
        try {
            await updateRate({ variables: { input: { id, enabled } } });
            await onChanged(`税率已${enabled ? '启用' : '停用'}`);
        } catch (error) {
            onError(errorText(error));
        }
    };
    const removeCategory = async (id: string, name: string) => {
        const confirmed = await requestConfirmation({
            title: `删除税类“${name}”？`,
            description: '有关联税率或商品时，后端会拒绝不安全的删除。',
            confirmLabel: '确认删除',
            tone: 'danger',
        });
        if (!confirmed) return;
        try {
            const response = await deleteCategory({ variables: { id } });
            if (response.data?.deleteTaxCategory.result !== 'DELETED')
                throw new Error(response.data?.deleteTaxCategory.message || '税类未删除');
            await onChanged('税类已删除');
        } catch (error) {
            onError(errorText(error));
        }
    };
    const removeRate = async (id: string, name: string) => {
        const confirmed = await requestConfirmation({
            title: `删除税率“${name}”？`,
            description: '删除后新订单不再使用该税率，历史订单数据不会改写。',
            confirmLabel: '确认删除',
            tone: 'danger',
        });
        if (!confirmed) return;
        try {
            const response = await deleteRate({ variables: { id } });
            if (response.data?.deleteTaxRate.result !== 'DELETED')
                throw new Error(response.data?.deleteTaxRate.message || '税率未删除');
            await onChanged('税率已删除');
        } catch (error) {
            onError(errorText(error));
        }
    };
    const busy =
        categoryState.loading ||
        updateCategoryState.loading ||
        deleteCategoryState.loading ||
        rateState.loading ||
        updateState.loading ||
        deleteRateState.loading;
    return (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 p-5">
                <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                    <ReceiptText className="h-4 w-4 text-blue-600" />
                    税类与税率
                </h2>
                <p className="mt-1 text-xs text-slate-400">税率按“税类 + 区域”匹配订单</p>
            </div>
            <div className="space-y-4 p-5">
                <div className="flex flex-wrap gap-2">
                    <input
                        value={categoryName}
                        onChange={event => setCategoryName(event.target.value)}
                        placeholder={editingCategoryId ? '编辑税类名称' : '新增税类名称'}
                        className={`${inputClass} min-w-56 flex-1`}
                    />
                    <label className="flex items-center gap-2 px-2 text-xs text-slate-600">
                        <input
                            type="checkbox"
                            checked={categoryDefault}
                            onChange={event => setCategoryDefault(event.target.checked)}
                        />
                        默认税类
                    </label>
                    <button
                        type="button"
                        onClick={() => void addCategory()}
                        disabled={busy || !categoryName.trim()}
                        className={secondaryButton}
                    >
                        {editingCategoryId ? '保存税类' : '新增税类'}
                    </button>
                    {editingCategoryId && (
                        <button
                            type="button"
                            onClick={() => {
                                setEditingCategoryId('');
                                setCategoryName('');
                                setCategoryDefault(false);
                            }}
                            className={secondaryButton}
                        >
                            取消
                        </button>
                    )}
                </div>
                <div className="flex flex-wrap gap-2">
                    {categories.map(category => (
                        <span
                            key={category.id}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[10px] text-slate-700"
                        >
                            {category.name}
                            {category.isDefault && <strong className="text-blue-600">默认</strong>}
                            <button
                                type="button"
                                onClick={() => {
                                    setEditingCategoryId(category.id);
                                    setCategoryName(category.name);
                                    setCategoryDefault(category.isDefault);
                                }}
                                className="ml-1 text-blue-600"
                                aria-label={`编辑税类${category.name}`}
                            >
                                <Pencil className="h-3 w-3" />
                            </button>
                            <button
                                type="button"
                                onClick={() => void removeCategory(category.id, category.name)}
                                className="text-rose-600"
                                aria-label={`删除税类${category.name}`}
                            >
                                <Trash2 className="h-3 w-3" />
                            </button>
                        </span>
                    ))}
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                    <input
                        value={rateName}
                        onChange={event => setRateName(event.target.value)}
                        placeholder="税率名称"
                        className={inputClass}
                    />
                    <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={rateValue}
                        onChange={event => setRateValue(event.target.value)}
                        placeholder="税率百分比，如 13"
                        className={inputClass}
                    />
                    <select
                        value={categoryId}
                        onChange={event => setCategoryId(event.target.value)}
                        className={inputClass}
                    >
                        <option value="">选择税类</option>
                        {categories.map(category => (
                            <option key={category.id} value={category.id}>
                                {category.name}
                            </option>
                        ))}
                    </select>
                    <select
                        value={zoneId}
                        onChange={event => setZoneId(event.target.value)}
                        className={inputClass}
                    >
                        <option value="">选择区域</option>
                        {zones.map(zone => (
                            <option key={zone.id} value={zone.id}>
                                {zone.name}
                            </option>
                        ))}
                    </select>
                </div>
                <button
                    type="button"
                    onClick={() => void addRate()}
                    disabled={busy}
                    className={primaryButton}
                >
                    {editingRateId ? '保存税率' : '创建税率'}
                </button>
                {editingRateId && (
                    <button
                        type="button"
                        onClick={() => {
                            setEditingRateId('');
                            setRateName('');
                            setRateValue('');
                        }}
                        className={secondaryButton}
                    >
                        取消编辑
                    </button>
                )}
            </div>
            <div className="divide-y divide-slate-100 border-t border-slate-100">
                {rates.map(rate => (
                    <div key={rate.id} className="flex items-center justify-between gap-3 p-4">
                        <div>
                            <strong className="text-xs text-slate-900">
                                {rate.name} · {rate.value}%
                            </strong>
                            <p className="mt-1 text-[10px] text-slate-400">
                                {rate.category.name} / {rate.zone.name}
                            </p>
                        </div>
                        <div className="flex items-center gap-2">
                            <label className="flex items-center gap-2 text-[10px] font-bold text-slate-500">
                                <input
                                    type="checkbox"
                                    checked={rate.enabled}
                                    onChange={event => void toggleRate(rate.id, event.target.checked)}
                                    disabled={busy}
                                />
                                {rate.enabled ? '已启用' : '已停用'}
                            </label>
                            <button
                                type="button"
                                onClick={() => {
                                    setEditingRateId(rate.id);
                                    setRateName(rate.name);
                                    setRateValue(String(rate.value));
                                    setCategoryId(rate.category.id);
                                    setZoneId(rate.zone.id);
                                }}
                                className="rounded p-1 text-blue-600"
                                aria-label={`编辑税率${rate.name}`}
                            >
                                <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                                type="button"
                                onClick={() => void removeRate(rate.id, rate.name)}
                                className="rounded p-1 text-rose-600"
                                aria-label={`删除税率${rate.name}`}
                            >
                                <Trash2 className="h-3.5 w-3.5" />
                            </button>
                        </div>
                    </div>
                ))}
                {!rates.length && <div className="p-8 text-center text-xs text-slate-400">尚未配置税率</div>}
            </div>
        </section>
    );
}

function ZoneBusinessSettings({
    zones,
    countries,
    languageCode,
    onChanged,
    onError,
}: {
    zones: BusinessSettingsResult['zones']['items'];
    countries: BusinessSettingsResult['countries']['items'];
    languageCode: string;
    onChanged: (message: string) => Promise<void>;
    onError: (message: string) => void;
}) {
    const requestConfirmation = useConfirmDialog();
    const [editingZoneId, setEditingZoneId] = useState('');
    const [name, setName] = useState('');
    const [memberIds, setMemberIds] = useState<string[]>([]);
    const [create, state] = useMutation(CREATE_BUSINESS_ZONE_MUTATION);
    const [updateZone, updateZoneState] = useMutation(UPDATE_BUSINESS_ZONE_MUTATION);
    const [addMembers, addMembersState] = useMutation(ADD_BUSINESS_ZONE_MEMBERS_MUTATION);
    const [removeMembers, removeMembersState] = useMutation(REMOVE_BUSINESS_ZONE_MEMBERS_MUTATION);
    const [deleteZone, deleteZoneState] = useMutation<{
        deleteZone: { result: string; message?: string | null };
    }>(DELETE_BUSINESS_ZONE_MUTATION);
    const [editingCountryId, setEditingCountryId] = useState('');
    const [countryCode, setCountryCode] = useState('');
    const [countryName, setCountryName] = useState('');
    const [countryEnabled, setCountryEnabled] = useState(true);
    const [createCountry, createCountryState] = useMutation(CREATE_BUSINESS_COUNTRY_MUTATION);
    const [updateCountry, updateCountryState] = useMutation(UPDATE_BUSINESS_COUNTRY_MUTATION);
    const [deleteCountry, deleteCountryState] = useMutation<{
        deleteCountry: { result: string; message?: string | null };
    }>(DELETE_BUSINESS_COUNTRY_MUTATION);
    const submit = async () => {
        if (!name.trim() || memberIds.length === 0) return onError('请填写区域名称并选择至少一个国家/地区');
        try {
            if (editingZoneId) {
                const existing = zones.find(zone => zone.id === editingZoneId);
                await updateZone({ variables: { input: { id: editingZoneId, name: name.trim() } } });
                const existingIds = existing?.members.map(member => member.id) ?? [];
                const toAdd = memberIds.filter(id => !existingIds.includes(id));
                const toRemove = existingIds.filter(id => !memberIds.includes(id));
                if (toAdd.length)
                    await addMembers({ variables: { zoneId: editingZoneId, memberIds: toAdd } });
                if (toRemove.length)
                    await removeMembers({ variables: { zoneId: editingZoneId, memberIds: toRemove } });
            } else {
                await create({ variables: { input: { name: name.trim(), memberIds } } });
            }
            const wasEditing = Boolean(editingZoneId);
            setEditingZoneId('');
            setName('');
            setMemberIds([]);
            await onChanged(wasEditing ? '国家/地区区域已更新' : '国家/地区区域已创建');
        } catch (error) {
            onError(errorText(error));
        }
    };
    const removeZone = async (id: string, zoneName: string) => {
        const confirmed = await requestConfirmation({
            title: `删除区域“${zoneName}”？`,
            description: '被 Channel、配送方式或税率引用时，后端会拒绝删除。',
            confirmLabel: '确认删除',
            tone: 'danger',
        });
        if (!confirmed) return;
        try {
            const response = await deleteZone({ variables: { id } });
            if (response.data?.deleteZone.result !== 'DELETED')
                throw new Error(response.data?.deleteZone.message || '区域未删除');
            await onChanged('区域已删除');
        } catch (error) {
            onError(errorText(error));
        }
    };
    const submitCountry = async () => {
        if (!countryCode.trim() || !countryName.trim()) return onError('请填写国家代码和名称');
        try {
            const input = {
                code: countryCode.trim().toUpperCase(),
                enabled: countryEnabled,
                translations: [{ languageCode, name: countryName.trim() }],
            };
            if (editingCountryId)
                await updateCountry({ variables: { input: { id: editingCountryId, ...input } } });
            else await createCountry({ variables: { input } });
            const wasEditing = Boolean(editingCountryId);
            setEditingCountryId('');
            setCountryCode('');
            setCountryName('');
            setCountryEnabled(true);
            await onChanged(wasEditing ? '国家/地区已更新' : '国家/地区已创建');
        } catch (error) {
            onError(errorText(error));
        }
    };
    const toggleCountry = async (id: string, enabled: boolean) => {
        try {
            await updateCountry({ variables: { input: { id, enabled } } });
            await onChanged(`国家/地区已${enabled ? '启用' : '停用'}`);
        } catch (error) {
            onError(errorText(error));
        }
    };
    const removeCountry = async (id: string, displayName: string) => {
        const confirmed = await requestConfirmation({
            title: `删除国家/地区“${displayName}”？`,
            description: '被业务区域或历史地址引用时，后端会拒绝不安全的删除。',
            confirmLabel: '确认删除',
            tone: 'danger',
        });
        if (!confirmed) return;
        try {
            const response = await deleteCountry({ variables: { id } });
            if (response.data?.deleteCountry.result !== 'DELETED')
                throw new Error(response.data?.deleteCountry.message || '国家/地区未删除');
            await onChanged('国家/地区已删除');
        } catch (error) {
            onError(errorText(error));
        }
    };
    const busy =
        state.loading ||
        updateZoneState.loading ||
        addMembersState.loading ||
        removeMembersState.loading ||
        deleteZoneState.loading ||
        createCountryState.loading ||
        updateCountryState.loading ||
        deleteCountryState.loading;
    return (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 p-5">
                <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                    <MapPin className="h-4 w-4 text-blue-600" />
                    国家与业务区域
                </h2>
                <p className="mt-1 text-xs text-slate-400">将国家组合成计税或配送区域</p>
            </div>
            <div className="space-y-3 p-5">
                <input
                    value={name}
                    onChange={event => setName(event.target.value)}
                    placeholder={editingZoneId ? '编辑区域名称' : '区域名称，如：中国大陆'}
                    className={inputClass}
                />
                <div className="max-h-48 overflow-y-auto rounded-lg border border-slate-200 p-2">
                    <div className="grid gap-1 sm:grid-cols-2">
                        {countries.map(country => (
                            <label
                                key={country.id}
                                className="flex items-center gap-2 rounded px-2 py-1.5 text-[11px] hover:bg-slate-50"
                            >
                                <input
                                    type="checkbox"
                                    checked={memberIds.includes(country.id)}
                                    onChange={event =>
                                        setMemberIds(previous =>
                                            event.target.checked
                                                ? [...previous, country.id]
                                                : previous.filter(id => id !== country.id),
                                        )
                                    }
                                />
                                <span className="truncate">
                                    {country.name} ({country.code})
                                </span>
                            </label>
                        ))}
                    </div>
                    {!countries.length && (
                        <p className="py-6 text-center text-xs text-slate-400">后端尚未初始化国家数据</p>
                    )}
                </div>
                <button
                    type="button"
                    onClick={() => void submit()}
                    disabled={busy || !name.trim() || memberIds.length === 0}
                    className={primaryButton}
                >
                    {editingZoneId ? '保存区域' : '创建区域'}
                </button>
                {editingZoneId && (
                    <button
                        type="button"
                        onClick={() => {
                            setEditingZoneId('');
                            setName('');
                            setMemberIds([]);
                        }}
                        className={secondaryButton}
                    >
                        取消编辑
                    </button>
                )}
            </div>
            <div className="divide-y divide-slate-100 border-t border-slate-100">
                {zones.map(zone => (
                    <div key={zone.id} className="flex items-start justify-between gap-3 p-4">
                        <div>
                            <strong className="text-xs text-slate-900">{zone.name}</strong>
                            <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-slate-400">
                                {zone.members.map(member => member.name).join('、') || '尚无成员'}
                            </p>
                        </div>
                        <div className="flex gap-1">
                            <button
                                type="button"
                                onClick={() => {
                                    setEditingZoneId(zone.id);
                                    setName(zone.name);
                                    setMemberIds(zone.members.map(member => member.id));
                                }}
                                className="rounded p-1 text-blue-600"
                                aria-label={`编辑区域${zone.name}`}
                            >
                                <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                                type="button"
                                onClick={() => void removeZone(zone.id, zone.name)}
                                className="rounded p-1 text-rose-600"
                                aria-label={`删除区域${zone.name}`}
                            >
                                <Trash2 className="h-3.5 w-3.5" />
                            </button>
                        </div>
                    </div>
                ))}
                {!zones.length && (
                    <div className="p-8 text-center text-xs text-slate-400">尚未创建业务区域</div>
                )}
            </div>
            <div className="space-y-3 border-t border-slate-100 p-5">
                <h3 className="text-xs font-bold text-slate-800">国家/地区字典</h3>
                <div className="grid gap-2 sm:grid-cols-2">
                    <input
                        value={countryCode}
                        onChange={event => setCountryCode(event.target.value)}
                        placeholder="国家代码，如 CN"
                        className={inputClass}
                    />
                    <input
                        value={countryName}
                        onChange={event => setCountryName(event.target.value)}
                        placeholder="显示名称"
                        className={inputClass}
                    />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <label className="flex items-center gap-2 text-xs text-slate-600">
                        <input
                            type="checkbox"
                            checked={countryEnabled}
                            onChange={event => setCountryEnabled(event.target.checked)}
                        />
                        启用
                    </label>
                    <button
                        type="button"
                        disabled={busy}
                        onClick={() => void submitCountry()}
                        className={secondaryButton}
                    >
                        {editingCountryId ? '保存国家/地区' : '新增国家/地区'}
                    </button>
                    {editingCountryId && (
                        <button
                            type="button"
                            onClick={() => {
                                setEditingCountryId('');
                                setCountryCode('');
                                setCountryName('');
                                setCountryEnabled(true);
                            }}
                            className={secondaryButton}
                        >
                            取消
                        </button>
                    )}
                </div>
                <div className="max-h-52 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
                    {countries.map(country => (
                        <div
                            key={country.id}
                            className="flex items-center justify-between gap-2 p-2.5 text-[10px]"
                        >
                            <span className="truncate">
                                {country.name} ({country.code})
                            </span>
                            <div className="flex items-center gap-1">
                                <input
                                    type="checkbox"
                                    checked={country.enabled}
                                    onChange={event => void toggleCountry(country.id, event.target.checked)}
                                    aria-label={`${country.name}启用状态`}
                                />
                                <button
                                    type="button"
                                    onClick={() => {
                                        setEditingCountryId(country.id);
                                        setCountryCode(country.code);
                                        setCountryName(country.name);
                                        setCountryEnabled(country.enabled);
                                    }}
                                    className="rounded p-1 text-blue-600"
                                    aria-label={`编辑${country.name}`}
                                >
                                    <Pencil className="h-3 w-3" />
                                </button>
                                <button
                                    type="button"
                                    onClick={() => void removeCountry(country.id, country.name)}
                                    className="rounded p-1 text-rose-600"
                                    aria-label={`删除${country.name}`}
                                >
                                    <Trash2 className="h-3 w-3" />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
}

function StoreEditor({
    profile,
    onClose,
    onCompleted,
    onError,
}: {
    profile: StoreProfileRecord;
    onClose: () => void;
    onCompleted: (message: string) => Promise<void>;
    onError: (message: string) => void;
}) {
    const requestConfirmation = useConfirmDialog();
    const [nameZh, setNameZh] = useState(profile.channel.customFields.storefrontNameZh);
    const [nameEn, setNameEn] = useState(profile.channel.customFields.storefrontNameEn);
    const [descriptionZh, setDescriptionZh] = useState(profile.descriptionZh);
    const [descriptionEn, setDescriptionEn] = useState(profile.descriptionEn);
    const [reviewEnglish, setReviewEnglish] = useState(false);
    const [internalNote, setInternalNote] = useState(profile.internalNote ?? '');
    const [status, setStatus] = useState(profile.status);
    const [sortOrder, setSortOrder] = useState(profile.sortOrder);
    const [save, state] = useMutation(UPDATE_STORE_PROFILE_MUTATION);
    const submit = async () => {
        if (!nameZh.trim()) return onError('请填写中文店铺名称');
        if (status === 'ACTIVE' && !profile.activationReadiness.ready)
            return onError('上线检查未通过，暂时不能启用店铺');
        const statusChanged = status !== profile.status;
        let currentPassword: string | undefined;
        if (statusChanged) {
            const confirmation = await requestConfirmation({
                title: '确认变更店铺运行状态？',
                description: `将“${storeName(profile)}”从${storeStatusLabel(profile.status)}改为${storeStatusLabel(status)}。此操作需要验证当前管理员密码。`,
                confirmLabel: '验证并变更',
                tone: 'warning',
                requireCurrentPassword: true,
            });
            if (!confirmation) return;
            currentPassword = confirmation.currentPassword;
        }
        try {
            const input = {
                id: profile.id,
                expectedUpdatedAt: profile.updatedAt,
                storefrontNameZh: nameZh.trim(),
                storefrontNameEn: nameEn.trim(),
                descriptionZh: descriptionZh.trim(),
                descriptionEn: descriptionEn.trim(),
                internalNote: internalNote.trim() || null,
                sortOrder,
                ...(statusChanged ? { status, currentPassword } : {}),
            };
            await save({
                variables: {
                    input,
                },
            });
            await onCompleted('店铺档案已保存');
        } catch (error) {
            onError(errorText(error));
        }
    };
    return (
        <Modal
            title="编辑店铺档案"
            description={`${profile.channel.code} · 使用乐观锁避免覆盖他人修改`}
            onClose={onClose}
        >
            <div className="grid gap-4 sm:grid-cols-2">
                <Field label="中文店铺名称 *">
                    <input
                        value={nameZh}
                        onChange={event => setNameZh(event.target.value)}
                        className={inputClass}
                    />
                </Field>
                <Field label="中文简介">
                    <textarea
                        rows={4}
                        value={descriptionZh}
                        onChange={event => setDescriptionZh(event.target.value)}
                        className={inputClass}
                    />
                </Field>
            </div>
            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <button
                    type="button"
                    onClick={() => setReviewEnglish(current => !current)}
                    aria-expanded={reviewEnglish}
                    className="flex items-center gap-1.5 text-xs font-bold text-blue-700"
                >
                    <Languages className="h-3.5 w-3.5" />
                    {reviewEnglish ? '收起英文校对' : '展开英文校对（可选）'}
                </button>
                <p className="mt-1 text-[10px] leading-4 text-slate-500">
                    中文是源内容；不填写英文时保存会自动生成。手工英文仅作当前覆盖，中文改动后请重新校对。
                </p>
                {reviewEnglish && (
                    <div className="mt-3 grid gap-4 sm:grid-cols-2">
                        <Field label="英文店铺名称（人工覆盖）">
                            <input
                                value={nameEn}
                                onChange={event => setNameEn(event.target.value)}
                                className={inputClass}
                            />
                        </Field>
                        <Field label="英文简介（人工覆盖）">
                            <textarea
                                rows={4}
                                value={descriptionEn}
                                onChange={event => setDescriptionEn(event.target.value)}
                                className={inputClass}
                            />
                        </Field>
                    </div>
                )}
            </div>
            <div className="mt-4">
                <Field label="内部备注（客户不可见）">
                    <textarea
                        rows={3}
                        value={internalNote}
                        onChange={event => setInternalNote(event.target.value)}
                        className={inputClass}
                    />
                </Field>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <Field label="运行状态">
                    <select
                        value={status}
                        onChange={event => setStatus(event.target.value as StoreProfileRecord['status'])}
                        className={inputClass}
                    >
                        <option value="DRAFT">草稿</option>
                        <option value="ACTIVE" disabled={!profile.activationReadiness.ready}>
                            正常营业
                        </option>
                        <option value="SUSPENDED" disabled={profile.status !== 'SUSPENDED'}>
                            暂停营业（请使用安全清退）
                        </option>
                    </select>
                </Field>
                <Field label="显示顺序">
                    <input
                        type="number"
                        value={sortOrder}
                        onChange={event => setSortOrder(Number(event.target.value) || 0)}
                        className={inputClass}
                    />
                </Field>
            </div>
            <ModalActions
                onClose={onClose}
                onSave={() => void submit()}
                saving={state.loading}
                saveLabel="保存店铺档案"
            />
        </Modal>
    );
}

function StoreDeprovisionDialog({
    profile,
    onClose,
    onCompleted,
    onError,
}: {
    profile: StoreProfileRecord;
    onClose: () => void;
    onCompleted: (message: string) => Promise<void>;
    onError: (message: string) => void;
}) {
    const requestConfirmation = useConfirmDialog();
    const [currentPassword, setCurrentPassword] = useState('');
    const [confirmCode, setConfirmCode] = useState('');
    const [expectedUpdatedAt, setExpectedUpdatedAt] = useState(profile.updatedAt);
    const [localNotice, setLocalNotice] = useState('');
    const [localError, setLocalError] = useState('');
    const impactQuery = useQuery<{ storeDeprovisionImpact: StoreDeprovisionImpactRecord }>(
        STORE_DEPROVISION_IMPACT_QUERY,
        {
            variables: { profileId: profile.id },
            fetchPolicy: 'network-only',
        },
    );
    const [suspendStore, suspendState] = useMutation<{
        suspendStore: { id: string; updatedAt: string; status: StoreProfileRecord['status'] };
    }>(SUSPEND_STORE_MUTATION);
    const [deprovisionStore, deprovisionState] = useMutation<{
        deprovisionStore: {
            channelId: string;
            channelCode: string;
            deletedAdministratorCount: number;
            deletedRole: boolean;
            deletedSeller: boolean;
        };
    }>(DEPROVISION_STORE_MUTATION);
    const impact = impactQuery.data?.storeDeprovisionImpact;
    const busy = suspendState.loading || deprovisionState.loading;

    const suspend = async () => {
        if (!currentPassword) {
            setLocalError('请输入当前管理员密码');
            return;
        }
        setLocalError('');
        setLocalNotice('');
        try {
            const response = await suspendStore({
                variables: {
                    profileId: profile.id,
                    expectedUpdatedAt,
                    currentPassword,
                },
            });
            const updatedAt = response.data?.suspendStore.updatedAt;
            if (!updatedAt) throw new Error('暂停营业后未返回最新店铺版本');
            setExpectedUpdatedAt(updatedAt);
            setCurrentPassword('');
            setLocalNotice('店铺已暂停营业。若该店铺没有业务数据，可继续输入店铺编码执行彻底清退。');
            await impactQuery.refetch();
        } catch (error) {
            setLocalError(errorText(error));
        }
    };

    const deprovision = async () => {
        if (!impact?.canDeprovision) {
            setLocalError('当前店铺仍有阻止清退的条件，请先按列表处理');
            return;
        }
        if (!currentPassword) {
            setLocalError('请输入当前管理员密码');
            return;
        }
        if (confirmCode.trim() !== impact.channelCode) {
            setLocalError(`请输入完整店铺编码“${impact.channelCode}”`);
            return;
        }
        const confirmation = await requestConfirmation({
            title: '最后确认：彻底清退空店铺？',
            description:
                '系统将删除该空店铺的 Channel、店铺档案、专属管理员与专属角色。该操作不可撤销，但后端仍会再次检查订单、商品、客户及扩展数据。',
            confirmLabel: '确认彻底清退',
            tone: 'danger',
        });
        if (!confirmation) return;
        setLocalError('');
        try {
            const response = await deprovisionStore({
                variables: {
                    input: {
                        profileId: profile.id,
                        expectedUpdatedAt,
                        currentPassword,
                        confirmCode: confirmCode.trim(),
                    },
                },
            });
            const result = response.data?.deprovisionStore;
            if (!result) throw new Error('清退操作未返回结果');
            await onCompleted(
                `空店铺 ${result.channelCode} 已清退；移除 ${result.deletedAdministratorCount} 个专属管理员${result.deletedRole ? '、专属角色' : ''}${result.deletedSeller ? '和独占商家主体' : ''}`,
            );
        } catch (error) {
            const message = errorText(error);
            setLocalError(message);
            onError(message);
            await impactQuery.refetch().catch(() => undefined);
        }
    };

    return (
        <Modal
            title="店铺安全清退"
            description={`${storeName(profile)} · ${profile.channel.code} · 先看影响、再暂停，只有没有业务数据的店铺才允许彻底删除`}
            onClose={onClose}
        >
            {impactQuery.loading && !impact ? (
                <div className="flex min-h-48 items-center justify-center gap-2 text-xs text-slate-500">
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                    正在检查订单、商品、客户及扩展数据…
                </div>
            ) : impactQuery.error || !impact ? (
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-700">
                    <p>{impactQuery.error?.message ?? '清退影响读取失败'}</p>
                    <button
                        type="button"
                        onClick={() => void impactQuery.refetch()}
                        className="mt-3 font-bold underline"
                    >
                        重新检查
                    </button>
                </div>
            ) : (
                <>
                    {localNotice && (
                        <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-xs leading-5 text-emerald-800">
                            {localNotice}
                        </div>
                    )}
                    {localError && (
                        <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs leading-5 text-rose-700">
                            {localError}
                        </div>
                    )}
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        <ImpactStat label="订单" value={impact.orderCount} />
                        <ImpactStat label="商品" value={impact.productCount} />
                        <ImpactStat label="客户" value={impact.customerCount} />
                        <ImpactStat label="扩展记录" value={impact.extensionRecordCount} />
                        <ImpactStat label="管理员" value={impact.administratorCount} />
                        <ImpactStat label="独立域名" value={impact.domainCount} />
                        <ImpactStat label="专属角色" value={impact.roleWillBeDeleted ? '会移除' : '不移除'} />
                        <ImpactStat label="商家主体" value={impact.sellerWillBeDeleted ? '会移除' : '保留'} />
                    </div>
                    <div
                        className={`mt-4 rounded-xl border p-4 ${impact.canDeprovision ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}
                    >
                        <div className="flex items-center gap-2 text-xs font-bold text-slate-900">
                            {impact.canDeprovision ? (
                                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                            ) : (
                                <AlertCircle className="h-4 w-4 text-amber-600" />
                            )}
                            {impact.canDeprovision
                                ? '该店铺满足彻底清退条件'
                                : '当前只能查看或暂停，不能彻底删除'}
                        </div>
                        {impact.blockers.length > 0 && (
                            <ul className="mt-3 space-y-1 text-[11px] leading-5 text-amber-900">
                                {impact.blockers.map(blocker => (
                                    <li key={blocker}>• {blocker}</li>
                                ))}
                            </ul>
                        )}
                    </div>
                    <div className="mt-4 grid gap-4 sm:grid-cols-2">
                        <Field label="当前管理员密码 *">
                            <input
                                type="password"
                                autoComplete="current-password"
                                value={currentPassword}
                                onChange={event => setCurrentPassword(event.target.value)}
                                className={inputClass}
                            />
                        </Field>
                        <Field label={`彻底清退时输入店铺编码：${impact.channelCode}`}>
                            <input
                                value={confirmCode}
                                onChange={event => setConfirmCode(event.target.value)}
                                placeholder={impact.channelCode}
                                disabled={!impact.canDeprovision}
                                className={inputClass}
                            />
                        </Field>
                    </div>
                    <div className="mt-6 flex flex-col-reverse gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:justify-end">
                        <button type="button" onClick={onClose} disabled={busy} className={secondaryButton}>
                            关闭
                        </button>
                        {impact.status !== 'SUSPENDED' && (
                            <button
                                type="button"
                                onClick={() => void suspend()}
                                disabled={
                                    busy ||
                                    impact.isDefaultChannel ||
                                    impact.isProvisioningTemplate ||
                                    impact.isActiveChannel
                                }
                                className="flex items-center justify-center gap-1.5 rounded-lg bg-amber-500 px-4 py-2 text-xs font-bold text-white hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {suspendState.loading && (
                                    <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                                )}
                                先暂停营业
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={() => void deprovision()}
                            disabled={
                                !impact.canDeprovision || busy || confirmCode.trim() !== impact.channelCode
                            }
                            className="flex items-center justify-center gap-1.5 rounded-lg bg-rose-600 px-4 py-2 text-xs font-bold text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {deprovisionState.loading ? (
                                <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                                <Trash2 className="h-3.5 w-3.5" />
                            )}
                            彻底清退空店铺
                        </button>
                    </div>
                </>
            )}
        </Modal>
    );
}

function ProvisionStoreDialog({
    templates,
    onClose,
    onCompleted,
    onError,
}: {
    templates: StoreManagementResult['storeProvisioningTemplates'];
    onClose: () => void;
    onCompleted: (message: string) => Promise<void>;
    onError: (message: string) => void;
}) {
    const [draft, setDraft] = useState({
        code: '',
        name: '',
        storefrontNameZh: '',
        storefrontNameEn: '',
        templateChannelId: templates[0]?.id ?? '',
        firstName: '',
        lastName: '',
        emailAddress: '',
    });
    const [result, setResult] = useState<{ channelCode: string; temporaryPassword: string } | null>(null);
    const [copied, setCopied] = useState(false);
    const [reviewEnglish, setReviewEnglish] = useState(false);
    const [provision, state] = useMutation<{
        provisionStore: { channelCode: string; temporaryPassword: string };
    }>(PROVISION_STORE_MUTATION);
    const set = (key: keyof typeof draft, value: string) =>
        setDraft(current => ({ ...current, [key]: value }));
    const submit = async () => {
        if (
            Object.entries(draft)
                .filter(([key]) => key !== 'storefrontNameEn')
                .some(([, value]) => !value.trim())
        )
            return onError('请完整填写所有必填项');
        try {
            const response = await provision({
                variables: {
                    input: {
                        code: draft.code.trim(),
                        name: draft.name.trim(),
                        storefrontNameZh: draft.storefrontNameZh.trim(),
                        storefrontNameEn: draft.storefrontNameEn.trim() || null,
                        templateChannelId: draft.templateChannelId,
                        administrator: {
                            firstName: draft.firstName.trim(),
                            lastName: draft.lastName.trim(),
                            emailAddress: draft.emailAddress.trim(),
                        },
                    },
                },
            });
            const next = response.data?.provisionStore;
            if (!next) throw new Error('后端未返回开店结果');
            setResult(next);
            await onCompleted('网店已创建，请立即保存一次性临时密码');
        } catch (error) {
            onError(errorText(error));
        }
    };
    if (result)
        return (
            <Modal
                title="网店已创建"
                description="临时密码只显示这一次，请通过安全渠道交给店铺管理员"
                onClose={onClose}
            >
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                    <div className="text-xs text-emerald-700">Channel</div>
                    <div className="mt-1 font-mono font-bold text-emerald-900">{result.channelCode}</div>
                </div>
                <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
                    <div className="text-xs text-amber-700">一次性临时密码</div>
                    <div className="mt-2 flex items-center justify-between gap-3">
                        <code className="select-all break-all text-sm font-bold text-amber-950">
                            {result.temporaryPassword}
                        </code>
                        <button
                            type="button"
                            onClick={async () => {
                                await navigator.clipboard.writeText(result.temporaryPassword);
                                setCopied(true);
                            }}
                            className={secondaryButton}
                        >
                            <Copy className="h-3.5 w-3.5" />
                            {copied ? '已复制' : '复制'}
                        </button>
                    </div>
                </div>
                <div className="mt-5 flex justify-end">
                    <button type="button" onClick={onClose} className={primaryButton}>
                        我已安全保存
                    </button>
                </div>
            </Modal>
        );
    return (
        <Modal
            title="开通独立网店"
            description="一次创建商家主体、Channel、库存点、权限角色和管理员账号"
            onClose={onClose}
        >
            <div className="grid gap-4 sm:grid-cols-2">
                <Field label="商家名称 *">
                    <input
                        value={draft.name}
                        onChange={event => set('name', event.target.value)}
                        className={inputClass}
                        placeholder="例如：云桥贸易有限公司"
                    />
                </Field>
                <Field label="网店编码 *">
                    <input
                        value={draft.code}
                        onChange={event => set('code', event.target.value)}
                        className={`${inputClass} font-mono`}
                        placeholder="yunqiao-store"
                    />
                </Field>
                <Field label="中文网站名称 *">
                    <input
                        value={draft.storefrontNameZh}
                        onChange={event => set('storefrontNameZh', event.target.value)}
                        className={inputClass}
                    />
                </Field>
            </div>
            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <button
                    type="button"
                    onClick={() => setReviewEnglish(current => !current)}
                    aria-expanded={reviewEnglish}
                    className="flex items-center gap-1.5 text-xs font-bold text-blue-700"
                >
                    <Languages className="h-3.5 w-3.5" />
                    {reviewEnglish ? '收起英文校对' : '展开英文校对（可选）'}
                </button>
                <p className="mt-1 text-[10px] leading-4 text-slate-500">
                    默认根据中文网站名称自动生成英文；品牌名称需要固定写法时再手工覆盖。
                </p>
                {reviewEnglish && (
                    <div className="mt-3">
                        <Field label="英文网站名称（人工覆盖）">
                            <input
                                value={draft.storefrontNameEn}
                                onChange={event => set('storefrontNameEn', event.target.value)}
                                className={inputClass}
                            />
                        </Field>
                    </div>
                )}
            </div>
            <div className="mt-4">
                <Field label="开店配置模板 *">
                    <select
                        value={draft.templateChannelId}
                        onChange={event => set('templateChannelId', event.target.value)}
                        className={inputClass}
                    >
                        <option value="">请选择模板</option>
                        {templates.map(template => (
                            <option key={template.id} value={template.id}>
                                {template.code} · {template.defaultLanguageCode} /{' '}
                                {template.defaultCurrencyCode}
                            </option>
                        ))}
                    </select>
                </Field>
                {!templates.length && (
                    <p className="mt-2 text-[10px] text-amber-700">
                        当前没有可用模板，需要先在后端 Channel 配置中启用开店模板。
                    </p>
                )}
            </div>
            <div className="mt-5 border-t border-slate-100 pt-5">
                <h3 className="mb-3 text-xs font-bold text-slate-800">店铺管理员</h3>
                <div className="grid gap-4 sm:grid-cols-3">
                    <Field label="名 *">
                        <input
                            value={draft.firstName}
                            onChange={event => set('firstName', event.target.value)}
                            className={inputClass}
                        />
                    </Field>
                    <Field label="姓 *">
                        <input
                            value={draft.lastName}
                            onChange={event => set('lastName', event.target.value)}
                            className={inputClass}
                        />
                    </Field>
                    <Field label="登录邮箱 *">
                        <input
                            type="email"
                            value={draft.emailAddress}
                            onChange={event => set('emailAddress', event.target.value)}
                            className={inputClass}
                        />
                    </Field>
                </div>
            </div>
            <ModalActions
                onClose={onClose}
                onSave={() => void submit()}
                saving={state.loading}
                saveLabel="创建网店"
            />
        </Modal>
    );
}

function SellerDialog({
    existing,
    customFieldDefinitions,
    onClose,
    onCompleted,
    onError,
}: {
    existing?: StoreManagementResult['sellers']['items'][number];
    customFieldDefinitions: ReturnType<typeof useCustomFieldDefinitions>;
    onClose: () => void;
    onCompleted: (message: string) => Promise<void>;
    onError: (message: string) => void;
}) {
    const [name, setName] = useState(existing?.name ?? '');
    const [customFieldValues, setCustomFieldValues] = useState<CustomFieldValueMap>(() =>
        customFieldValuesFromEntity(customFieldDefinitions, existing?.customFields),
    );
    const [create, state] = useMutation(CREATE_SELLER_MUTATION);
    const [update, updateState] = useMutation(UPDATE_SELLER_MUTATION);
    const submit = async () => {
        if (!name.trim()) return onError('请填写商家主体名称');
        const customFieldErrors = validateCustomFieldValues(customFieldDefinitions, customFieldValues);
        if (Object.keys(customFieldErrors).length > 0) {
            return onError(Object.values(customFieldErrors)[0] ?? '商家主体扩展字段校验失败');
        }
        try {
            const customFields = customFieldInputFromValues(customFieldDefinitions, customFieldValues);
            if (existing) {
                await update({ variables: { input: { id: existing.id, name: name.trim(), customFields } } });
            } else {
                await create({ variables: { input: { name: name.trim(), customFields } } });
            }
            await onCompleted(existing ? '商家主体已更新' : '商家主体已创建');
        } catch (error) {
            onError(errorText(error));
        }
    };
    return (
        <Modal
            title={existing ? '编辑商家主体' : '新增商家主体'}
            description="商家主体用于隔离商品、订单和店铺 Channel"
            onClose={onClose}
        >
            <Field label="商家主体名称 *">
                <input
                    value={name}
                    onChange={event => setName(event.target.value)}
                    className={inputClass}
                    autoFocus
                />
            </Field>
            <div className="mt-5">
                <DynamicCustomFieldsForm
                    title="商家主体扩展字段"
                    fields={customFieldDefinitions}
                    values={customFieldValues}
                    onChange={setCustomFieldValues}
                    disabled={state.loading || updateState.loading}
                />
            </div>
            <ModalActions
                onClose={onClose}
                onSave={() => void submit()}
                saving={state.loading || updateState.loading}
                saveLabel={existing ? '保存商家主体' : '创建商家主体'}
            />
        </Modal>
    );
}
function storeName(profile: StoreProfileRecord) {
    return (
        profile.channel.customFields.storefrontNameZh ||
        profile.channel.customFields.storefrontNameEn ||
        getChannelDisplayName(profile.channel.code)
    );
}

function storeStatusLabel(status: StoreProfileRecord['status']) {
    if (status === 'ACTIVE') return '正常营业';
    if (status === 'SUSPENDED') return '暂停营业';
    return '草稿';
}
