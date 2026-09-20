import { useApolloClient, useMutation, useQuery } from '@apollo/client/react';
import type { DocumentNode } from 'graphql';
import { AlertTriangle, ClipboardCheck, Plus, RefreshCw, X } from 'lucide-react';
import { useMemo, useState } from 'react';

import { AccessibleDialogSurface } from '../../components/AccessibleDialogSurface';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import {
    CANCEL_CATALOG_PURCHASE_ORDER_MUTATION,
    CATALOG_PURCHASE_CONTEXT_QUERY,
    CATALOG_PURCHASE_ORDER_QUERY,
    CATALOG_PURCHASE_ORDERS_QUERY,
    CATALOG_SUPPLIERS_QUERY,
    CLOSE_CATALOG_PURCHASE_ORDER_MUTATION,
    CREATE_CATALOG_PURCHASE_ORDER_MUTATION,
    DISPUTE_CATALOG_PURCHASE_PAYMENT_MUTATION,
    RECEIVE_CATALOG_PURCHASE_ORDER_MUTATION,
    RECORD_CATALOG_PURCHASE_PAYMENT_MUTATION,
    RETURN_CATALOG_PURCHASE_ORDER_MUTATION,
    SUBMIT_CATALOG_PURCHASE_ORDER_MUTATION,
    type CatalogPurchaseOrderRecord,
    type CatalogPurchaseOrderStatus,
    type CatalogSupplierRecord,
} from '../../graphql/catalog-operations.graphql';
import { toUserFacingError } from '../../utils/user-facing-error';

const PAGE_SIZE = 50;
const statusLabel: Record<CatalogPurchaseOrderStatus, string> = {
    DRAFT: '草稿',
    SUBMITTED: '已提交',
    PARTIALLY_RECEIVED: '部分收货',
    RECEIVED: '已收货',
    VARIANCE_REVIEW: '待处理差异',
    CLOSED: '已结案',
    CANCELLED: '已取消',
};
type ActionMode = 'RECEIVE' | 'RETURN' | 'PAY' | 'CLOSE' | 'CANCEL' | 'DISPUTE' | null;

interface PurchaseContext {
    activeChannel: { id: string; defaultCurrencyCode: string };
    stockLocations: { items: Array<{ id: string; name: string }> };
    productVariants: {
        items: Array<{ id: string; name: string; sku: string; customFields?: Record<string, unknown> }>;
    };
}

interface OrderDraft {
    supplierId: string;
    stockLocationId: string;
    expectedAt: string;
    notes: string;
    lines: Array<{ variantId: string; quantity: string; unitCost: string }>;
}

