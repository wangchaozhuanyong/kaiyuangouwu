import { useMutation, useQuery } from '@apollo/client/react';
import { ExternalLink, Globe2, Pencil, Plus, Store, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { client } from '../../apollo';
import { useConfirmDialog } from '../../components/confirm-dialog-context';
import { useCustomFieldDefinitions } from '../../custom-fields/custom-fields-context';
import {
    STORE_COMMERCE_MODE_QUERY,
    UPDATE_STORE_COMMERCE_MODE_MUTATION,
    type StoreCommerceMode,
    type StoreCommerceModeData,
} from '../../graphql/commerce.graphql';
import {
    CREATE_STORE_DOMAIN_MUTATION,
    DELETE_SELLER_MUTATION,
    DELETE_STORE_DOMAIN_MUTATION,
    SET_PRIMARY_STORE_DOMAIN_MUTATION,
    STORE_DOMAINS_QUERY,
    STORE_DOMAIN_TRANSFER_IMPACT_QUERY,
    TRANSFER_STORE_DOMAIN_MUTATION,
    VERIFY_STORE_DOMAIN_MUTATION,
    type StoreDomainRecord,
    type StoreDomainTransferImpactRecord,
    type StoreDomainsResult,
    type StoreManagementResult,
    type StoreProfileRecord,
} from '../../graphql/management.graphql';
import { getChannelDisplayName } from '../../utils/channel-display';
import { toUserFacingError } from '../../utils/user-facing-error';
import { formatDateTime } from '../Sales/sales-utils';
import {
    EmptyState,
    ErrorState,
    LoadingState,
    StatusBadge,
    StoreInfo,
    errorText,
    inputClass,
    primaryButton,
    secondaryButton,
    theadClass,
} from './settings-ui';
import { SellerDialog, storeName } from './StoreDialogs';

export function CommerceModePanel({
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

export function StoresPanel({
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

export function DomainsPanel({
    profile,
    profiles,
    onChanged,
    onError,
}: {
    profile: StoreProfileRecord | null;
    profiles: StoreProfileRecord[];
    onChanged: (message: string) => Promise<void>;
    onError: (message: string) => void;
}) {
    const requestConfirmation = useConfirmDialog();
    const [domain, setDomain] = useState('');
    const [transferTargets, setTransferTargets] = useState<Record<string, string>>({});
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
    const [transfer, transferState] = useMutation(TRANSFER_STORE_DOMAIN_MUTATION);
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
    const transferDomain = async (item: StoreDomainRecord) => {
        const targetChannelId = transferTargets[item.id];
        if (!targetChannelId) return onError('请选择域名要转移到的目标店铺');
        try {
            const impactResponse = await client.query<{
                storeDomainTransferImpact: StoreDomainTransferImpactRecord;
            }>({
                query: STORE_DOMAIN_TRANSFER_IMPACT_QUERY,
                variables: { id: item.id, targetChannelId },
                fetchPolicy: 'network-only',
            });
            const impact = impactResponse.data?.storeDomainTransferImpact;
            if (!impact) throw new Error('未读取到域名转移影响，请刷新后重试');
            if (!impact.canTransfer) throw new Error(impact.blocker || '当前域名不能转移');
            const target = profiles.find(candidate => candidate.channel.id === targetChannelId);
            const confirmed = await requestConfirmation({
                title: `把 ${item.domain} 转移到 ${target ? storeName(target) : impact.targetChannel.code}？`,
                description: [
                    '验证状态与证书配置将保留，域名会立即成为目标店铺的主域名。',
                    impact.targetPrimaryDomain
                        ? `目标店铺现有主域名 ${impact.targetPrimaryDomain} 将降为备用域名。`
                        : '',
                    item.isPrimary
                        ? impact.sourceReplacementDomain
                            ? `原店铺将自动启用 ${impact.sourceReplacementDomain} 作为主域名。`
                            : '原店铺转移后将暂时没有主域名。'
                        : '',
                ]
                    .filter(Boolean)
                    .join(' '),
                confirmLabel: '确认原子转移',
                tone: 'warning',
            });
            if (!confirmed) return;
            await transfer({
                variables: {
                    input: {
                        id: item.id,
                        targetChannelId,
                        expectedUpdatedAt: item.updatedAt,
                    },
                },
            });
            setTransferTargets(current => ({ ...current, [item.id]: '' }));
            await refresh(`域名 ${item.domain} 已转移到目标店铺并设为主域名`);
        } catch (error) {
            onError(errorText(error));
        }
    };
    const busy =
        createState.loading ||
        verifyState.loading ||
        primaryState.loading ||
        removeState.loading ||
        transferState.loading;
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
                                    {profiles.some(
                                        candidate => candidate.channel.id !== profile.channel.id,
                                    ) && (
                                        <div className="flex gap-2">
                                            <select
                                                value={transferTargets[item.id] ?? ''}
                                                onChange={event =>
                                                    setTransferTargets(current => ({
                                                        ...current,
                                                        [item.id]: event.target.value,
                                                    }))
                                                }
                                                disabled={busy}
                                                className={inputClass}
                                                aria-label={`选择 ${item.domain} 的目标店铺`}
                                            >
                                                <option value="">转移到其他店铺…</option>
                                                {profiles
                                                    .filter(
                                                        candidate =>
                                                            candidate.channel.id !== profile.channel.id,
                                                    )
                                                    .map(candidate => (
                                                        <option
                                                            key={candidate.channel.id}
                                                            value={candidate.channel.id}
                                                        >
                                                            {storeName(candidate)}
                                                        </option>
                                                    ))}
                                            </select>
                                            <button
                                                type="button"
                                                onClick={() => void transferDomain(item)}
                                                disabled={busy || !transferTargets[item.id]}
                                                className={secondaryButton}
                                            >
                                                原子转移
                                            </button>
                                        </div>
                                    )}
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

export function SellersPanel({
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
