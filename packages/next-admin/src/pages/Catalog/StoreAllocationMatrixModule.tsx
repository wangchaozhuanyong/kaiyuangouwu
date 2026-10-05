import { gql } from '@apollo/client';
import { useMutation } from '@apollo/client/react';
import { useState } from 'react';
import { AdminButton, AdminInput, AdminSelect } from '../../components/AdminControls';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import { useAdminQuery as useQuery } from '../../hooks/use-admin-query';
import { toUserFacingError } from '../../utils/user-facing-error';
import { PlatformResourcePanel } from './PlatformResourcePanel';
import { PlatformSupplyDialog } from './PlatformSupplyDialog';

const CATALOG = gql`
    query PlatformCatalog($skip: Int, $term: String) {
        platformCatalogProducts(skip: $skip, take: 50, term: $term)
    }
`;
const PREVIEW = gql`
    mutation DistributionPreview($input: PlatformCatalogDistributionInput!) {
        previewPlatformCatalogDistribution(input: $input)
    }
`;
const EXECUTE = gql`
    mutation DistributionExecute($batchId: ID!) {
        executePlatformCatalogDistribution(batchId: $batchId)
    }
`;
interface Category {
    id: string;
    name: string;
    parentId: string | null;
    channelIds: string[];
}
interface Store {
    id: string;
    displayName: string;
    currencyCode: string;
    assignedCount: number;
    coverageDenominator: number;
}
interface Product {
    id: string;
    name: string;
    enabled: boolean;
    ownerChannelId: string | null;
    channelIds: string[];
    variants: Array<{ id: string; name: string }>;
}
interface Catalog {
    totalItems: number;
    items: Product[];
    channels: Store[];
    categories: Category[];
    ownershipReviewCount: number;
    unassignedCount: number;
}
interface Item {
    conflict?: string;
    productId: string;
    channelId: string;
    name: string;
    alreadyAssigned: boolean;
    missingPriceCount: number;
    targetCurrencyCode: string;
    plannedPrices: Array<{ variantId: string; price: number | null }>;
}
interface Receipt {
    id: string;
    state: string;
    items: Item[];
    results: Array<{ index: number; success: boolean; message?: string; readback?: { state: string } }>;
}
const statusLabel = (state?: string) =>
    ({
        PREVIEW: '待执行',
        PARTIAL: '部分完成',
        COMPLETE: '回读完成',
        PENDING: '待配置',
        ACTIVE: '启用',
        PAUSED: '暂停',
        REVOKED: '已撤销',
    })[state ?? ''] ?? '未获取';
const control = 'rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm';

