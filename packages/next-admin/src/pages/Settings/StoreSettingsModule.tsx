import { useMutation, useQuery } from '@apollo/client/react';
import {
    AlertCircle,
    Building2,
    CheckCircle2,
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
    Truck,
    X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useConfirmDialog } from '../../components/confirm-dialog-context';
import {
    BUSINESS_SETTINGS_QUERY,
    CREATE_BUSINESS_TAX_CATEGORY_MUTATION,
    CREATE_BUSINESS_TAX_RATE_MUTATION,
    CREATE_BUSINESS_ZONE_MUTATION,
    CREATE_SELLER_MUTATION,
    CREATE_STORE_DOMAIN_MUTATION,
    DELETE_STORE_DOMAIN_MUTATION,
    PROVISION_STORE_MUTATION,
    SET_PRIMARY_STORE_DOMAIN_MUTATION,
    STORE_DOMAINS_QUERY,
    STORE_MANAGEMENT_QUERY,
    UPDATE_BUSINESS_CHANNEL_MUTATION,
    UPDATE_BUSINESS_TAX_RATE_MUTATION,
    UPDATE_PAYMENT_METHOD_MUTATION,
    UPDATE_STORE_PROFILE_MUTATION,
    VERIFY_STORE_DOMAIN_MUTATION,
    type BusinessSettingsResult,
    type StoreDomainRecord,
    type StoreDomainsResult,
    type StoreManagementResult,
    type StoreProfileRecord,
} from '../../graphql/management.graphql';
import { useAccessibleDialog } from '../../hooks/use-accessible-dialog';
import { useUrlTab } from '../../hooks/use-url-tab';
import { toUserFacingError } from '../../utils/user-facing-error';
import { formatDateTime } from '../Sales/sales-utils';

type Tab = 'STORES' | 'DOMAINS' | 'SELLERS' | 'PAYMENT_SHIPPING' | 'BUSINESS';
const STORE_SETTINGS_TABS = {
    stores: 'STORES',
    domains: 'DOMAINS',
    sellers: 'SELLERS',
    'payment-shipping': 'PAYMENT_SHIPPING',
    business: 'BUSINESS',
} as const;

