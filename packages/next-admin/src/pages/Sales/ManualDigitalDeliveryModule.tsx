import { useMutation } from '@apollo/client/react';
import { useDeferredValue, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { serviceMessageDisplay } from '../../../../common/src/display-localization';
import { systemFieldDisplayLabel } from '../../../../common/src/system-display-labels';
import { AdminButton, AdminInput, AdminSelect, AdminTextArea } from '../../components/AdminControls';
import { AdminField } from '../../components/AdminField';
import { DraftUpdateNotice } from '../../components/DraftUpdateNotice';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import { GET_ASSETS } from '../../graphql/catalog.graphql';
import {
    APPEND_MANUAL_DELIVERY,
    GET_MANUAL_DELIVERIES,
    GET_MANUAL_DELIVERY,
    PUBLISH_MANUAL_DELIVERY,
    RETRY_MANUAL_DELIVERY,
    REVEAL_MANUAL_DELIVERY,
    SAVE_MANUAL_DELIVERY_DRAFT,
    type ManualDeliveryRecord,
} from '../../graphql/manual-digital-delivery.graphql';
import { useAdminPermissions } from '../../hooks/use-admin-permissions';
import { useAdminQuery as useQuery } from '../../hooks/use-admin-query';
import { useServerDraft } from '../../hooks/use-server-draft';
import { useUnsavedChangesWarning } from '../../hooks/use-unsaved-changes-warning';
import { toUserFacingError } from '../../utils/user-facing-error';
import { parseManualDeliveryPaste, type ManualDeliveryPastePreview } from './manual-delivery-paste';

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
    SENDING: '领取通知发送中',
    SENT: '领取通知已发送',
    EMAIL_FAILED: '领取通知发送失败',
    MANUAL_REVIEW: '待人工复核',
    CANCELLED: '已取消',
};

