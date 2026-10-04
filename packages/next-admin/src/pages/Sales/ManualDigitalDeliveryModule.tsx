import { useMutation } from '@apollo/client/react';
import { useDeferredValue, useState } from 'react';
import { serviceMessageDisplay } from '../../../../common/src/display-localization';
import { systemFieldDisplayLabel } from '../../../../common/src/system-display-labels';
import { AdminButton, AdminInput, AdminSelect, AdminTextArea } from '../../components/AdminControls';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import { GET_ASSETS } from '../../graphql/catalog.graphql';
import {
    GET_MANUAL_DELIVERIES,
    GET_MANUAL_DELIVERY,
    PUBLISH_MANUAL_DELIVERY,
    RETRY_MANUAL_DELIVERY,
    SAVE_MANUAL_DELIVERY_DRAFT,
    type ManualDeliveryRecord,
} from '../../graphql/manual-digital-delivery.graphql';
import { useAdminPermissions } from '../../hooks/use-admin-permissions';
import { useAdminQuery as useQuery } from '../../hooks/use-admin-query';
import { toUserFacingError } from '../../utils/user-facing-error';

type DeliveryPackage = {
    account: string;
    key: string;
    note: string;
    attachmentAssetIds: string[];
    otherFields: Array<{ key: string; label: string; value: string; secret: boolean }>;
};

const PAGE_SIZE = 20;
const editableStates = new Set(['WAITING_PROCESSING', 'DRAFT']);
const retryableStates = new Set(['EMAIL_FAILED', 'MANUAL_REVIEW', 'SENT']);
const stateLabels: Record<ManualDeliveryRecord['state'], string> = {
    WAITING_PROCESSING: '待准备成品',
    DRAFT: '成品草稿',
    SENDING: '邮件发送中',
    SENT: '已发送',
    EMAIL_FAILED: '邮件发送失败',
    MANUAL_REVIEW: '待人工复核',
    CANCELLED: '已取消',
};

function packageDrafts(delivery: ManualDeliveryRecord): DeliveryPackage[] {
    return Array.from({ length: delivery.quantity }, (_, index) => {
        const saved = delivery.packages[index];
        return {
            account: saved?.fields.find(field => field.key === 'account')?.value ?? '',
            key: saved?.fields.find(field => field.key === 'password')?.value ?? '',
            note: saved?.note ?? '',
            attachmentAssetIds: saved?.attachmentAssetIds ?? [],
            otherFields:
                saved?.fields.filter(field => field.key !== 'account' && field.key !== 'password') ?? [],
        };
    });
}

function deliveryInput(id: string, packages: DeliveryPackage[]) {
    return {
        id,
        packages: packages.map(item => ({
            fields: [
                ...item.otherFields,
                ...(item.account.trim()
                    ? [{ key: 'account', label: '账号', value: item.account.trim(), secret: false }]
                    : []),
                ...(item.key.trim()
                    ? [{ key: 'password', label: '密钥/密码', value: item.key.trim(), secret: true }]
                    : []),
            ],
            note: item.note.trim(),
            attachmentAssetIds: item.attachmentAssetIds,
        })),
    };
}