export function StoreSettingsModule() {
    const [tab, setTab] = useUrlTab<Tab>(STORE_SETTINGS_TABS, 'stores');
    const [selectedStoreId, setSelectedStoreId] = useState('');
    const [storeEditor, setStoreEditor] = useState<StoreProfileRecord | null>(null);
    const [provisionOpen, setProvisionOpen] = useState(false);
    const [sellerOpen, setSellerOpen] = useState(false);
    const [notice, setNotice] = useState('');
    const [actionError, setActionError] = useState('');
    const loadingAllStoreSettingsRef = useRef(false);
    const query = useQuery<StoreManagementResult>(STORE_MANAGEMENT_QUERY, {
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
    const isSuperAdmin =
        query.data?.activeAdministrator?.user.roles.some(role => role.code === '__super_admin_role__') ??
        false;

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
                <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
                            <Store className="h-5 w-5 text-blue-600" />
                            店铺综合设置
                        </h1>
                        <p className="mt-1 text-xs text-slate-500">
                            店铺、域名、商家、支付配送及平台业务基础配置集中管理
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
            <main className="mx-auto w-full max-w-[1500px] flex-1 space-y-4 overflow-y-auto p-5 sm:p-8">
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
                            支付与配送
                        </TabButton>
                        {isSuperAdmin && (
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
                                    {storeName(profile)} · {profile.channel.code}
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
                        {tab === 'STORES' && <StoresPanel profiles={profiles} onEdit={setStoreEditor} />}
                        {tab === 'DOMAINS' && (
                            <DomainsPanel
                                profile={selectedProfile}
                                onChanged={message => completed(message)}
                                onError={setActionError}
                            />
                        )}
                        {tab === 'SELLERS' && <SellersPanel sellers={query.data?.sellers.items ?? []} />}
                        {tab === 'PAYMENT_SHIPPING' && (
                            <PaymentShippingPanel
                                data={query.data!}
                                onChanged={completed}
                                onError={setActionError}
                            />
                        )}
                        {tab === 'BUSINESS' &&
                            (isSuperAdmin ? (
                                <BusinessBasicsPanel onChanged={completed} onError={setActionError} />
                            ) : (
                                <EmptyState
                                    icon={<ReceiptText className="h-8 w-8" />}
                                    title="当前账号无权管理平台业务基础"
                                    detail="税率、区域与渠道基础参数仅允许平台超级管理员修改。"
                                />
                            ))}
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
                    onClose={() => setSellerOpen(false)}
                    onCompleted={completed}
                    onError={setActionError}
                />
            )}
        </div>
    );
}

function StoresPanel({
    profiles,
    onEdit,
}: {
    profiles: StoreProfileRecord[];
    onEdit: (profile: StoreProfileRecord) => void;
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
                                    {profile.channel.code}
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

function SellersPanel({ sellers }: { sellers: StoreManagementResult['sellers']['items'] }) {
    return (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="overflow-x-auto">
                <table className="w-full min-w-[650px] text-left text-xs">
                    <thead>
                        <tr className={theadClass}>
                            <th className="p-4">商家主体</th>
                            <th className="p-4">ID</th>
                            <th className="p-4">创建时间</th>
                            <th className="p-4">更新时间</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {sellers.map(seller => (
                            <tr key={seller.id}>
                                <td className="p-4 font-bold text-slate-900">{seller.name}</td>
                                <td className="p-4 font-mono text-[10px] text-slate-400">{seller.id}</td>
                                <td className="p-4 text-slate-500">{formatDateTime(seller.createdAt)}</td>
                                <td className="p-4 text-slate-500">{formatDateTime(seller.updatedAt)}</td>
                            </tr>
                        ))}
                        {!sellers.length && (
                            <tr>
                                <td colSpan={4} className="p-12 text-center text-slate-400">
                                    暂无商家主体
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </section>
    );
}

function PaymentShippingPanel({
    data,
    onChanged,
    onError,
}: {
    data: StoreManagementResult;
    onChanged: (message: string) => Promise<void>;
    onError: (message: string) => void;
}) {
    const [toggle, state] = useMutation(UPDATE_PAYMENT_METHOD_MUTATION);
    const changePayment = async (id: string, enabled: boolean) => {
        try {
            await toggle({ variables: { input: { id, enabled } } });
            await onChanged(`支付方式已${enabled ? '启用' : '停用'}`);
        } catch (error) {
            onError(errorText(error));
        }
    };
    return (
        <div className="grid gap-4 xl:grid-cols-2">
            <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                <div className="border-b border-slate-100 p-5">
                    <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                        <CreditCard className="h-4 w-4 text-blue-600" />
                        支付方式
                    </h2>
                    <p className="mt-1 text-xs text-slate-400">
                        这里只控制真实支付方式是否启用，密钥和处理器参数需在对应插件中配置
                    </p>
                </div>
                <div className="divide-y divide-slate-100">
                    {data.paymentMethods.items.map(item => (
                        <div key={item.id} className="flex items-center justify-between gap-4 p-5">
                            <div>
                                <strong className="text-xs text-slate-900">{item.name}</strong>
                                <p className="mt-1 font-mono text-[9px] text-slate-400">{item.code}</p>
                                {item.description && (
                                    <p className="mt-1 text-[10px] text-slate-500">{item.description}</p>
                                )}
                            </div>
                            <label className="flex cursor-pointer items-center gap-2 text-[10px] font-bold text-slate-500">
                                <input
                                    type="checkbox"
                                    checked={item.enabled}
                                    onChange={event => void changePayment(item.id, event.target.checked)}
                                    disabled={state.loading}
                                />
                                {item.enabled ? '已启用' : '已停用'}
                            </label>
                        </div>
                    ))}
                    {!data.paymentMethods.items.length && (
                        <div className="p-10 text-center text-xs text-slate-400">未配置支付方式</div>
                    )}
                </div>
            </section>
            <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                <div className="border-b border-slate-100 p-5">
                    <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                        <Truck className="h-4 w-4 text-blue-600" />
                        配送方式
                    </h2>
                    <p className="mt-1 text-xs text-slate-400">
                        展示后端已注册的配送规则；费用来自计算器配置，不再伪造“统一运费”字段
                    </p>
                </div>
                <div className="divide-y divide-slate-100">
                    {data.shippingMethods.items.map(item => (
                        <div key={item.id} className="p-5">
                            <div className="flex items-center justify-between gap-3">
                                <strong className="text-xs text-slate-900">{item.name}</strong>
                                <span className="rounded bg-slate-100 px-2 py-1 font-mono text-[9px] text-slate-500">
                                    {item.fulfillmentHandlerCode}
                                </span>
                            </div>
                            <p className="mt-1 font-mono text-[9px] text-slate-400">{item.code}</p>
                            {item.description && (
                                <p className="mt-2 text-[10px] text-slate-500">{item.description}</p>
                            )}
                        </div>
                    ))}
                    {!data.shippingMethods.items.length && (
                        <div className="p-10 text-center text-xs text-slate-400">未配置配送方式</div>
                    )}
                </div>
            </section>
        </div>
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
    const query = useQuery<BusinessSettingsResult>(BUSINESS_SETTINGS_QUERY, {
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
            <ChannelBusinessSettings
                channel={query.data.activeChannel}
                zones={query.data.zones.items}
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
                    onChanged={refresh}
                    onError={onError}
                />
            </div>
        </div>
    );
}

function ChannelBusinessSettings({
    channel,
    zones,
    onChanged,
    onError,
}: {
    channel: BusinessSettingsResult['activeChannel'];
    zones: BusinessSettingsResult['zones']['items'];
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
    const [update, state] = useMutation<{
        updateChannel: { __typename: 'Channel' | 'LanguageNotAvailableError'; message?: string };
    }>(UPDATE_BUSINESS_CHANNEL_MUTATION);
    const submit = async () => {
        const availableLanguageCodes = splitCodes(languages);
        const availableCurrencyCodes = splitCodes(currencies);
        if (!availableLanguageCodes.includes(defaultLanguage)) return onError('默认语言必须包含在可用语言中');
        if (!availableCurrencyCodes.includes(defaultCurrency)) return onError('默认币种必须包含在可用币种中');
        const threshold = Number(outOfStockThreshold);
        if (!Number.isInteger(threshold) || threshold < 0) return onError('缺货阈值必须为非负整数');
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
    const [categoryName, setCategoryName] = useState('');
    const [rateName, setRateName] = useState('');
    const [rateValue, setRateValue] = useState('');
    const [categoryId, setCategoryId] = useState(categories[0]?.id ?? '');
    const [zoneId, setZoneId] = useState(zones[0]?.id ?? '');
    const [createCategory, categoryState] = useMutation(CREATE_BUSINESS_TAX_CATEGORY_MUTATION);
    const [createRate, rateState] = useMutation(CREATE_BUSINESS_TAX_RATE_MUTATION);
    const [updateRate, updateState] = useMutation(UPDATE_BUSINESS_TAX_RATE_MUTATION);
    const addCategory = async () => {
        if (!categoryName.trim()) return;
        try {
            await createCategory({ variables: { input: { name: categoryName.trim() } } });
            setCategoryName('');
            await onChanged('税类已创建');
        } catch (error) {
            onError(errorText(error));
        }
    };
    const addRate = async () => {
        const value = Number(rateValue);
        if (!rateName.trim() || !categoryId || !zoneId || !Number.isFinite(value) || value < 0)
            return onError('请完整填写税率名称、税类、区域和非负税率');
        try {
            await createRate({
                variables: { input: { name: rateName.trim(), value, categoryId, zoneId, enabled: true } },
            });
            setRateName('');
            setRateValue('');
            await onChanged('税率已创建');
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
    const busy = categoryState.loading || rateState.loading || updateState.loading;
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
                <div className="flex gap-2">
                    <input
                        value={categoryName}
                        onChange={event => setCategoryName(event.target.value)}
                        placeholder="新增税类名称"
                        className={inputClass}
                    />
                    <button
                        type="button"
                        onClick={() => void addCategory()}
                        disabled={busy || !categoryName.trim()}
                        className={secondaryButton}
                    >
                        新增税类
                    </button>
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
                    创建税率
                </button>
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
                        <label className="flex items-center gap-2 text-[10px] font-bold text-slate-500">
                            <input
                                type="checkbox"
                                checked={rate.enabled}
                                onChange={event => void toggleRate(rate.id, event.target.checked)}
                                disabled={busy}
                            />
                            {rate.enabled ? '已启用' : '已停用'}
                        </label>
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
    onChanged,
    onError,
}: {
    zones: BusinessSettingsResult['zones']['items'];
    countries: BusinessSettingsResult['countries']['items'];
    onChanged: (message: string) => Promise<void>;
    onError: (message: string) => void;
}) {
    const [name, setName] = useState('');
    const [memberIds, setMemberIds] = useState<string[]>([]);
    const [create, state] = useMutation(CREATE_BUSINESS_ZONE_MUTATION);
    const submit = async () => {
        if (!name.trim() || memberIds.length === 0) return onError('请填写区域名称并选择至少一个国家/地区');
        try {
            await create({ variables: { input: { name: name.trim(), memberIds } } });
            setName('');
            setMemberIds([]);
            await onChanged('国家/地区区域已创建');
        } catch (error) {
            onError(errorText(error));
        }
    };
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
                    placeholder="区域名称，如：中国大陆"
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
                    disabled={state.loading || !name.trim() || memberIds.length === 0}
                    className={primaryButton}
                >
                    创建区域
                </button>
            </div>
            <div className="divide-y divide-slate-100 border-t border-slate-100">
                {zones.map(zone => (
                    <div key={zone.id} className="p-4">
                        <strong className="text-xs text-slate-900">{zone.name}</strong>
                        <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-slate-400">
                            {zone.members.map(member => member.name).join('、') || '尚无成员'}
                        </p>
                    </div>
                ))}
                {!zones.length && (
                    <div className="p-8 text-center text-xs text-slate-400">尚未创建业务区域</div>
                )}
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
    const [nameZh, setNameZh] = useState(profile.channel.customFields.storefrontNameZh);
    const [nameEn, setNameEn] = useState(profile.channel.customFields.storefrontNameEn);
    const [descriptionZh, setDescriptionZh] = useState(profile.descriptionZh);
    const [descriptionEn, setDescriptionEn] = useState(profile.descriptionEn);
    const [internalNote, setInternalNote] = useState(profile.internalNote ?? '');
    const [status, setStatus] = useState(profile.status);
    const [sortOrder, setSortOrder] = useState(profile.sortOrder);
    const [save, state] = useMutation(UPDATE_STORE_PROFILE_MUTATION);
    const submit = async () => {
        if (!nameZh.trim()) return onError('请填写中文店铺名称');
        if (status === 'ACTIVE' && !profile.activationReadiness.ready)
            return onError('上线检查未通过，暂时不能启用店铺');
        try {
            await save({
                variables: {
                    input: {
                        id: profile.id,
                        expectedUpdatedAt: profile.updatedAt,
                        storefrontNameZh: nameZh.trim(),
                        storefrontNameEn: nameEn.trim(),
                        descriptionZh: descriptionZh.trim(),
                        descriptionEn: descriptionEn.trim(),
                        internalNote: internalNote.trim() || null,
                        status,
                        sortOrder,
                    },
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
                <Field label="英文店铺名称">
                    <input
                        value={nameEn}
                        onChange={event => setNameEn(event.target.value)}
                        className={inputClass}
                    />
                </Field>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <Field label="中文简介">
                    <textarea
                        rows={4}
                        value={descriptionZh}
                        onChange={event => setDescriptionZh(event.target.value)}
                        className={inputClass}
                    />
                </Field>
                <Field label="英文简介">
                    <textarea
                        rows={4}
                        value={descriptionEn}
                        onChange={event => setDescriptionEn(event.target.value)}
                        className={inputClass}
                    />
                </Field>
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
                        <option value="SUSPENDED">暂停营业</option>
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
                <Field label="英文网站名称">
                    <input
                        value={draft.storefrontNameEn}
                        onChange={event => set('storefrontNameEn', event.target.value)}
                        className={inputClass}
                    />
                </Field>
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
    onClose,
    onCompleted,
    onError,
}: {
    onClose: () => void;
    onCompleted: (message: string) => Promise<void>;
    onError: (message: string) => void;
}) {
    const [name, setName] = useState('');
    const [create, state] = useMutation(CREATE_SELLER_MUTATION);
    const submit = async () => {
        if (!name.trim()) return onError('请填写商家主体名称');
        try {
            await create({ variables: { input: { name: name.trim() } } });
            await onCompleted('商家主体已创建');
        } catch (error) {
            onError(errorText(error));
        }
    };
    return (
        <Modal title="新增商家主体" description="商家主体用于隔离商品、订单和店铺 Channel" onClose={onClose}>
            <Field label="商家主体名称 *">
                <input
                    value={name}
                    onChange={event => setName(event.target.value)}
                    className={inputClass}
                    autoFocus
                />
            </Field>
            <ModalActions
                onClose={onClose}
                onSave={() => void submit()}
                saving={state.loading}
                saveLabel="创建商家主体"
            />
        </Modal>
    );
}
function StoreInfo({ label, value, tone }: { label: string; value: string; tone?: 'green' | 'amber' }) {
    return (
        <div className="bg-white p-4">
            <div className="text-[9px] font-bold text-slate-400">{label}</div>
            <div
                className={`mt-1 truncate text-xs font-bold ${tone === 'green' ? 'text-emerald-700' : tone === 'amber' ? 'text-amber-700' : 'text-slate-700'}`}
            >
                {value}
            </div>
        </div>
    );
}
function StatusBadge({ status, operational }: { status: string; operational: boolean }) {
    const classes =
        status === 'ACTIVE' && operational
            ? 'bg-emerald-50 text-emerald-700'
            : status === 'SUSPENDED'
              ? 'bg-rose-50 text-rose-700'
              : 'bg-amber-50 text-amber-700';
    const label =
        status === 'ACTIVE'
            ? operational
                ? '正常营业'
                : '配置未完成'
            : status === 'SUSPENDED'
              ? '暂停营业'
              : '草稿';
    return <span className={`rounded px-2 py-1 text-[9px] font-bold ${classes}`}>{label}</span>;
}
function storeName(profile: StoreProfileRecord) {
    return (
        profile.channel.customFields.storefrontNameZh ||
        profile.channel.customFields.storefrontNameEn ||
        profile.channel.code
    );
}
function TabButton({
    active,
    onClick,
    icon,
    children,
}: {
    active: boolean;
    onClick: () => void;
    icon: React.ReactNode;
    children: React.ReactNode;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-bold ${active ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-50'}`}
        >
            {icon}
            {children}
        </button>
    );
}
function Modal({
    title,
    description,
    onClose,
    children,
}: {
    title: string;
    description?: string;
    onClose: () => void;
    children: React.ReactNode;
}) {
    const { dialogRef, titleId } = useAccessibleDialog(onClose);
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
            <div
                ref={dialogRef as React.RefObject<HTMLDivElement>}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                tabIndex={-1}
                className="max-h-[94vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl outline-none"
            >
                <div className="mb-5 flex items-start justify-between gap-4">
                    <div>
                        <h2 id={titleId} className="font-bold text-slate-900">
                            {title}
                        </h2>
                        {description && (
                            <p className="mt-1 text-xs leading-5 text-slate-400">{description}</p>
                        )}
                    </div>
                    <button type="button" onClick={onClose} className="p-1 text-slate-400" aria-label="关闭">
                        <X className="h-5 w-5" />
                    </button>
                </div>
                {children}
            </div>
        </div>
    );
}
function ModalActions({
    onClose,
    onSave,
    saving,
    saveLabel,
}: {
    onClose: () => void;
    onSave: () => void;
    saving: boolean;
    saveLabel: string;
}) {
    return (
        <div className="mt-6 flex justify-end gap-2 border-t border-slate-100 pt-4">
            <button type="button" onClick={onClose} disabled={saving} className={secondaryButton}>
                取消
            </button>
            <button type="button" onClick={onSave} disabled={saving} className={primaryButton}>
                {saving && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />}
                {saveLabel}
            </button>
        </div>
    );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <label className="block text-xs font-bold text-slate-700">
            <span className="mb-1.5 block">{label}</span>
            {children}
        </label>
    );
}
function EmptyState({ icon, title, detail }: { icon: React.ReactNode; title: string; detail: string }) {
    return (
        <div className="flex min-h-96 flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-slate-400">
            {icon}
            <h2 className="mt-3 text-sm font-bold text-slate-700">{title}</h2>
            <p className="mt-1 max-w-md text-xs">{detail}</p>
        </div>
    );
}
function LoadingState() {
    return (
        <div className="flex min-h-96 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white text-xs text-slate-500">
            <LoaderCircle className="h-4 w-4 animate-spin" />
            正在读取真实店铺配置…
        </div>
    );
}
function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
    return (
        <div className="flex min-h-96 flex-col items-center justify-center rounded-xl border border-rose-200 bg-white p-6 text-center">
            <AlertCircle className="h-8 w-8 text-rose-500" />
            <h2 className="mt-3 text-sm font-bold text-slate-800">店铺配置加载失败</h2>
            <p className="mt-1 max-w-lg text-xs text-rose-600">{toUserFacingError(message)}</p>
            <button type="button" onClick={onRetry} className={`${secondaryButton} mt-4`}>
                重试
            </button>
        </div>
    );
}
function Message({
    kind,
    onClose,
    children,
}: {
    kind: 'success' | 'error';
    onClose: () => void;
    children: React.ReactNode;
}) {
    const success = kind === 'success';
    return (
        <div
            className={`flex items-center gap-2 rounded-xl border p-3 text-xs ${success ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'}`}
        >
            {success ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
            <span className="flex-1">{children}</span>
            <button type="button" onClick={onClose} aria-label="关闭">
                <X className="h-4 w-4" />
            </button>
        </div>
    );
}
function errorText(error: unknown) {
    return toUserFacingError(error, '店铺设置操作失败，请稍后重试');
}
function splitCodes(value: string) {
    return [
        ...new Set(
            value
                .split(/[，,\s]+/)
                .map(item => item.trim())
                .filter(Boolean),
        ),
    ];
}
function mergeById<T extends { id: string }>(current: T[], next: T[]) {
    return [...new Map([...current, ...next].map(item => [item.id, item])).values()];
}
const inputClass =
    'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-normal text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-50 disabled:text-slate-400';
const primaryButton =
    'flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50';
const secondaryButton =
    'flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50';
const theadClass = 'border-b border-slate-200 bg-slate-50 text-[10px] font-bold text-slate-500';