function packageDrafts(
    delivery: ManualDeliveryRecord,
    quantity: number,
    appendOnly: boolean,
): DeliveryPackage[] {
    return Array.from({ length: quantity }, (_, index) => {
        const saved = appendOnly ? undefined : delivery.packages?.[index];
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
            note: item.note,
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
                            <FeatureHelpButton
                                topic="sales.manual-digital-delivery"
                                title="人工数字交付"
                                description="付款后按订单生成交付任务；每件商品对应一个成品包。发布后邮件发送安全领取链接，账号和密钥不进入邮件正文；通知发送不代表买家已领取。"
                            />
                        </h1>
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
                            <table className="admin-mobile-record-table w-full min-w-[760px] text-left text-xs">
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
                                            <td data-label="订单 / 商品" className="p-2">
                                                <strong className="block text-slate-900">
                                                    {item.productName}
                                                </strong>
                                                <span className="text-slate-500">
                                                    {item.order.code} · {item.sku}
                                                </span>
                                            </td>
                                            <td
                                                data-label="交付邮箱"
                                                data-mobile-wide
                                                className="break-all p-2"
                                            >
                                                {item.recipientEmail}
                                            </td>
                                            <td data-label="有效数量" className="p-2">
                                                可交付 {item.eligibleQuantity ?? item.quantity} 件
                                                {!editableStates.has(item.state) && (
                                                    <span className="block text-slate-500">
                                                        已发布 {item.quantity} 件
                                                    </span>
                                                )}
                                            </td>
                                            <td data-label="预计时间" data-mobile-wide className="p-2">
                                                {item.overdue ? '已超时 · ' : ''}
                                                {new Date(item.expectedAt).toLocaleString()}
                                            </td>
                                            <td data-label="状态" className="p-2">
                                                {stateLabels[item.state]}
                                            </td>
                                            <td data-label="操作" className="p-2">
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
                    <div className="mt-4 flex flex-wrap items-center justify-end gap-3 text-xs">
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

interface DeliveryEditorProps {
    id: string;
    canUpdate: boolean;
    onClose: () => void;
    onSaved: (message: string) => void;
}

export function DeliveryEditor(props: DeliveryEditorProps) {
    const { hasAnyPermission } = useAdminPermissions();
    const canReveal = hasAnyPermission(['ReadSoldAutoCards']);
    return <DeliveryEditorContent key={`${props.id}:${canReveal}`} {...props} canReveal={canReveal} />;
}

function DeliveryEditorContent({
    id,
    canUpdate,
    onClose,
    onSaved,
    canReveal,
}: DeliveryEditorProps & { canReveal: boolean }) {
    const [formState, setFormState] = useState({ dirty: false, busy: false });
    const [appendOpen, setAppendOpen] = useState(false);
    const [revealed, setRevealed] = useState<ManualDeliveryRecord | null>(null);
    const [revealError, setRevealError] = useState('');
    const activeTask = useRef(true);
    useLayoutEffect(() => {
        activeTask.current = true;
        return () => {
            activeTask.current = false;
        };
    }, []);
    const [reveal, revealState] = useMutation<{ revealMyManualDigitalDelivery: ManualDeliveryRecord }>(
        REVEAL_MANUAL_DELIVERY,
    );
    const query = useQuery<{ manualDigitalDelivery: ManualDeliveryRecord | null }>(GET_MANUAL_DELIVERY, {
        variables: { id },
    });
    const delivery =
        query.data?.manualDigitalDelivery?.id === id ? query.data.manualDigitalDelivery : undefined;
    const revealedMatches = canReveal && revealed?.id === id && revealed.updatedAt === delivery?.updatedAt;
    const contentReady = delivery?.hasContent === false || Boolean(revealedMatches);
    const canAppend = Boolean(
        delivery &&
        canUpdate &&
        retryableStates.has(delivery.state) &&
        (delivery.eligibleQuantity ?? delivery.quantity) > delivery.quantity,
    );
    const revealContent = async () => {
        if (!canReveal || revealState.loading) return;
        setRevealError('');
        try {
            const response = await reveal({ variables: { id }, fetchPolicy: 'no-cache' });
            const result = response.data?.revealMyManualDigitalDelivery;
            if (result?.id !== id || !Array.isArray(result.packages))
                throw new Error('后端未确认该订单交付内容');
            if (!activeTask.current) return;
            setRevealed(result);
            await query.refetch();
        } catch (cause) {
            if (activeTask.current) setRevealError(toUserFacingError(cause, '已有交付内容读取失败'));
        }
    };
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
                    disabled={formState.busy || revealState.loading}
                    onClick={() => {
                        if (
                            !formState.dirty ||
                            window.confirm('当前成品还有未保存的输入，确定放弃并关闭吗？')
                        ) {
                            setRevealed(null);
                            onClose();
                        }
                    }}
                    className="shrink-0 whitespace-nowrap rounded-lg border px-3 py-1.5 text-xs"
                >
                    关闭
                </AdminButton>
            </div>
            {query.error && (
                <div role="alert" className="text-xs text-rose-700">
                    {toUserFacingError(query.error, '交付详情读取失败')}
                    <AdminButton
                        type="button"
                        onClick={() => void query.refetch()}
                        className="ml-2 underline"
                    >
                        重新读取
                    </AdminButton>
                </div>
            )}
            {query.loading && !query.data && (
                <p role="status" className="text-xs text-slate-500">
                    正在读取交付详情…
                </p>
            )}
            {delivery && (
                <>
                    {canAppend && (
                        <div className="mb-4 space-y-2 rounded-lg bg-blue-50 p-3 text-xs text-blue-900">
                            <p>
                                原任务已发布 {delivery.quantity} 件，当前可交付{' '}
                                {delivery.eligibleQuantity ?? delivery.quantity}{' '}
                                件。仅追加缺少的新增成品，原已发布内容保留。
                            </p>
                            <AdminButton
                                type="button"
                                disabled={formState.busy || revealState.loading}
                                onClick={() => {
                                    if (
                                        formState.dirty &&
                                        !window.confirm(
                                            '当前还有未保存的成品输入，确定切换处理方式并放弃吗？',
                                        )
                                    )
                                        return;
                                    setAppendOpen(value => !value);
                                }}
                                className="rounded-lg border border-blue-200 px-3 py-2 font-semibold text-blue-700"
                            >
                                {appendOpen ? '返回原交付记录' : '补交新增成品'}
                            </AdminButton>
                        </div>
                    )}
                    {!appendOpen && !contentReady && (
                        <div className="mb-4 space-y-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
                            <p>
                                {delivery.hasContent === true
                                    ? '任务已有交付内容。显式查看后才可编辑或发布，避免空表覆盖原草稿。'
                                    : '无法确认任务是否已有内容，请重新读取；当前不能编辑或发布。'}
                            </p>
                            {delivery.hasContent === true && canReveal ? (
                                <AdminButton
                                    type="button"
                                    disabled={revealState.loading}
                                    onClick={() => void revealContent()}
                                    className="rounded-lg border px-3 py-2 font-semibold"
                                >
                                    {revealState.loading ? '正在读取已有内容…' : '查看已有交付内容'}
                                </AdminButton>
                            ) : (
                                <p>查看已有内容需要专用交付查看权限；仍可查看任务和通知记录。</p>
                            )}
                        </div>
                    )}
                    {!appendOpen && revealedMatches && (
                        <p className="mb-3 text-xs text-slate-600">
                            已有内容仅在当前订单页面显示。关闭或切换任务后需重新验证查看权限。
                        </p>
                    )}
                    {revealError && (
                        <p role="alert" className="mb-3 text-xs text-rose-700">
                            {revealError}
                        </p>
                    )}
                    <DeliveryForm
                        key={`${id}:${canReveal ? 'private' : 'ordinary'}:${appendOpen ? 'append' : 'original'}`}
                        delivery={
                            !appendOpen && revealedMatches && revealed
                                ? { ...delivery, packages: revealed.packages ?? [] }
                                : { ...delivery, packages: [] }
                        }
                        contentReady={appendOpen || contentReady}
                        appendOnly={appendOpen}
                        canUpdate={canUpdate}
                        onSaved={onSaved}
                        onFormStateChange={setFormState}
                    />
                </>
            )}
        </section>
    );
}

function DeliveryForm({
    delivery,
    canUpdate,
    onSaved,
    onFormStateChange,
    contentReady,
    appendOnly,
}: {
    delivery: ManualDeliveryRecord;
    canUpdate: boolean;
    onSaved: (message: string) => void;
    onFormStateChange: (state: { dirty: boolean; busy: boolean }) => void;
    contentReady: boolean;
    appendOnly: boolean;
}) {
    const eligibleQuantity = delivery.eligibleQuantity ?? delivery.quantity;
    const requiredQuantity = appendOnly
        ? Math.max(0, eligibleQuantity - delivery.quantity)
        : editableStates.has(delivery.state)
          ? eligibleQuantity
          : delivery.quantity;
    const packageLabel = appendOnly ? '新增成品包' : '成品包';
    const quantityLabel = appendOnly ? '应补交' : '应交付';
    const sourcePackages = packageDrafts(delivery, requiredQuantity, appendOnly);
    const packageDraft = useServerDraft<DeliveryPackage[]>(
        `${delivery.id}:${appendOnly ? 'append' : 'original'}`,
        JSON.stringify([
            delivery.state,
            delivery.updatedAt,
            delivery.quantity,
            eligibleQuantity,
            appendOnly ? null : delivery.packages,
        ]),
        sourcePackages,
    );
    const packages = packageDraft.draft ?? sourcePackages;
    const setPackages = (update: (current: DeliveryPackage[]) => DeliveryPackage[]) =>
        packageDraft.setDraft(current => update(current ?? sourcePackages));
    const [confirmPublish, setConfirmPublish] = useState(false);
    const [confirmRetry, setConfirmRetry] = useState(false);
    const [assetPackage, setAssetPackage] = useState<number | null>(null);
    const [assetSearch, setAssetSearch] = useState('');
    const [assetPage, setAssetPage] = useState(0);
    const [error, setError] = useState('');
    const [pasteText, setPasteText] = useState('');
    const [pastePreview, setPastePreview] = useState<ManualDeliveryPastePreview | null>(null);
    const [pasteNotice, setPasteNotice] = useState('');
    useUnsavedChangesWarning(
        Boolean(pasteText) && !packageDraft.dirty,
        '还有未应用的批量粘贴内容，确定放弃吗？',
    );
    const [saveDraft, saveState] = useMutation<{
        saveManualDigitalDeliveryDraft: { id: string; state: string };
    }>(SAVE_MANUAL_DELIVERY_DRAFT);
    const [publish, publishState] = useMutation<{
        publishManualDigitalDelivery: { id: string; state: string };
    }>(PUBLISH_MANUAL_DELIVERY);
    const [append, appendState] = useMutation<{
        appendManualDigitalDelivery: { id: string; state: string; quantity: number };
    }>(APPEND_MANUAL_DELIVERY);
    const [retry, retryState] = useMutation<{ retryManualDigitalDelivery: { id: string; state: string } }>(
        RETRY_MANUAL_DELIVERY,
    );
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
    const editable =
        canUpdate &&
        contentReady &&
        requiredQuantity > 0 &&
        (appendOnly ? retryableStates.has(delivery.state) : editableStates.has(delivery.state)) &&
        !packageDraft.sourceChanged;
    const busy = saveState.loading || publishState.loading || retryState.loading || appendState.loading;
    useEffect(() => {
        onFormStateChange({ dirty: packageDraft.dirty || Boolean(pasteText), busy });
    }, [packageDraft.dirty, pasteText, busy, onFormStateChange]);
    const setPackage = (index: number, changes: Partial<DeliveryPackage>) =>
        setPackages(current => current.map((item, i) => (i === index ? { ...item, ...changes } : item)));
    const execute = async (kind: 'draft' | 'publish' | 'retry') => {
        if (busy || packageDraft.sourceChanged || !canUpdate) return;
        if (kind !== 'retry' && !editable) return;
        if (appendOnly && kind === 'draft') return;
        setError('');
        try {
            if (kind === 'retry') {
                const response = await retry({ variables: { id: delivery.id } });
                if (!response.data?.retryManualDigitalDelivery?.id) throw new Error('后端未确认通知重试任务');
                onSaved('原交付通知已重新进入发送队列，发送结果待核实');
                return;
            }
            if (pasteText.trim()) {
                setError('批量粘贴内容尚未应用，请先校验并应用到草稿，或清空粘贴内容。');
                return;
            }
            if (
                packages.length !== requiredQuantity ||
                packages.some(
                    item =>
                        !item.account.trim() &&
                        !item.key.trim() &&
                        !item.note.trim() &&
                        item.attachmentAssetIds.length === 0 &&
                        item.otherFields.length === 0,
                )
            ) {
                setError(
                    `必须填写 ${requiredQuantity} 个非空${appendOnly ? '新增' : ''}成品包，每件至少填写账号、密钥、说明或附件。`,
                );
                return;
            }
            const variables = { input: deliveryInput(delivery.id, packages) };
            if (kind === 'draft') {
                const response = await saveDraft({ variables });
                if (!response.data?.saveManualDigitalDeliveryDraft?.id)
                    throw new Error('后端未确认交付草稿保存');
                packageDraft.accept(packages);
                onSaved('人工交付草稿已保存');
            } else if (appendOnly) {
                const response = await append({ variables });
                const result = response.data?.appendManualDigitalDelivery;
                if (result?.id !== delivery.id || result.quantity !== delivery.quantity + packages.length)
                    throw new Error('后端未确认补交后的成品数量；新增草稿已保留，请核实原任务。');
                packageDraft.accept([]);
                setPasteText('');
                setPastePreview(null);
                onSaved(
                    `新增 ${packages.length} 件成品已补交，原成品保留；安全领取通知已进入队列，发送与领取结果待核实`,
                );
            } else {
                const response = await publish({ variables });
                if (!response.data?.publishManualDigitalDelivery?.id) throw new Error('后端未确认交付发布');
                packageDraft.accept(packages);
                onSaved('成品已发布，领取通知已进入发送队列；通知与领取结果待核实');
            }
        } catch (cause) {
            setError(toUserFacingError(cause, '交付操作失败'));
        }
    };

    return (
        <div className="space-y-4 text-xs">
            {packageDraft.sourceChanged && <DraftUpdateNotice onReload={packageDraft.reload} />}
            <div className="rounded-lg bg-slate-50 p-3 text-slate-700">
                安全领取通知邮箱：<strong>{delivery.recipientEmail}</strong> · {quantityLabel}{' '}
                {requiredQuantity} 件 · 预计 {new Date(delivery.expectedAt).toLocaleString()}
                <p className="mt-1">邮件仅发送安全领取链接；通知发送与客户领取分别记录。</p>
                {appendOnly && (
                    <p className="mt-1 font-semibold">
                        本区仅填写新增成品；草稿仅保留在本页，确认补交前尚未写入服务器。
                    </p>
                )}
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
            {editable && (
                <fieldset
                    disabled={busy}
                    className="min-w-0 space-y-3 rounded-lg border border-slate-200 p-3"
                >
                    <legend className="px-1 font-semibold text-slate-800">批量粘贴成品</legend>
                    <p className="leading-relaxed text-slate-600">
                        固定三列 TSV：账号 → Tab → 密钥/密码 → Tab → 说明，每行一件，不含表头。 空列请保留
                        Tab；空行会跳过。说明中的额外 Tab、逗号和竖线原样保留，说明不能跨行。 {quantityLabel}{' '}
                        {requiredQuantity} 件。应用只替换本区账号、密钥和说明，保留本区现有附件及其他字段。
                    </p>
                    <AdminTextArea
                        aria-label="批量成品 TSV"
                        autoComplete="off"
                        spellCheck={false}
                        rows={4}
                        value={pasteText}
                        onChange={event => {
                            setPasteText(event.target.value);
                            setPastePreview(null);
                            setPasteNotice('');
                        }}
                        placeholder="从表格复制三列：账号、密钥/密码、说明"
                        className="w-full min-w-0 rounded-lg border border-slate-300 px-3 py-2"
                    />
                    <div className="flex flex-wrap gap-2">
                        <AdminButton
                            type="button"
                            disabled={!pasteText.trim()}
                            onClick={() => {
                                setPastePreview(parseManualDeliveryPaste(pasteText, requiredQuantity));
                                setPasteNotice('');
                            }}
                            className="rounded-lg border px-3 py-2 font-semibold"
                        >
                            校验并预览
                        </AdminButton>
                        <AdminButton
                            type="button"
                            disabled={!pasteText}
                            onClick={() => {
                                setPasteText('');
                                setPastePreview(null);
                                setPasteNotice('');
                            }}
                            className="rounded-lg border px-3 py-2"
                        >
                            清空粘贴
                        </AdminButton>
                    </div>
                    {pastePreview && (
                        <section aria-label="批量成品预览" className="space-y-2">
                            <p role="status" className="font-semibold text-slate-800">
                                识别 {pastePreview.rows.length} 件 / {quantityLabel} {requiredQuantity} 件 ·
                                已跳过空行 {pastePreview.ignoredEmptyLines} 行
                            </p>
                            {pastePreview.errors.map(message => (
                                <p key={message} role="alert" className="text-rose-700">
                                    {message}
                                </p>
                            ))}
                            <ol className="space-y-2">
                                {pastePreview.rows.map((row, index) => (
                                    <li
                                        key={index}
                                        className="break-all rounded-lg bg-slate-50 p-2 text-slate-700"
                                    >
                                        <p>
                                            成品 {index + 1} · 账号：{row.account || '未填写'} · 密钥/密码：
                                            {row.key ? '••••••（已遮盖）' : '未填写'}
                                        </p>
                                        <p className="whitespace-pre-wrap">说明：{row.note || '未填写'}</p>
                                    </li>
                                ))}
                            </ol>
                            <AdminButton
                                type="button"
                                disabled={pastePreview.errors.length > 0}
                                onClick={() => {
                                    if (!editable || busy || pastePreview.errors.length > 0) return;
                                    const currentPreview = parseManualDeliveryPaste(
                                        pasteText,
                                        requiredQuantity,
                                    );
                                    if (currentPreview.errors.length > 0) {
                                        setPastePreview(currentPreview);
                                        return;
                                    }
                                    setPackages(current =>
                                        current.map((item, index) => ({
                                            ...item,
                                            ...currentPreview.rows[index],
                                        })),
                                    );
                                    setPasteText('');
                                    setPastePreview(null);
                                    setPasteNotice(
                                        `已应用 ${requiredQuantity} 件到${appendOnly ? '本页新增' : ''}草稿；尚未保存或发布。`,
                                    );
                                    setConfirmPublish(false);
                                    setError('');
                                }}
                                className="rounded-lg border border-blue-300 px-3 py-2 font-semibold text-blue-700"
                            >
                                应用到草稿
                            </AdminButton>
                        </section>
                    )}
                    {pasteNotice && (
                        <p role="status" className="text-emerald-800">
                            {pasteNotice}
                        </p>
                    )}
                </fieldset>
            )}
            {contentReady &&
                packages.map((item, index) => (
                    <fieldset
                        key={index}
                        disabled={!editable || busy}
                        className="space-y-3 rounded-lg border border-slate-200 p-3"
                    >
                        <legend className="px-1 font-semibold text-slate-800">
                            {packageLabel} {index + 1}
                        </legend>
                        <div className="grid gap-3 sm:grid-cols-2">
                            <AdminField
                                className="space-y-1"
                                label={
                                    <>
                                        <span>账号（可选）</span>
                                    </>
                                }
                            >
                                {' '}
                                <AdminInput
                                    aria-label={`${packageLabel} ${index + 1} 账号`}
                                    value={item.account}
                                    onChange={event => setPackage(index, { account: event.target.value })}
                                    className="w-full rounded-lg border border-slate-300 px-3 py-2"
                                />
                            </AdminField>
                            <AdminField
                                className="space-y-1"
                                label={
                                    <>
                                        <span>密钥 / 密码（可选）</span>
                                    </>
                                }
                            >
                                {' '}
                                <AdminInput
                                    aria-label={`${packageLabel} ${index + 1} 密钥`}
                                    type="password"
                                    autoComplete="off"
                                    value={item.key}
                                    onChange={event => setPackage(index, { key: event.target.value })}
                                    className="w-full rounded-lg border border-slate-300 px-3 py-2"
                                />
                            </AdminField>
                        </div>
                        <AdminField
                            className="block space-y-1"
                            label={
                                <>
                                    <span>交付说明</span>
                                </>
                            }
                        >
                            {' '}
                            <AdminTextArea
                                aria-label={`${packageLabel} ${index + 1} 交付说明`}
                                value={item.note}
                                onChange={event => setPackage(index, { note: event.target.value })}
                                rows={3}
                                className="w-full rounded-lg border border-slate-300 px-3 py-2"
                            />
                        </AdminField>
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
                        <AdminButton
                            type="button"
                            onClick={() => setAssetPackage(null)}
                            className="shrink-0 whitespace-nowrap"
                        >
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
                    {!appendOnly && (
                        <AdminButton
                            type="button"
                            disabled={busy}
                            onClick={() => void execute('draft')}
                            className="rounded-lg border border-slate-300 px-3 py-2 font-semibold"
                        >
                            保存草稿
                        </AdminButton>
                    )}
                    {confirmPublish ? (
                        <>
                            <span>
                                {appendOnly
                                    ? '请核对本次新增成品，只追加新增内容，原已发布成品保留。'
                                    : '请核对通知邮箱及全部成品包，发布后不可覆盖原成品。'}
                                邮件仅含安全领取链接；通知发送不代表买家已领取。
                            </span>
                            <AdminButton
                                type="button"
                                disabled={busy}
                                onClick={() => void execute('publish')}
                                className="rounded-lg bg-blue-700 px-3 py-2 font-semibold text-white"
                            >
                                {appendOnly ? '补交并发送通知' : '发布并通知买家'}
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
                            {appendOnly ? '确认补交内容' : '发布交付'}
                        </AdminButton>
                    )}
                </div>
            )}
            {!appendOnly &&
                canUpdate &&
                (delivery.eligibleQuantity ?? delivery.quantity) <= delivery.quantity &&
                retryableStates.has(delivery.state) && (
                    <div className="flex flex-wrap items-center gap-2">
                        {confirmRetry ? (
                            <>
                                <span>
                                    重发原成品的安全领取通知，沿用原交付内容；不会分配新卡，通知发送不代表买家已领取。
                                </span>
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
                                重发交付通知
                            </AdminButton>
                        )}
                    </div>
                )}
        </div>
    );
}