export function PurchaseOrdersModule() {
    const [text, setText] = useState('');
    const [status, setStatus] = useState<CatalogPurchaseOrderStatus | 'ALL'>('ALL');
    const [exceptionsOnly, setExceptionsOnly] = useState(false);
    const [page, setPage] = useState(0);
    const [createOpen, setCreateOpen] = useState(false);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const query = useQuery<{
        catalogPurchaseOrders: { items: CatalogPurchaseOrderRecord[]; totalItems: number };
    }>(CATALOG_PURCHASE_ORDERS_QUERY, {
        variables: {
            options: {
                skip: page * PAGE_SIZE,
                take: PAGE_SIZE,
                text: text.trim() || null,
                status: status === 'ALL' ? null : status,
                exceptionsOnly,
            },
        },
        fetchPolicy: 'cache-and-network',
    });
    const result = query.data?.catalogPurchaseOrders;
    const totalPages = Math.max(1, Math.ceil((result?.totalItems ?? 0) / PAGE_SIZE));
    return (
        <div className="flex h-full flex-col bg-slate-50">
            <header className="shrink-0 border-b border-slate-200 bg-white px-5 py-4 sm:px-8">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
                            <ClipboardCheck className="h-5 w-5 text-blue-600" /> 采购与收货
                            <FeatureHelpButton topic="catalog.suppliers" title="采购与收货" />
                        </h1>
                        <p className="mt-1 text-xs text-slate-500">
                            采购、分批收货、退供、应付和差异处理共用一条审计链。
                        </p>
                    </div>
                    <div className="flex gap-2">
                        <button
                            type="button"
                            aria-label="刷新采购单"
                            onClick={() => void query.refetch()}
                            className="rounded-lg border border-slate-300 bg-white p-2 text-slate-600"
                        >
                            <RefreshCw className={`h-4 w-4 ${query.loading ? 'animate-spin' : ''}`} />
                        </button>
                        <button
                            type="button"
                            onClick={() => setCreateOpen(true)}
                            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white"
                        >
                            <Plus className="h-4 w-4" /> 新建采购单
                        </button>
                    </div>
                </div>
            </header>
            <main className="flex-1 space-y-4 overflow-auto p-5 sm:p-8">
                <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 lg:flex-row">
                    <input
                        value={text}
                        onChange={event => {
                            setText(event.target.value);
                            setPage(0);
                        }}
                        placeholder="搜索采购单号或供货商"
                        className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    />
                    <select
                        value={status}
                        onChange={event => {
                            setStatus(event.target.value as typeof status);
                            setPage(0);
                        }}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                    >
                        <option value="ALL">全部状态</option>
                        {Object.entries(statusLabel).map(([value, label]) => (
                            <option key={value} value={value}>
                                {label}
                            </option>
                        ))}
                    </select>
                    <label className="flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold">
                        <input
                            type="checkbox"
                            checked={exceptionsOnly}
                            onChange={event => {
                                setExceptionsOnly(event.target.checked);
                                setPage(0);
                            }}
                        />
                        只看异常队列
                    </label>
                </div>
                <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                    {query.loading && !query.data ? (
                        <State label="正在读取采购单…" />
                    ) : query.error ? (
                        <State label="采购单加载失败" tone="error" />
                    ) : !result?.items.length ? (
                        <State label="当前筛选下没有采购单" />
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[900px] text-left text-xs">
                                <thead className="bg-slate-50 text-slate-500">
                                    <tr>
                                        {['采购单', '供货商', '状态', '收货进度', '待付', '预计到货'].map(
                                            label => (
                                                <th key={label} className="px-4 py-3 font-bold">
                                                    {label}
                                                </th>
                                            ),
                                        )}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {result.items.map(order => (
                                        <tr
                                            key={order.id}
                                            onClick={() => setSelectedId(order.id)}
                                            className="cursor-pointer hover:bg-slate-50"
                                        >
                                            <td className="px-4 py-3 font-mono font-bold text-blue-700">
                                                {order.code}
                                            </td>
                                            <td className="px-4 py-3">{order.supplier.name}</td>
                                            <td className="px-4 py-3">
                                                <Status order={order} />
                                            </td>
                                            <td className="px-4 py-3">
                                                {sum(order.lines.map(line => line.receivedQuantity))} /{' '}
                                                {sum(order.lines.map(line => line.orderedQuantity))}
                                            </td>
                                            <td className="px-4 py-3">
                                                {money(order.outstandingMicrounits, order.currencyCode)}
                                            </td>
                                            <td className="px-4 py-3">{dateOnly(order.expectedAt)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                    <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
                        <span>共 {result?.totalItems ?? 0} 张</span>
                        <div className="flex gap-2">
                            <button
                                type="button"
                                disabled={page === 0}
                                onClick={() => setPage(value => value - 1)}
                                className="rounded border px-3 py-1.5 disabled:opacity-30"
                            >
                                上一页
                            </button>
                            <span className="px-2 py-1.5">
                                {page + 1} / {totalPages}
                            </span>
                            <button
                                type="button"
                                disabled={page + 1 >= totalPages}
                                onClick={() => setPage(value => value + 1)}
                                className="rounded border px-3 py-1.5 disabled:opacity-30"
                            >
                                下一页
                            </button>
                        </div>
                    </div>
                </section>
            </main>
            {createOpen && (
                <CreateOrderDialog
                    onClose={() => setCreateOpen(false)}
                    onSaved={async id => {
                        setCreateOpen(false);
                        await query.refetch();
                        setSelectedId(id);
                    }}
                />
            )}
            {selectedId && (
                <OrderDetailDialog
                    id={selectedId}
                    onClose={() => setSelectedId(null)}
                    onChanged={() => query.refetch()}
                />
            )}
        </div>
    );
}

function CreateOrderDialog({ onClose, onSaved }: { onClose: () => void; onSaved: (id: string) => void }) {
    const [draft, setDraft] = useState<OrderDraft>(() => emptyDraft());
    const [error, setError] = useState('');
    const suppliers = useQuery<{ catalogSuppliers: { items: CatalogSupplierRecord[] } }>(
        CATALOG_SUPPLIERS_QUERY,
        { variables: { options: { take: 200, enabled: true } } },
    );
    const context = useQuery<PurchaseContext>(CATALOG_PURCHASE_CONTEXT_QUERY);
    const [create, createState] = useMutation<{
        createCatalogPurchaseOrder: CatalogPurchaseOrderRecord;
    }>(CREATE_CATALOG_PURCHASE_ORDER_MUTATION);
    const valid = Boolean(
        draft.supplierId &&
        draft.stockLocationId &&
        draft.lines.length &&
        draft.lines.every(
            line => line.variantId && positiveInteger(line.quantity) && nonNegative(line.unitCost),
        ),
    );
    const save = async () => {
        if (!valid || !context.data) return;
        setError('');
        try {
            const result = await create({
                variables: {
                    input: {
                        supplierId: draft.supplierId,
                        stockLocationId: draft.stockLocationId,
                        currencyCode: context.data.activeChannel.defaultCurrencyCode,
                        expectedAt: draft.expectedAt
                            ? new Date(`${draft.expectedAt}T12:00:00`).toISOString()
                            : null,
                        notes: draft.notes,
                        lines: draft.lines.map(line => ({
                            productVariantId: line.variantId,
                            orderedQuantity: Number(line.quantity),
                            unitCostMicrounits: Math.round(Number(line.unitCost) * 1_000),
                        })),
                    },
                },
            });
            if (result.data?.createCatalogPurchaseOrder.id)
                onSaved(result.data.createCatalogPurchaseOrder.id);
        } catch (cause) {
            setError(toUserFacingError(cause, '采购单创建失败'));
        }
    };
    const variants = context.data?.productVariants.items ?? [];
    return (
        <Modal title="新建采购单" onClose={onClose} wide>
            <div className="grid gap-4 sm:grid-cols-2">
                <SelectField
                    label="供货商"
                    value={draft.supplierId}
                    onChange={supplierId => setDraft({ ...draft, supplierId })}
                    options={(suppliers.data?.catalogSuppliers.items ?? []).map(item => ({
                        value: item.id,
                        label: `${item.name} · ${item.code}`,
                    }))}
                />
                <SelectField
                    label="收货仓库"
                    value={draft.stockLocationId}
                    onChange={stockLocationId => setDraft({ ...draft, stockLocationId })}
                    options={(context.data?.stockLocations.items ?? []).map(item => ({
                        value: item.id,
                        label: item.name,
                    }))}
                />
                <Field label="预计到货日">
                    <input
                        type="date"
                        value={draft.expectedAt}
                        onChange={event => setDraft({ ...draft, expectedAt: event.target.value })}
                        className={inputClass}
                    />
                </Field>
                <Field label="内部备注">
                    <input
                        value={draft.notes}
                        onChange={event => setDraft({ ...draft, notes: event.target.value })}
                        className={inputClass}
                    />
                </Field>
            </div>
            <div className="mt-4 space-y-3">
                <div className="flex items-center justify-between text-xs font-bold text-slate-700">
                    <span>SKU 明细</span>
                    <button
                        type="button"
                        onClick={() =>
                            setDraft({
                                ...draft,
                                lines: [...draft.lines, { variantId: '', quantity: '1', unitCost: '0' }],
                            })
                        }
                        className="text-blue-700"
                    >
                        + 添加 SKU
                    </button>
                </div>
                {draft.lines.map((line, index) => (
                    <div
                        key={index}
                        className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_110px_130px_32px]"
                    >
                        <select
                            value={line.variantId}
                            onChange={event =>
                                setDraft({
                                    ...draft,
                                    lines: replaceAt(draft.lines, index, {
                                        ...line,
                                        variantId: event.target.value,
                                    }),
                                })
                            }
                            className={inputClass}
                        >
                            <option value="">选择 SKU</option>
                            {variants
                                .filter(
                                    item =>
                                        item.id === line.variantId ||
                                        !draft.lines.some(
                                            (candidate, candidateIndex) =>
                                                candidateIndex !== index && candidate.variantId === item.id,
                                        ),
                                )
                                .map(item => (
                                    <option key={item.id} value={item.id}>
                                        {item.name} · {item.sku}
                                    </option>
                                ))}
                        </select>
                        <input
                            type="number"
                            min="1"
                            value={line.quantity}
                            aria-label="采购数量"
                            onChange={event =>
                                setDraft({
                                    ...draft,
                                    lines: replaceAt(draft.lines, index, {
                                        ...line,
                                        quantity: event.target.value,
                                    }),
                                })
                            }
                            className={inputClass}
                        />
                        <input
                            type="number"
                            min="0"
                            step="0.001"
                            value={line.unitCost}
                            aria-label="采购单价"
                            onChange={event =>
                                setDraft({
                                    ...draft,
                                    lines: replaceAt(draft.lines, index, {
                                        ...line,
                                        unitCost: event.target.value,
                                    }),
                                })
                            }
                            className={inputClass}
                        />
                        <button
                            type="button"
                            aria-label="删除 SKU"
                            onClick={() =>
                                setDraft({ ...draft, lines: draft.lines.filter((_, i) => i !== index) })
                            }
                        >
                            <X className="h-4 w-4" />
                        </button>
                    </div>
                ))}
            </div>
            <ModalFooter
                error={error}
                pending={createState.loading}
                valid={valid}
                onClose={onClose}
                onSubmit={() => void save()}
                label="保存草稿"
            />
        </Modal>
    );
}

function OrderDetailDialog({
    id,
    onClose,
    onChanged,
}: {
    id: string;
    onClose: () => void;
    onChanged: () => unknown;
}) {
    const [mode, setMode] = useState<ActionMode>(null);
    const [error, setError] = useState('');
    const [pending, setPending] = useState(false);
    const client = useApolloClient();
    const detail = useQuery<{ catalogPurchaseOrder: CatalogPurchaseOrderRecord }>(
        CATALOG_PURCHASE_ORDER_QUERY,
        { variables: { id }, fetchPolicy: 'network-only' },
    );
    const order = detail.data?.catalogPurchaseOrder;
    const execute = async (mutation: DocumentNode, variables: Record<string, unknown>) => {
        setError('');
        setPending(true);
        try {
            await client.mutate({ mutation, variables });
            setMode(null);
            await detail.refetch();
            await onChanged();
        } catch (cause) {
            setError(toUserFacingError(cause, '采购单操作失败'));
        } finally {
            setPending(false);
        }
    };
    return (
        <Modal title={order?.code ?? '采购单'} onClose={onClose} wide>
            {!order ? (
                <State label="正在读取采购单…" />
            ) : (
                <div className="space-y-5">
                    <div className="flex flex-wrap items-center gap-2">
                        <Status order={order} />
                        <Badge label={paymentLabel(order.paymentStatus)} />
                        {order.overdue && <Badge label="逾期未收齐" danger />}
                    </div>
                    <div className="grid gap-3 rounded-xl border bg-slate-50 p-4 text-xs sm:grid-cols-4">
                        <Metric label="采购总额" value={money(order.totalMicrounits, order.currencyCode)} />
                        <Metric
                            label="退供贷项"
                            value={money(order.returnCreditMicrounits, order.currencyCode)}
                        />
                        <Metric label="已付" value={money(order.paidMicrounits, order.currencyCode)} />
                        <Metric label="待付" value={money(order.outstandingMicrounits, order.currencyCode)} />
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {order.status === 'DRAFT' && (
                            <ActionButton
                                label="提交采购单"
                                onClick={() =>
                                    void execute(SUBMIT_CATALOG_PURCHASE_ORDER_MUTATION, { id: order.id })
                                }
                            />
                        )}
                        {['SUBMITTED', 'PARTIALLY_RECEIVED'].includes(order.status) && (
                            <ActionButton label="登记收货" onClick={() => setMode('RECEIVE')} />
                        )}
                        {order.lines.some(
                            line => line.returnableQuantity > 0 && line.returnableLots.length,
                        ) && <ActionButton label="登记退供" onClick={() => setMode('RETURN')} secondary />}
                        {['RECEIVED', 'VARIANCE_REVIEW'].includes(order.status) && (
                            <ActionButton label="结案" onClick={() => setMode('CLOSE')} />
                        )}
                        {!['DRAFT', 'CANCELLED'].includes(order.status) &&
                            order.outstandingMicrounits > 0 && (
                                <ActionButton label="记录付款" onClick={() => setMode('PAY')} secondary />
                            )}
                        {!['DRAFT', 'CANCELLED'].includes(order.status) && (
                            <ActionButton label="付款争议" onClick={() => setMode('DISPUTE')} secondary />
                        )}
                        {['DRAFT', 'SUBMITTED'].includes(order.status) && (
                            <ActionButton label="取消采购单" onClick={() => setMode('CANCEL')} danger />
                        )}
                    </div>
                    {error && <Notice message={error} />}
                    <div className="overflow-x-auto rounded-xl border">
                        <table className="w-full min-w-[720px] text-left text-xs">
                            <thead className="bg-slate-50">
                                <tr>
                                    {['SKU', '订购', '到货', '合格', '不合格', '待收'].map(label => (
                                        <th key={label} className="px-3 py-2">
                                            {label}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {order.lines.map(line => (
                                    <tr key={line.id} className="border-t">
                                        <td className="px-3 py-2">
                                            <strong>{line.variant.name}</strong>
                                            <small className="ml-2 font-mono">{line.variant.sku}</small>
                                        </td>
                                        <td className="px-3 py-2">{line.orderedQuantity}</td>
                                        <td className="px-3 py-2">{line.receivedQuantity}</td>
                                        <td className="px-3 py-2">{line.acceptedQuantity}</td>
                                        <td className="px-3 py-2 text-rose-700">{line.rejectedQuantity}</td>
                                        <td className="px-3 py-2">{line.outstandingQuantity}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <div className="space-y-2">
                        <h3 className="flex items-center gap-2 text-sm font-bold">
                            审计记录
                            <FeatureHelpButton topic="catalog.suppliers" title="采购审计记录" />
                        </h3>
                        {order.events.map(event => (
                            <div
                                key={event.id}
                                className="flex justify-between gap-3 rounded-lg border p-3 text-xs"
                            >
                                <span>{event.summary}</span>
                                <span className="shrink-0 text-slate-400">{dateTime(event.createdAt)}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
            {order && mode && (
                <OrderActionDialog
                    order={order}
                    mode={mode}
                    pending={pending}
                    onClose={() => setMode(null)}
                    onSubmit={(mutation, variables) => void execute(mutation, variables)}
                />
            )}
        </Modal>
    );
}

function OrderActionDialog({
    order,
    mode,
    pending,
    onClose,
    onSubmit,
}: {
    order: CatalogPurchaseOrderRecord;
    mode: Exclude<ActionMode, null>;
    pending: boolean;
    onClose: () => void;
    onSubmit: (mutation: DocumentNode, variables: Record<string, unknown>) => void;
}) {
    const receivable = useMemo(() => order.lines.filter(line => line.outstandingQuantity > 0), [order.lines]);
    const [note, setNote] = useState('');
    const [reference, setReference] = useState('');
    const [amount, setAmount] = useState('');
    const [receiptReference, setReceiptReference] = useState('');
    const [supplierAcknowledgement, setSupplierAcknowledgement] = useState('');
    const [receiptLines, setReceiptLines] = useState(() =>
        receivable.map(line => ({
            id: line.id,
            received: String(line.outstandingQuantity),
            accepted: String(line.outstandingQuantity),
            rejected: '0',
            lotCode: `${order.code}-${line.variant.sku}-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`,
            rejectionReason: '',
        })),
    );
    const [returnLines, setReturnLines] = useState(() =>
        order.lines
            .filter(line => line.returnableQuantity > 0 && line.returnableLots.length)
            .map(line => ({
                id: line.id,
                inventoryLotId: line.returnableLots[0].id,
                quantity: '0',
                reason: '',
            })),
    );
    const valid =
        mode === 'RECEIVE'
            ? receiptLines.some(line => Number(line.received) > 0) &&
              receiptLines.every(
                  line =>
                      Number(line.received) === Number(line.accepted) + Number(line.rejected) &&
                      (Number(line.accepted) === 0 || line.lotCode.trim()) &&
                      (Number(line.rejected) === 0 || line.rejectionReason.trim()),
              )
            : mode === 'RETURN'
              ? Boolean(supplierAcknowledgement.trim()) &&
                returnLines.some(line => Number(line.quantity) > 0) &&
                returnLines
                    .filter(line => Number(line.quantity) > 0)
                    .every(line => line.inventoryLotId && line.reason.trim())
              : mode === 'PAY'
                ? Number(amount) > 0 &&
                  Number(amount) * 1_000 <= order.outstandingMicrounits &&
                  Boolean(reference.trim())
                : mode === 'CLOSE'
                  ? order.status !== 'VARIANCE_REVIEW' || Boolean(note.trim())
                  : Boolean(note.trim());
    const submit = () => {
        if (mode === 'RECEIVE')
            onSubmit(RECEIVE_CATALOG_PURCHASE_ORDER_MUTATION, {
                input: {
                    purchaseOrderId: order.id,
                    idempotencyKey: crypto.randomUUID(),
                    supplierDeliveryReference: receiptReference || null,
                    notes: note,
                    lines: receiptLines
                        .filter(line => Number(line.received) > 0)
                        .map(line => ({
                            purchaseOrderLineId: line.id,
                            receivedQuantity: Number(line.received),
                            acceptedQuantity: Number(line.accepted),
                            rejectedQuantity: Number(line.rejected),
                            lotCode: line.lotCode || null,
                            rejectionReason: line.rejectionReason || null,
                        })),
                },
            });
        if (mode === 'RETURN')
            onSubmit(RETURN_CATALOG_PURCHASE_ORDER_MUTATION, {
                input: {
                    purchaseOrderId: order.id,
                    idempotencyKey: crypto.randomUUID(),
                    supplierAcknowledgementReference: supplierAcknowledgement,
                    notes: note,
                    lines: returnLines
                        .filter(line => Number(line.quantity) > 0)
                        .map(line => ({
                            purchaseOrderLineId: line.id,
                            inventoryLotId: line.inventoryLotId,
                            quantity: Number(line.quantity),
                            reason: line.reason,
                        })),
                },
            });
        if (mode === 'PAY')
            onSubmit(RECORD_CATALOG_PURCHASE_PAYMENT_MUTATION, {
                input: {
                    purchaseOrderId: order.id,
                    amountMicrounits: Math.round(Number(amount) * 1_000),
                    reference,
                    note,
                },
            });
        if (mode === 'CLOSE') onSubmit(CLOSE_CATALOG_PURCHASE_ORDER_MUTATION, { id: order.id, note });
        if (mode === 'CANCEL') onSubmit(CANCEL_CATALOG_PURCHASE_ORDER_MUTATION, { id: order.id, note });
        if (mode === 'DISPUTE') onSubmit(DISPUTE_CATALOG_PURCHASE_PAYMENT_MUTATION, { id: order.id, note });
    };
    return (
        <Modal title={modeTitle(mode)} onClose={onClose} nested wide>
            <div className="space-y-4">
                {mode === 'RECEIVE' && (
                    <>
                        <Field label="供货商送货单号">
                            <input
                                value={receiptReference}
                                onChange={event => setReceiptReference(event.target.value)}
                                className={inputClass}
                            />
                        </Field>
                        {receiptLines.map((line, index) => {
                            const source = order.lines.find(item => item.id === line.id);
                            return (
                                <div key={line.id} className="space-y-2 rounded-lg border p-3">
                                    <strong className="text-xs">
                                        {source?.variant.name} · {source?.variant.sku}
                                    </strong>
                                    <div className="grid gap-2 sm:grid-cols-3">
                                        {(['received', 'accepted', 'rejected'] as const).map(field => (
                                            <Field
                                                key={field}
                                                label={
                                                    {
                                                        received: '到货',
                                                        accepted: '合格',
                                                        rejected: '不合格',
                                                    }[field]
                                                }
                                            >
                                                <input
                                                    type="number"
                                                    min="0"
                                                    value={line[field]}
                                                    onChange={event =>
                                                        setReceiptLines(
                                                            replaceAt(receiptLines, index, {
                                                                ...line,
                                                                [field]: event.target.value,
                                                            }),
                                                        )
                                                    }
                                                    className={inputClass}
                                                />
                                            </Field>
                                        ))}
                                    </div>
                                    <Field label="批次号">
                                        <input
                                            value={line.lotCode}
                                            onChange={event =>
                                                setReceiptLines(
                                                    replaceAt(receiptLines, index, {
                                                        ...line,
                                                        lotCode: event.target.value,
                                                    }),
                                                )
                                            }
                                            className={inputClass}
                                        />
                                    </Field>
                                    {Number(line.rejected) > 0 && (
                                        <Field label="不合格原因">
                                            <input
                                                value={line.rejectionReason}
                                                onChange={event =>
                                                    setReceiptLines(
                                                        replaceAt(receiptLines, index, {
                                                            ...line,
                                                            rejectionReason: event.target.value,
                                                        }),
                                                    )
                                                }
                                                className={inputClass}
                                            />
                                        </Field>
                                    )}
                                </div>
                            );
                        })}
                    </>
                )}
                {mode === 'RETURN' && (
                    <>
                        <Field label="供货商确认编号">
                            <input
                                value={supplierAcknowledgement}
                                onChange={event => setSupplierAcknowledgement(event.target.value)}
                                className={inputClass}
                            />
                        </Field>
                        {returnLines.map((line, index) => {
                            const source = order.lines.find(item => item.id === line.id);
                            return (
                                <div
                                    key={line.id}
                                    className="grid gap-2 rounded-lg border p-3 sm:grid-cols-3"
                                >
                                    <SelectField
                                        label={source?.variant.sku ?? 'SKU'}
                                        value={line.inventoryLotId}
                                        onChange={inventoryLotId =>
                                            setReturnLines(
                                                replaceAt(returnLines, index, { ...line, inventoryLotId }),
                                            )
                                        }
                                        options={(source?.returnableLots ?? []).map(lot => ({
                                            value: lot.id,
                                            label: `${lot.lotCode} · ${lot.quantityOnHand}`,
                                        }))}
                                    />
                                    <Field label="数量">
                                        <input
                                            type="number"
                                            min="0"
                                            value={line.quantity}
                                            onChange={event =>
                                                setReturnLines(
                                                    replaceAt(returnLines, index, {
                                                        ...line,
                                                        quantity: event.target.value,
                                                    }),
                                                )
                                            }
                                            className={inputClass}
                                        />
                                    </Field>
                                    <Field label="原因">
                                        <input
                                            value={line.reason}
                                            onChange={event =>
                                                setReturnLines(
                                                    replaceAt(returnLines, index, {
                                                        ...line,
                                                        reason: event.target.value,
                                                    }),
                                                )
                                            }
                                            className={inputClass}
                                        />
                                    </Field>
                                </div>
                            );
                        })}
                    </>
                )}
                {mode === 'PAY' && (
                    <>
                        <Field label="付款金额">
                            <input
                                type="number"
                                min="0"
                                step="0.001"
                                value={amount}
                                onChange={event => setAmount(event.target.value)}
                                className={inputClass}
                            />
                        </Field>
                        <Field label="付款凭证号">
                            <input
                                value={reference}
                                onChange={event => setReference(event.target.value)}
                                className={inputClass}
                            />
                        </Field>
                    </>
                )}
                <Field label={mode === 'RECEIVE' || mode === 'RETURN' || mode === 'PAY' ? '备注' : '原因'}>
                    <textarea
                        value={note}
                        onChange={event => setNote(event.target.value)}
                        className={`${inputClass} min-h-20`}
                    />
                </Field>
            </div>
            <ModalFooter
                pending={pending}
                valid={Boolean(valid)}
                onClose={onClose}
                onSubmit={submit}
                label="确认操作"
            />
        </Modal>
    );
}

function Modal({
    title,
    onClose,
    wide,
    nested,
    children,
}: {
    title: string;
    onClose: () => void;
    wide?: boolean;
    nested?: boolean;
    children: React.ReactNode;
}) {
    return (
        <div
            className={`fixed inset-0 ${nested ? 'z-[70]' : 'z-50'} flex items-center justify-center bg-slate-950/55 p-4`}
            onClick={onClose}
        >
            <AccessibleDialogSurface
                accessibleName={title}
                onRequestClose={onClose}
                onClick={event => event.stopPropagation()}
                className={`max-h-[92vh] w-full ${wide ? 'max-w-5xl' : 'max-w-lg'} overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl`}
            >
                <div className="mb-5 flex items-center justify-between border-b pb-3">
                    <h2 className="text-base font-bold">{title}</h2>
                    <button type="button" onClick={onClose} aria-label="关闭">
                        <X className="h-5 w-5" />
                    </button>
                </div>
                {children}
            </AccessibleDialogSurface>
        </div>
    );
}

function ModalFooter({
    error,
    pending,
    valid,
    onClose,
    onSubmit,
    label,
}: {
    error?: string;
    pending: boolean;
    valid: boolean;
    onClose: () => void;
    onSubmit: () => void;
    label: string;
}) {
    return (
        <>
            <div className="mt-5">{error && <Notice message={error} />}</div>
            <div className="mt-5 flex justify-end gap-2 border-t pt-4">
                <button
                    type="button"
                    onClick={onClose}
                    disabled={pending}
                    className="rounded-lg bg-slate-100 px-4 py-2 text-xs font-bold"
                >
                    取消
                </button>
                <button
                    type="button"
                    onClick={onSubmit}
                    disabled={pending || !valid}
                    className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-40"
                >
                    {pending ? '处理中…' : label}
                </button>
            </div>
        </>
    );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <label className="block text-xs font-bold text-slate-600">
            {label}
            <div className="mt-1 font-normal">{children}</div>
        </label>
    );
}
function SelectField({
    label,
    value,
    onChange,
    options,
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    options: Array<{ value: string; label: string }>;
}) {
    return (
        <Field label={label}>
            <select value={value} onChange={event => onChange(event.target.value)} className={inputClass}>
                <option value="">请选择</option>
                {options.map(option => (
                    <option key={option.value} value={option.value}>
                        {option.label}
                    </option>
                ))}
            </select>
        </Field>
    );
}
function ActionButton({
    label,
    onClick,
    secondary,
    danger,
}: {
    label: string;
    onClick: () => void;
    secondary?: boolean;
    danger?: boolean;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`rounded-lg px-3 py-2 text-xs font-bold ${danger ? 'bg-rose-600 text-white' : secondary ? 'border border-slate-300 bg-white' : 'bg-blue-600 text-white'}`}
        >
            {label}
        </button>
    );
}
function Status({ order }: { order: CatalogPurchaseOrderRecord }) {
    return (
        <span
            className={`inline-flex rounded-full px-2 py-1 font-bold ${order.hasVariance || order.overdue ? 'bg-rose-100 text-rose-700' : 'bg-blue-100 text-blue-700'}`}
        >
            {statusLabel[order.status]}
        </span>
    );
}
function Badge({ label, danger }: { label: string; danger?: boolean }) {
    return (
        <span
            className={`rounded-full px-2 py-1 text-xs font-bold ${danger ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-700'}`}
        >
            {label}
        </span>
    );
}
function Metric({ label, value }: { label: string; value: string }) {
    return (
        <div>
            <div className="text-slate-500">{label}</div>
            <div className="mt-1 font-mono font-bold">{value}</div>
        </div>
    );
}
function Notice({ message }: { message: string }) {
    return (
        <div role="alert" className="flex items-start gap-2 rounded-lg bg-rose-50 p-3 text-xs text-rose-700">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {message}
        </div>
    );
}
function State({ label, tone }: { label: string; tone?: 'error' }) {
    return (
        <div className={`p-14 text-center text-sm ${tone ? 'text-rose-700' : 'text-slate-500'}`}>{label}</div>
    );
}

const inputClass =
    'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500';
const emptyDraft = (): OrderDraft => ({
    supplierId: '',
    stockLocationId: '',
    expectedAt: '',
    notes: '',
    lines: [{ variantId: '', quantity: '1', unitCost: '0' }],
});
const replaceAt = <T,>(items: T[], index: number, value: T) =>
    items.map((item, i) => (i === index ? value : item));
const positiveInteger = (value: string) => Number.isSafeInteger(Number(value)) && Number(value) > 0;
const nonNegative = (value: string) => Number.isFinite(Number(value)) && Number(value) >= 0;
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
const money = (microunits: number, currency: string) => `${currency} ${(microunits / 1_000).toFixed(3)}`;
const dateOnly = (value: string | null) => (value ? new Date(value).toLocaleDateString('zh-CN') : '—');
const dateTime = (value: string) => new Date(value).toLocaleString('zh-CN');
const paymentLabel = (status: CatalogPurchaseOrderRecord['paymentStatus']) =>
    ({ UNPAID: '未付', PARTIALLY_PAID: '部分已付', PAID: '已付', DISPUTED: '争议中' })[status];
const modeTitle = (mode: Exclude<ActionMode, null>) =>
    ({
        RECEIVE: '登记收货',
        RETURN: '登记退供',
        PAY: '记录付款',
        CLOSE: '采购单结案',
        CANCEL: '取消采购单',
        DISPUTE: '标记付款争议',
    })[mode];