export function StoreAllocationMatrixModule() {
    const [supplyProduct, setSupplyProduct] = useState<Product | null>(null);
    const [page, setPage] = useState(0);
    const [term, setTerm] = useState('');
    const [selected, setSelected] = useState<string[]>([]);
    const [variantSelections, setVariantSelections] = useState<Record<string, string[]>>({});
    const [categoryId, setCategoryId] = useState('');
    const [descendants, setDescendants] = useState(true);
    const [targets, setTargets] = useState<string[]>([]);
    const [categoryTargets, setCategoryTargets] = useState<Record<string, string>>({});
    const [prices, setPrices] = useState<Record<string, Record<string, number>>>({});
    const [action, setAction] = useState('GRANT');
    const [receipt, setReceipt] = useState<Receipt | null>(null);
    const [message, setMessage] = useState('');
    const query = useQuery<{ platformCatalogProducts: Catalog }>(CATALOG, {
        variables: { skip: page * 50, term },
    });
    const [preview, previewStatus] = useMutation<{ previewPlatformCatalogDistribution: Receipt }>(PREVIEW);
    const [execute, executeStatus] = useMutation<{ executePlatformCatalogDistribution: Receipt }>(EXECUTE);
    const data = query.data?.platformCatalogProducts;
    const busy = previewStatus.loading || executeStatus.loading;
    const invalidate = () => {
        setReceipt(null);
        setMessage('');
    };
    const toggle = (values: string[], value: string) =>
        values.includes(value) ? values.filter(v => v !== value) : [...values, value];
    const createPreview = async () => {
        setMessage('');
        try {
            const result = await preview({
                variables: {
                    input: {
                        idempotencyKey: crypto.randomUUID(),
                        action,
                        productIds: categoryId ? [] : selected,
                        variantIds: categoryId ? [] : selected.flatMap(id => variantSelections[id] ?? []),
                        collectionId: categoryId || null,
                        includeDescendants: descendants,
                        targets: targets.map(channelId => ({
                            channelId,
                            collectionId: categoryTargets[channelId] || null,
                            prices: Object.entries(prices[channelId] ?? {}).map(([variantId, price]) => ({
                                variantId,
                                price,
                            })),
                        })),
                    },
                },
            });
            setReceipt(result.data?.previewPlatformCatalogDistribution ?? null);
        } catch (error) {
            setMessage(toUserFacingError(error, '预览失败，请检查选择范围'));
        }
    };
    const apply = async () => {
        if (!receipt) return;
        try {
            const result = await execute({ variables: { batchId: receipt.id } });
            const updated = result.data?.executePlatformCatalogDistribution;
            setReceipt(updated ?? null);
            setMessage(
                updated?.state === 'COMPLETE'
                    ? '执行和授权、售价回读完成。交付配置仍需在目标店铺确认。'
                    : '部分项目未完成，请检查逐项结果。数据变化的项目需要重新预览。',
            );
            await query.refetch();
        } catch (error) {
            setMessage(toUserFacingError(error, '执行失败，请刷新后续做'));
        }
    };
    return (
        <div className="h-full overflow-auto bg-slate-50 p-4 space-y-3">
            <header className="flex flex-wrap justify-between gap-4">
                <div>
                    <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
                        平台商品分配中心
                        <FeatureHelpButton
                            topic="catalog.platform-distribution"
                            title="平台商品分配中心"
                            description={
                                '统筹商品维护归属、销售授权和各经营店覆盖情况；整类分配为一次性操作。'
                            }
                        />
                    </h1>
                </div>
                <AdminButton
                    refreshPage
                    className={control}
                    onClick={() => void query.refetch()}
                    disabled={query.loading}
                >
                    刷新
                </AdminButton>
            </header>
            {query.error && (
                <p role="alert" className="text-red-600 dark:text-red-400">
                    {toUserFacingError(query.error, '商品读取失败，请重试')}
                </p>
            )}
            <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
                <span>
                    归属待核对：<b>{data?.ownershipReviewCount ?? '未获取'}</b>
                </span>
                <span>
                    未分配：<b>{data?.unassignedCount ?? '未获取'}</b>
                </span>
                {data?.channels.map(store => (
                    <span key={store.id}>
                        {store.displayName}：{store.assignedCount} / {store.coverageDenominator}（分配覆盖率{' '}
                        {store.coverageDenominator
                            ? Math.round((store.assignedCount / store.coverageDenominator) * 100) + '%'
                            : '无可分配商品'}
                        ）
                    </span>
                ))}
            </div>
            <div className="grid items-start gap-3 xl:grid-cols-[minmax(0,1fr)_20rem]">
                <section className="min-w-0 rounded-xl bg-white p-4 space-y-3">
                    <h2 className="flex items-center gap-2 font-bold">
                        1. 选择商品或整类
                        <FeatureHelpButton topic="catalog.platform-distribution" title="1. 选择商品或整类" />
                    </h2>
                    <div className="flex flex-wrap gap-3">
                        <AdminInput
                            aria-label="搜索商品"
                            className={control}
                            placeholder="搜索商品"
                            value={term}
                            onChange={e => {
                                setTerm(e.target.value);
                                setPage(0);
                            }}
                        />
                        <AdminSelect
                            aria-label="来源分类"
                            className={control}
                            value={categoryId}
                            onChange={e => {
                                setCategoryId(e.target.value);
                                invalidate();
                            }}
                        >
                            <option value="">使用勾选商品（已选 {selected.length} 个）</option>
                            {data?.categories.map(c => (
                                <option key={c.id} value={c.id}>
                                    {c.name} ·{' '}
                                    {data.channels.find(s => c.channelIds.includes(s.id))?.displayName ??
                                        '待核对'}
                                </option>
                            ))}
                        </AdminSelect>
                        <label className="flex items-center gap-2">
                            <AdminInput
                                type="checkbox"
                                checked={descendants}
                                onChange={e => {
                                    setDescendants(e.target.checked);
                                    invalidate();
                                }}
                            />
                            包含子分类及全部分页
                        </label>
                    </div>
                    <div className="overflow-auto">
                        <table className="admin-mobile-record-table w-full text-left text-sm">
                            <thead>
                                <tr className="border-b border-slate-100 text-slate-500">
                                    <th className="py-3">选择</th>
                                    <th>商品</th>
                                    <th>维护店铺</th>
                                    <th>销售店铺</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data?.items.map(p => (
                                    <tr key={p.id} className="border-b border-slate-100">
                                        <td data-label="选择" className="py-3">
                                            <AdminInput
                                                aria-label={`选择 ${p.name}`}
                                                type="checkbox"
                                                disabled={Boolean(categoryId) || !p.ownerChannelId}
                                                checked={selected.includes(p.id)}
                                                onChange={() => {
                                                    setSelected(toggle(selected, p.id));
                                                    setVariantSelections({
                                                        ...variantSelections,
                                                        [p.id]:
                                                            variantSelections[p.id] ??
                                                            p.variants.map(v => v.id),
                                                    });
                                                    invalidate();
                                                }}
                                            />
                                        </td>
                                        <td data-label="商品">
                                            {p.name}
                                            {selected.includes(p.id) && (
                                                <div className="mt-2 flex flex-wrap gap-3">
                                                    {p.variants.map(v => (
                                                        <label
                                                            key={v.id}
                                                            className="flex items-center gap-1 text-xs"
                                                        >
                                                            <AdminInput
                                                                aria-label={`授权规格 ${v.name}`}
                                                                type="checkbox"
                                                                checked={(
                                                                    variantSelections[p.id] ?? []
                                                                ).includes(v.id)}
                                                                onChange={() => {
                                                                    setVariantSelections({
                                                                        ...variantSelections,
                                                                        [p.id]: toggle(
                                                                            variantSelections[p.id] ?? [],
                                                                            v.id,
                                                                        ),
                                                                    });
                                                                    invalidate();
                                                                }}
                                                            />
                                                            {v.name}
                                                        </label>
                                                    ))}
                                                </div>
                                            )}{' '}
                                            {p.ownerChannelId && (
                                                <AdminButton
                                                    className="ml-3 text-xs text-blue-600"
                                                    onClick={() => setSupplyProduct(p)}
                                                >
                                                    供货设置
                                                </AdminButton>
                                            )}
                                        </td>
                                        <td data-label="维护店铺">
                                            {data.channels.find(s => s.id === p.ownerChannelId)
                                                ?.displayName ?? '归属待核对'}
                                        </td>
                                        <td data-label="销售店铺">
                                            {p.channelIds
                                                .map(
                                                    id =>
                                                        data.channels.find(s => s.id === id)?.displayName ??
                                                        '待核对',
                                                )
                                                .join('、') || '未分配'}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    {query.loading && !query.data && <p role="status">读取中…</p>}
                    {data && !data.items.length && <p className="text-slate-500">没有符合条件的商品</p>}
                    <div className="flex items-center gap-4">
                        <AdminButton
                            className={control}
                            disabled={page === 0}
                            onClick={() => setPage(page - 1)}
                        >
                            上一页
                        </AdminButton>
                        <span>
                            第 {page + 1} 页 · {data?.totalItems ?? '未获取'} 个
                        </span>
                        <AdminButton
                            className={control}
                            disabled={!data || (page + 1) * 50 >= data.totalItems}
                            onClick={() => setPage(page + 1)}
                        >
                            下一页
                        </AdminButton>
                    </div>
                </section>
                <section className="min-w-0 rounded-xl bg-white p-4 space-y-3">
                    <h2 className="flex items-center gap-2 font-bold">
                        2. 目标店铺与处理方式
                        <FeatureHelpButton
                            topic="catalog.platform-distribution"
                            title="2. 目标店铺与处理方式"
                            description={
                                '同币种首次授权复制来源售价，已有目标售价保持不变。跨币种缺价格时进入待配置，完成价格与交付设置后才能销售。'
                            }
                        />
                    </h2>

                    {data?.channels.map(store => (
                        <div className="flex flex-wrap items-center gap-4" key={store.id}>
                            <label className="flex items-center gap-2">
                                <AdminInput
                                    type="checkbox"
                                    checked={targets.includes(store.id)}
                                    onChange={() => {
                                        setTargets(toggle(targets, store.id));
                                        invalidate();
                                    }}
                                />
                                {store.displayName} · {store.currencyCode}
                            </label>
                            {targets.includes(store.id) && (
                                <AdminSelect
                                    aria-label={`${store.displayName}目标分类`}
                                    className={control}
                                    value={categoryTargets[store.id] ?? ''}
                                    onChange={e => {
                                        setCategoryTargets({
                                            ...categoryTargets,
                                            [store.id]: e.target.value,
                                        });
                                        invalidate();
                                    }}
                                >
                                    <option value="">不调整目标分类</option>
                                    {data.categories
                                        .filter(c => c.channelIds.includes(store.id))
                                        .map(c => (
                                            <option key={c.id} value={c.id}>
                                                {c.name}
                                            </option>
                                        ))}
                                </AdminSelect>
                            )}
                        </div>
                    ))}
                    <AdminSelect
                        aria-label="授权操作"
                        className={`${control} w-full`}
                        value={action}
                        onChange={e => {
                            setAction(e.target.value);
                            invalidate();
                        }}
                    >
                        <option value="GRANT">新增销售授权</option>
                        <option value="REVOKE">撤销销售授权（已付款订单继续履约）</option>
                    </AdminSelect>
                    <AdminButton
                        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
                        disabled={
                            busy ||
                            !targets.length ||
                            (!categoryId &&
                                (!selected.length || selected.some(id => !variantSelections[id]?.length)))
                        }
                        onClick={() => void createPreview()}
                    >
                        生成预览
                    </AdminButton>
                </section>
            </div>
            {receipt && (
                <section className="rounded-xl bg-white p-5 space-y-4">
                    <h2 className="flex items-center gap-2 font-bold">
                        3. 预览与实际结果 · {statusLabel(receipt.state)}
                        <FeatureHelpButton topic="catalog.platform-distribution" title="3. 预览与实际结果" />
                    </h2>
                    <p className="text-sm text-slate-500">
                        批次 {receipt.id}：{receipt.items.length} 项，新增{' '}
                        {receipt.items.filter(i => !i.conflict && !i.alreadyAssigned).length}，已有{' '}
                        {receipt.items.filter(i => !i.conflict && i.alreadyAssigned).length}，待配置{' '}
                        {receipt.items.filter(i => i.missingPriceCount).length}，冲突{' '}
                        {receipt.items.filter(i => i.conflict).length}。
                    </p>
                    {receipt.items.map((item, index) => (
                        <div
                            key={`${item.productId}-${item.channelId}`}
                            className="py-3 border-b border-slate-100"
                        >
                            <p className="text-sm font-medium">
                                {item.name ?? `商品 ${item.productId}`} →{' '}
                                {data?.channels.find(s => s.id === item.channelId)?.displayName} ·{' '}
                                {item.conflict ??
                                    (item.missingPriceCount
                                        ? '缺售价，待配置'
                                        : item.alreadyAssigned
                                          ? '已存在，保留经营设置'
                                          : '新增授权')}
                            </p>
                            {(item.plannedPrices ?? [])
                                .filter(p => p.price == null)
                                .map(p => (
                                    <label key={p.variantId} className="mt-2 flex items-center gap-3 text-sm">
                                        规格 {p.variantId} · {item.targetCurrencyCode}（最小货币单位）
                                        <AdminInput
                                            className={control}
                                            type="number"
                                            min="0"
                                            step="1"
                                            value={prices[item.channelId]?.[p.variantId] ?? ''}
                                            onChange={e => {
                                                const value = e.target.value;
                                                setPrices({
                                                    ...prices,
                                                    [item.channelId]: {
                                                        ...prices[item.channelId],
                                                        [p.variantId]: Number(value),
                                                    },
                                                });
                                                setMessage('目标售价已调整，请重新生成预览。');
                                            }}
                                        />
                                    </label>
                                ))}
                            {receipt.results.find(r => r.index === index) && (
                                <p className="text-sm mt-2">
                                    {receipt.results.find(r => r.index === index)?.success
                                        ? `已回读：${statusLabel(receipt.results.find(r => r.index === index)?.readback?.state)}`
                                        : receipt.results.find(r => r.index === index)?.message}
                                </p>
                            )}
                        </div>
                    ))}
                    <AdminButton
                        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
                        disabled={busy || receipt.state === 'COMPLETE' || message.includes('重新生成预览')}
                        onClick={() => void apply()}
                    >
                        {receipt.state === 'PARTIAL' ? '继续失败项目' : '确认执行此预览'}
                    </AdminButton>
                    {message.includes('重新生成预览') && (
                        <AdminButton className={control} disabled={busy} onClick={() => void createPreview()}>
                            重新生成预览
                        </AdminButton>
                    )}
                </section>
            )}
            {message && (
                <p role="status" className="text-sm text-slate-700">
                    {message}
                </p>
            )}
            <details className="rounded-xl bg-white">
                <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">
                    资源归属与公共模板
                </summary>
                <PlatformResourcePanel stores={data?.channels ?? []} />
            </details>
            {supplyProduct?.ownerChannelId && (
                <PlatformSupplyDialog
                    productId={supplyProduct.id}
                    sourceChannelId={supplyProduct.ownerChannelId}
                    stores={data?.channels ?? []}
                    onClose={() => setSupplyProduct(null)}
                />
            )}
        </div>
    );
}