export function ManualDigitalDeliveryModule() {
    const { hasAnyPermission } = useAdminPermissions();
    const canUpdate = hasAnyPermission(['UpdateOrder']);
    const [page, setPage] = useState(0);
    const [state, setState] = useState('');
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [notice, setNotice] = useState('');
    const query = useQuery<{
        manualDigitalDeliveries: { items: ManualDeliveryRecord[]; totalItems: number };
    }>(GET_MANUAL_DELIVERIES, {
        variables: { options: { skip: page * PAGE_SIZE, take: PAGE_SIZE, ...(state ? { state } : {}) } },
    });
    const items = query.data?.manualDigitalDeliveries.items ?? [];
    const total = query.data?.manualDigitalDeliveries.totalItems ?? 0;

    return (
        <div className="h-full overflow-y-auto bg-slate-50 p-5 sm:p-8">
            <main className="mx-auto max-w-6xl space-y-5">
                <header className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <h1 className="text-xl font-bold text-slate-900">
                            人工数字交付
                            <FeatureHelpButton topic="sales.manual-digital-delivery" title="人工数字交付" />
                        </h1>
                        <p className="mt-1 text-xs text-slate-500">
                            付款后按订单生成交付任务；每件商品对应一个成品包，发布后发送到订单交付邮箱。
                        </p>
                    </div>
                    <AdminButton
                        refreshPage
                        type="button"
                        onClick={() => void query.refetch()}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold"
                    >
                        刷新任务
                    </AdminButton>
                </header>
                {notice && (
                    <p role="status" className="rounded-lg bg-emerald-50 p-3 text-xs text-emerald-800">
                        {notice}
                    </p>
                )}
                <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs">
                    <div className="mb-4 flex flex-wrap items-center gap-3">
                        <label
                            className="text-xs font-semibold text-slate-700"
                            htmlFor="manual-delivery-state"
                        >
                            任务状态
                        </label>
                        <AdminSelect
                            id="manual-delivery-state"
                            value={state}
                            onChange={event => {
                                setState(event.target.value);
                                setPage(0);
                            }}
                            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
                        >
                            <option value="">全部状态</option>
                            {Object.entries(stateLabels).map(([value, label]) => (
                                <option key={value} value={value}>
                                    {label}
                                </option>
                            ))}
                        </AdminSelect>
                        <span className="text-xs text-slate-500">共 {total} 条</span>
                    </div>
                    {query.error && (
                        <p role="alert" className="mb-3 text-xs text-rose-700">
                            {toUserFacingError(query.error, '任务读取失败')}
                        </p>
                    )}
                    {query.loading && !query.data ? (
                        <p role="status" className="py-8 text-center text-xs text-slate-500">
                            正在读取交付任务…
                        </p>
                    ) : items.length === 0 ? (
                        <p className="py-8 text-center text-xs text-slate-500">当前没有交付任务</p>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[760px] text-left text-xs">
                                <thead>
                                    <tr className="border-b border-slate-200 text-slate-500">
                                        <th className="p-2">订单 / 商品</th>
                                        <th className="p-2">交付邮箱</th>
                                        <th className="p-2">数量</th>
                                        <th className="p-2">预计时间</th>
                                        <th className="p-2">状态</th>
                                        <th className="p-2">操作</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {items.map(item => (
                                        <tr key={item.id} className="border-b border-slate-100">
                                            <td className="p-2">
                                                <strong className="block text-slate-900">
                                                    {item.productName}
                                                </strong>
                                                <span className="text-slate-500">
                                                    {item.order.code} · {item.sku}
                                                </span>
                                            </td>
                                            <td className="break-all p-2">{item.recipientEmail}</td>
                                            <td className="p-2">{item.quantity}</td>
                                            <td className="p-2">
                                                {item.overdue ? '已超时 · ' : ''}
                                                {new Date(item.expectedAt).toLocaleString()}
                                            </td>
                                            <td className="p-2">{stateLabels[item.state]}</td>
                                            <td className="p-2">
                                                <AdminButton
                                                    type="button"
                                                    onClick={() => setSelectedId(item.id)}
                                                    className="rounded-lg border border-blue-200 px-3 py-1.5 font-semibold text-blue-700"
                                                >
                                                    {editableStates.has(item.state) && canUpdate
                                                        ? '准备交付'
                                                        : '查看详情'}
                                                </AdminButton>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                    <div className="mt-4 flex items-center justify-end gap-3 text-xs">
                        <AdminButton
                            type="button"
                            disabled={page === 0 || query.loading}
                            onClick={() => setPage(value => value - 1)}
                            className="rounded-lg border px-3 py-1.5 disabled:opacity-40"
                        >
                            上一页
                        </AdminButton>
                        <span>
                            第 {page + 1} / {Math.max(1, Math.ceil(total / PAGE_SIZE))} 页
                        </span>
                        <AdminButton
                            type="button"
                            disabled={(page + 1) * PAGE_SIZE >= total || query.loading}
                            onClick={() => setPage(value => value + 1)}
                            className="rounded-lg border px-3 py-1.5 disabled:opacity-40"
                        >
                            下一页
                        </AdminButton>
                    </div>
                </section>
                {selectedId && (
                    <DeliveryEditor
                        id={selectedId}
                        canUpdate={canUpdate}
                        onClose={() => setSelectedId(null)}
                        onSaved={message => {
                            setSelectedId(null);
                            setNotice(message);
                            void query.refetch();
                        }}
                    />
                )}
            </main>
        </div>
    );
}

function DeliveryEditor({
    id,
    canUpdate,
    onClose,
    onSaved,
}: {
    id: string;
    canUpdate: boolean;
    onClose: () => void;
    onSaved: (message: string) => void;
}) {
    const query = useQuery<{ manualDigitalDelivery: ManualDeliveryRecord | null }>(GET_MANUAL_DELIVERY, {
        variables: { id },
    });
    const delivery = query.data?.manualDigitalDelivery;
    return (
        <section
            aria-label="交付任务详情"
            className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs"
        >
            <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                    <h2 className="text-sm font-bold text-slate-900">
                        交付任务详情
                        <FeatureHelpButton topic="sales.manual-digital-delivery" title="交付任务详情" />
                    </h2>
                    {delivery && (
                        <p className="mt-1 text-xs text-slate-500">
                            订单 {delivery.order.code} · {delivery.productName} ·{' '}
                            {stateLabels[delivery.state]}
                        </p>
                    )}
                </div>
                <AdminButton
                    type="button"
                    onClick={onClose}
                    className="rounded-lg border px-3 py-1.5 text-xs"
                >
                    关闭
                </AdminButton>
            </div>
            {query.error && (
                <p role="alert" className="text-xs text-rose-700">
                    {toUserFacingError(query.error, '交付详情读取失败')}
                </p>
            )}
            {query.loading && !query.data && (
                <p role="status" className="text-xs text-slate-500">
                    正在读取交付详情…
                </p>
            )}
            {delivery && (
                <DeliveryForm
                    key={`${delivery.id}:${delivery.state}:${delivery.attemptCount}`}
                    delivery={delivery}
                    canUpdate={canUpdate}
                    onSaved={onSaved}
                />
            )}
        </section>
    );
}

function DeliveryForm({
    delivery,
    canUpdate,
    onSaved,
}: {
    delivery: ManualDeliveryRecord;
    canUpdate: boolean;
    onSaved: (message: string) => void;
}) {
    const [packages, setPackages] = useState(() => packageDrafts(delivery));
    const [confirmPublish, setConfirmPublish] = useState(false);
    const [confirmRetry, setConfirmRetry] = useState(false);
    const [assetPackage, setAssetPackage] = useState<number | null>(null);
    const [assetSearch, setAssetSearch] = useState('');
    const [assetPage, setAssetPage] = useState(0);
    const [error, setError] = useState('');
    const [saveDraft, saveState] = useMutation(SAVE_MANUAL_DELIVERY_DRAFT);
    const [publish, publishState] = useMutation(PUBLISH_MANUAL_DELIVERY);
    const [retry, retryState] = useMutation(RETRY_MANUAL_DELIVERY);
    const deferredAssetSearch = useDeferredValue(assetSearch.trim());
    const assets = useQuery<{
        assets: { items: Array<{ id: string; name: string; type: string }>; totalItems: number };
    }>(GET_ASSETS, {
        variables: {
            options: {
                skip: assetPage * PAGE_SIZE,
                take: PAGE_SIZE,
                filter: deferredAssetSearch ? { name: { contains: deferredAssetSearch } } : {},
            },
        },
        skip: assetPackage === null,
    });
    const editable = canUpdate && editableStates.has(delivery.state);
    const busy = saveState.loading || publishState.loading || retryState.loading;
    const setPackage = (index: number, changes: Partial<DeliveryPackage>) =>
        setPackages(current => current.map((item, i) => (i === index ? { ...item, ...changes } : item)));
    const execute = async (kind: 'draft' | 'publish' | 'retry') => {
        setError('');
        try {
            if (kind === 'retry') {
                await retry({ variables: { id: delivery.id } });
                onSaved('已重新排队发送原成品');
                return;
            }
            if (
                packages.length !== delivery.quantity ||
                packages.some(
                    item =>
                        !item.account.trim() &&
                        !item.key.trim() &&
                        !item.note.trim() &&
                        item.attachmentAssetIds.length === 0 &&
                        item.otherFields.length === 0,
                )
            ) {
                setError(`必须填写 ${delivery.quantity} 个非空成品包，每件至少填写账号、密钥、说明或附件。`);
                return;
            }
            const variables = { input: deliveryInput(delivery.id, packages) };
            if (kind === 'draft') {
                await saveDraft({ variables });
                onSaved('人工交付草稿已保存');
            } else {
                await publish({ variables });
                onSaved('成品已发布，邮件已进入发送队列');
            }
        } catch (cause) {
            setError(toUserFacingError(cause, '交付操作失败'));
        }
    };

    return (
        <div className="space-y-4 text-xs">
            <div className="rounded-lg bg-slate-50 p-3 text-slate-700">
                收件邮箱：<strong>{delivery.recipientEmail}</strong> · 数量 {delivery.quantity} · 预计{' '}
                {new Date(delivery.expectedAt).toLocaleString()}
            </div>
            {delivery.lastError && (
                <p role="alert" className="rounded-lg bg-rose-50 p-3 text-rose-700">
                    {serviceMessageDisplay(delivery.lastError)}
                </p>
            )}
            {delivery.events?.length ? (
                <section aria-label="交付处理记录" className="rounded-lg border border-slate-200 p-3 text-xs">
                    <h3 className="font-semibold text-slate-800">
                        交付处理记录 · 发送尝试 {delivery.attemptCount} 次
                        <FeatureHelpButton topic="sales.manual-digital-delivery" title="交付处理记录" />
                    </h3>
                    <ol className="mt-2 space-y-2">
                        {delivery.events.map(event => (
                            <li key={event.id} className="border-t border-slate-100 pt-2 text-slate-600">
                                {serviceMessageDisplay(event.note)} ·{' '}
                                {new Date(event.createdAt).toLocaleString()}
                            </li>
                        ))}
                    </ol>
                </section>
            ) : null}
            {error && (
                <p role="alert" className="rounded-lg bg-rose-50 p-3 text-rose-700">
                    {error}
                </p>
            )}
            {packages.map((item, index) => (
                <fieldset
                    key={index}
                    disabled={!editable || busy}
                    className="space-y-3 rounded-lg border border-slate-200 p-3"
                >
                    <legend className="px-1 font-semibold text-slate-800">成品包 {index + 1}</legend>
                    <div className="grid gap-3 sm:grid-cols-2">
                        <label className="space-y-1">
                            <span>账号（可选）</span>
                            <AdminInput
                                aria-label={`成品包 ${index + 1} 账号`}
                                value={item.account}
                                onChange={event => setPackage(index, { account: event.target.value })}
                                className="w-full rounded-lg border border-slate-300 px-3 py-2"
                            />
                        </label>
                        <label className="space-y-1">
                            <span>密钥 / 密码（可选）</span>
                            <AdminInput
                                aria-label={`成品包 ${index + 1} 密钥`}
                                type="password"
                                autoComplete="off"
                                value={item.key}
                                onChange={event => setPackage(index, { key: event.target.value })}
                                className="w-full rounded-lg border border-slate-300 px-3 py-2"
                            />
                        </label>
                    </div>
                    <label className="block space-y-1">
                        <span>交付说明</span>
                        <AdminTextArea
                            aria-label={`成品包 ${index + 1} 交付说明`}
                            value={item.note}
                            onChange={event => setPackage(index, { note: event.target.value })}
                            rows={3}
                            className="w-full rounded-lg border border-slate-300 px-3 py-2"
                        />
                    </label>
                    <div className="flex flex-wrap items-center gap-2">
                        <span>附件 {item.attachmentAssetIds.length} 件</span>
                        {editable && (
                            <AdminButton
                                type="button"
                                onClick={() => {
                                    setAssetPackage(index);
                                    setAssetPage(0);
                                }}
                                className="rounded-lg border px-2.5 py-1.5"
                            >
                                从本店素材库选择
                            </AdminButton>
                        )}
                    </div>
                    {item.attachmentAssetIds.map(assetId => (
                        <div key={assetId} className="flex items-center gap-2">
                            <span>素材 #{assetId}</span>
                            {editable && (
                                <AdminButton
                                    type="button"
                                    onClick={() =>
                                        setPackage(index, {
                                            attachmentAssetIds: item.attachmentAssetIds.filter(
                                                id => id !== assetId,
                                            ),
                                        })
                                    }
                                    className="text-rose-700"
                                >
                                    移除
                                </AdminButton>
                            )}
                        </div>
                    ))}
                    {item.otherFields.length > 0 && (
                        <p>已保留原成品中的其他字段 {item.otherFields.length} 项。</p>
                    )}
                </fieldset>
            ))}
            {assetPackage !== null && (
                <section
                    aria-label="选择交付附件"
                    className="space-y-3 rounded-lg border border-blue-200 bg-blue-50 p-3"
                >
                    <div className="flex justify-between">
                        <strong>选择成品包 {assetPackage + 1} 的附件</strong>
                        <AdminButton type="button" onClick={() => setAssetPackage(null)}>
                            关闭
                        </AdminButton>
                    </div>
                    <AdminInput
                        aria-label="搜索交付附件"
                        placeholder="搜索本店素材名称"
                        value={assetSearch}
                        onChange={event => {
                            setAssetSearch(event.target.value);
                            setAssetPage(0);
                        }}
                        className="w-full rounded-lg border px-3 py-2"
                    />
                    {assets.error && <p role="alert">{toUserFacingError(assets.error, '素材库读取失败')}</p>}
                    {assets.loading && !assets.data && <p role="status">正在读取素材…</p>}
                    <div className="grid gap-2 sm:grid-cols-2">
                        {assets.data?.assets.items.map(asset => (
                            <AdminButton
                                key={asset.id}
                                type="button"
                                aria-pressed={packages[assetPackage]?.attachmentAssetIds.includes(asset.id)}
                                onClick={() => {
                                    const item = packages[assetPackage];
                                    if (item)
                                        setPackage(assetPackage, {
                                            attachmentAssetIds: item.attachmentAssetIds.includes(asset.id)
                                                ? item.attachmentAssetIds.filter(id => id !== asset.id)
                                                : [...item.attachmentAssetIds, asset.id],
                                        });
                                }}
                                className="rounded-lg border border-slate-300 bg-white p-2 text-left"
                            >
                                {asset.name} · {systemFieldDisplayLabel('type', asset.type)}
                            </AdminButton>
                        ))}
                    </div>
                    <div className="flex items-center justify-end gap-3">
                        <AdminButton
                            type="button"
                            disabled={assetPage === 0}
                            onClick={() => setAssetPage(value => value - 1)}
                        >
                            上一页
                        </AdminButton>
                        <span>第 {assetPage + 1} 页</span>
                        <AdminButton
                            type="button"
                            disabled={(assetPage + 1) * PAGE_SIZE >= (assets.data?.assets.totalItems ?? 0)}
                            onClick={() => setAssetPage(value => value + 1)}
                        >
                            下一页
                        </AdminButton>
                    </div>
                </section>
            )}
            {editable && (
                <div className="flex flex-wrap items-center gap-2">
                    <AdminButton
                        type="button"
                        disabled={busy}
                        onClick={() => void execute('draft')}
                        className="rounded-lg border border-slate-300 px-3 py-2 font-semibold"
                    >
                        保存草稿
                    </AdminButton>
                    {confirmPublish ? (
                        <>
                            <span>请核对收件邮箱及全部成品包，发布后将发送邮件。</span>
                            <AdminButton
                                type="button"
                                disabled={busy}
                                onClick={() => void execute('publish')}
                                className="rounded-lg bg-blue-700 px-3 py-2 font-semibold text-white"
                            >
                                确认发布并发送
                            </AdminButton>
                            <AdminButton type="button" onClick={() => setConfirmPublish(false)}>
                                返回修改
                            </AdminButton>
                        </>
                    ) : (
                        <AdminButton
                            type="button"
                            disabled={busy}
                            onClick={() => setConfirmPublish(true)}
                            className="rounded-lg bg-blue-700 px-3 py-2 font-semibold text-white"
                        >
                            发布交付
                        </AdminButton>
                    )}
                </div>
            )}
            {canUpdate && retryableStates.has(delivery.state) && (
                <div className="flex flex-wrap items-center gap-2">
                    {confirmRetry ? (
                        <>
                            <span>重发会向同一邮箱再次发送原成品，不会修改内容。</span>
                            <AdminButton
                                type="button"
                                disabled={busy}
                                onClick={() => void execute('retry')}
                                className="rounded-lg border border-blue-300 px-3 py-2 font-semibold text-blue-700"
                            >
                                确认重发
                            </AdminButton>
                            <AdminButton type="button" onClick={() => setConfirmRetry(false)}>
                                取消
                            </AdminButton>
                        </>
                    ) : (
                        <AdminButton
                            type="button"
                            disabled={busy}
                            onClick={() => setConfirmRetry(true)}
                            className="rounded-lg border border-blue-300 px-3 py-2 font-semibold text-blue-700"
                        >
                            重发原成品
                        </AdminButton>
                    )}
                </div>
            )}
        </div>
    );
}
