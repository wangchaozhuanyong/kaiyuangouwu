import { useMutation, useQuery } from '@apollo/client/react';
import { ChevronLeft, ChevronRight, Pencil, Plus, RefreshCw, Search, Truck, X } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageSizeSelect } from '../../components/PageSizeSelect';
import { usePageSize } from '../../hooks/use-page-size';

import { AccessibleDialogSurface } from '../../components/AccessibleDialogSurface';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import {
    CATALOG_SUPPLIERS_QUERY,
    CATALOG_SUPPLIER_VARIANTS_QUERY,
    CREATE_CATALOG_SUPPLIER_MUTATION,
    UPDATE_CATALOG_SUPPLIER_MUTATION,
    type CatalogSupplierRecord,
} from '../../graphql/catalog-operations.graphql';
import { toUserFacingError } from '../../utils/user-facing-error';

interface SupplierListResult {
    catalogSuppliers: { items: CatalogSupplierRecord[]; totalItems: number };
}

interface SupplierDraft {
    id?: string;
    code: string;
    name: string;
    enabled: boolean;
    contactName: string;
    phone: string;
    email: string;
    address: string;
    notes: string;
}

const emptyDraft = (): SupplierDraft => ({
    code: '',
    name: '',
    enabled: true,
    contactName: '',
    phone: '',
    email: '',
    address: '',
    notes: '',
});

export function SuppliersModule() {
    const [search, setSearch] = useState('');
    const deferredSearch = useDeferredValue(search.trim());
    const [enabled, setEnabled] = useState<'ALL' | 'ENABLED' | 'DISABLED'>('ALL');
    const [page, setPage] = useState(0);
    const [pageSize, setPageSize] = usePageSize(setPage);
    const [draft, setDraft] = useState<SupplierDraft | null>(null);
    const [viewing, setViewing] = useState<CatalogSupplierRecord | null>(null);
    const [notice, setNotice] = useState('');
    const [actionError, setActionError] = useState('');
    const query = useQuery<SupplierListResult>(CATALOG_SUPPLIERS_QUERY, {
        variables: {
            options: {
                skip: page * pageSize,
                take: pageSize,
                text: deferredSearch || null,
                enabled: enabled === 'ALL' ? null : enabled === 'ENABLED',
            },
        },
        fetchPolicy: 'cache-and-network',
    });
    const result = query.data?.catalogSuppliers;
    const totalPages = Math.max(1, Math.ceil((result?.totalItems ?? 0) / pageSize));

    const openEdit = (supplier: CatalogSupplierRecord) =>
        setDraft({
            id: supplier.id,
            code: supplier.code,
            name: supplier.name,
            enabled: supplier.enabled,
            contactName: supplier.contactName ?? '',
            phone: supplier.phone ?? '',
            email: supplier.email ?? '',
            address: supplier.address ?? '',
            notes: supplier.notes ?? '',
        });

    return (
        <div className="flex h-full flex-col bg-slate-50">
            <header className="shrink-0 border-b border-slate-200 bg-white px-5 py-4 sm:px-8">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
                            <Truck className="h-5 w-5 text-blue-600" /> 供货商
                            <FeatureHelpButton topic="catalog.suppliers" title="供货商" />
                        </h1>
                        <p className="mt-1 text-xs text-slate-500">
                            按当前店铺管理供应商资料；停用后继续保留历史 SKU 关联。
                        </p>
                    </div>
                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={() => void query.refetch()}
                            aria-label="刷新供货商"
                            className="rounded-lg border border-slate-300 bg-white p-2 text-slate-600 hover:bg-slate-50"
                        >
                            <RefreshCw className={`h-4 w-4 ${query.loading ? 'animate-spin' : ''}`} />
                        </button>
                        <button
                            type="button"
                            onClick={() => setDraft(emptyDraft())}
                            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700"
                        >
                            <Plus className="h-4 w-4" /> 新增供货商
                        </button>
                    </div>
                </div>
            </header>

            <main className="flex-1 overflow-auto p-5 sm:p-8">
                <div className="space-y-4">
                    {notice && <Notice tone="success" message={notice} onClose={() => setNotice('')} />}
                    {actionError && (
                        <Notice tone="error" message={actionError} onClose={() => setActionError('')} />
                    )}
                    <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:flex-row">
                        <label className="relative min-w-0 flex-1">
                            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                            <input
                                value={search}
                                onChange={event => {
                                    setSearch(event.target.value);
                                    setPage(0);
                                }}
                                placeholder="搜索名称、编码、联系人或电话"
                                aria-label="搜索供货商"
                                className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm outline-none focus:border-blue-500"
                            />
                        </label>
                        <select
                            value={enabled}
                            onChange={event => {
                                setEnabled(event.target.value as typeof enabled);
                                setPage(0);
                            }}
                            aria-label="按供货商状态筛选"
                            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                        >
                            <option value="ALL">全部状态</option>
                            <option value="ENABLED">启用</option>
                            <option value="DISABLED">停用</option>
                        </select>
                    </div>

                    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                        {query.loading && !query.data ? (
                            <div className="p-12 text-center text-sm text-slate-500" role="status">
                                正在读取供货商…
                            </div>
                        ) : query.error ? (
                            <div className="p-12 text-center" role="alert">
                                <p className="text-sm font-bold text-rose-700">供货商列表加载失败</p>
                                <button
                                    type="button"
                                    onClick={() => void query.refetch()}
                                    className="mt-3 rounded-lg border px-3 py-2 text-xs font-bold"
                                >
                                    重试
                                </button>
                            </div>
                        ) : !result?.items.length ? (
                            <div className="p-12 text-center text-sm text-slate-500">
                                当前筛选下没有供货商
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="min-w-[900px] w-full text-left text-xs">
                                    <thead className="bg-slate-50 text-slate-500">
                                        <tr>
                                            {[
                                                '名称',
                                                '编码',
                                                '联系人',
                                                '电话',
                                                '关联 SKU',
                                                '状态',
                                                '操作',
                                            ].map(label => (
                                                <th key={label} className="px-4 py-3 font-bold">
                                                    {label}
                                                </th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {result.items.map(supplier => (
                                            <tr key={supplier.id} className="hover:bg-slate-50/70">
                                                <td className="px-4 py-3 font-bold text-slate-900">
                                                    {supplier.name}
                                                </td>
                                                <td className="px-4 py-3 font-mono text-slate-600">
                                                    {supplier.code}
                                                </td>
                                                <td className="px-4 py-3 text-slate-600">
                                                    {supplier.contactName || '—'}
                                                </td>
                                                <td className="px-4 py-3 text-slate-600">
                                                    {supplier.phone || '—'}
                                                </td>
                                                <td className="px-4 py-3">
                                                    <button
                                                        type="button"
                                                        onClick={() => setViewing(supplier)}
                                                        className="font-bold text-blue-600 hover:underline"
                                                    >
                                                        {supplier.linkedVariantCount}
                                                    </button>
                                                </td>
                                                <td className="px-4 py-3">
                                                    <span
                                                        className={`rounded-full px-2 py-1 font-bold ${supplier.enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}
                                                    >
                                                        {supplier.enabled ? '启用' : '停用'}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3">
                                                    <button
                                                        type="button"
                                                        onClick={() => openEdit(supplier)}
                                                        aria-label={`编辑${supplier.name}`}
                                                        className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
                                                    >
                                                        <Pencil className="h-4 w-4" />
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                        {result && (
                            <div className="flex flex-wrap gap-y-3 gap-x-4 items-center justify-between border-t px-4 py-3 text-xs text-slate-500">
                                <span>
                                    共 {result.totalItems} 条 · 第 {page + 1}/{totalPages} 页
                                </span>
                                <div className="flex flex-wrap items-center gap-2">
                                    <PageSizeSelect
                                        pageSize={pageSize}
                                        onPageSizeChange={setPageSize}
                                        disabled={query.loading}
                                    />
                                    <PagerButton
                                        label="上一页"
                                        disabled={query.loading || page === 0}
                                        onClick={() => setPage(value => Math.max(0, value - 1))}
                                    >
                                        <ChevronLeft className="h-4 w-4" />
                                    </PagerButton>
                                    <PagerButton
                                        label="下一页"
                                        disabled={query.loading || page + 1 >= totalPages}
                                        onClick={() => setPage(value => value + 1)}
                                    >
                                        <ChevronRight className="h-4 w-4" />
                                    </PagerButton>
                                </div>
                            </div>
                        )}
                    </section>
                </div>
            </main>

            {draft && (
                <SupplierEditor
                    value={draft}
                    onClose={() => setDraft(null)}
                    onSaved={async message => {
                        setDraft(null);
                        setNotice(message);
                        setActionError('');
                        await query.refetch();
                    }}
                    onError={message => setActionError(message)}
                />
            )}
            {viewing && <SupplierVariants supplier={viewing} onClose={() => setViewing(null)} />}
        </div>
    );
}

function SupplierEditor({
    value,
    onClose,
    onSaved,
    onError,
}: {
    value: SupplierDraft;
    onClose: () => void;
    onSaved: (message: string) => Promise<void>;
    onError: (message: string) => void;
}) {
    const [draft, setDraft] = useState(value);
    const [createSupplier, createState] = useMutation(CREATE_CATALOG_SUPPLIER_MUTATION);
    const [updateSupplier, updateState] = useMutation(UPDATE_CATALOG_SUPPLIER_MUTATION);
    const saving = createState.loading || updateState.loading;
    const update = (field: keyof SupplierDraft, next: string | boolean) =>
        setDraft(current => ({ ...current, [field]: next }));
    const save = async () => {
        if (!draft.name.trim()) return onError('供货商名称不能为空');
        try {
            const input = {
                ...(draft.id ? { id: draft.id } : {}),
                ...(draft.code.trim() ? { code: draft.code.trim() } : {}),
                name: draft.name.trim(),
                enabled: draft.enabled,
                contactName: draft.contactName.trim(),
                phone: draft.phone.trim(),
                email: draft.email.trim(),
                address: draft.address.trim(),
                notes: draft.notes.trim(),
            };
            if (draft.id) await updateSupplier({ variables: { input } });
            else await createSupplier({ variables: { input } });
            await onSaved(draft.id ? '供货商已更新' : '供货商已创建');
        } catch (error) {
            onError(toUserFacingError(error, '供货商保存失败，请稍后重试'));
        }
    };
    return (
        <Modal title={draft.id ? '编辑供货商' : '新增供货商'} onClose={onClose}>
            <div className="grid gap-4 sm:grid-cols-2">
                <Field label="名称 *" value={draft.name} onChange={value => update('name', value)} />
                <Field
                    label="编码（留空自动生成）"
                    value={draft.code}
                    onChange={value => update('code', value)}
                />
                <Field
                    label="联系人"
                    value={draft.contactName}
                    onChange={value => update('contactName', value)}
                />
                <Field label="电话" value={draft.phone} onChange={value => update('phone', value)} />
                <Field
                    label="邮箱"
                    type="email"
                    value={draft.email}
                    onChange={value => update('email', value)}
                />
                <label className="flex items-center gap-2 self-end rounded-lg border border-slate-200 px-3 py-2.5 text-xs font-bold text-slate-700">
                    <input
                        type="checkbox"
                        checked={draft.enabled}
                        onChange={event => update('enabled', event.target.checked)}
                    />
                    启用供货商
                </label>
                <Field
                    label="地址"
                    value={draft.address}
                    onChange={value => update('address', value)}
                    className="sm:col-span-2"
                />
                <label className="sm:col-span-2 text-xs font-bold text-slate-700">
                    备注
                    <textarea
                        value={draft.notes}
                        onChange={event => update('notes', event.target.value)}
                        rows={4}
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal"
                    />
                </label>
            </div>
            <div className="mt-6 flex justify-end gap-2 border-t pt-4">
                <button
                    type="button"
                    onClick={onClose}
                    className="rounded-lg border px-4 py-2 text-xs font-bold"
                >
                    取消
                </button>
                <button
                    type="button"
                    onClick={() => void save()}
                    disabled={saving}
                    className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
                >
                    {saving ? '保存中…' : '保存'}
                </button>
            </div>
        </Modal>
    );
}

function SupplierVariants({ supplier, onClose }: { supplier: CatalogSupplierRecord; onClose: () => void }) {
    const query = useQuery<{
        catalogSupplierVariants: {
            items: Array<{
                id: string;
                productId: string;
                productName: string;
                name: string;
                sku: string;
                enabled: boolean;
            }>;
            totalItems: number;
        };
    }>(CATALOG_SUPPLIER_VARIANTS_QUERY, {
        variables: { supplierId: supplier.id, skip: 0, take: 100 },
    });
    return (
        <Modal title={`关联 SKU · ${supplier.name}`} onClose={onClose}>
            {query.loading ? (
                <p className="py-8 text-center text-sm text-slate-500">正在读取关联 SKU…</p>
            ) : query.error ? (
                <p className="py-8 text-center text-sm text-rose-700" role="alert">
                    关联 SKU 加载失败
                </p>
            ) : !query.data?.catalogSupplierVariants.items.length ? (
                <p className="py-8 text-center text-sm text-slate-500">当前没有关联 SKU</p>
            ) : (
                <div className="max-h-[60vh] space-y-2 overflow-auto">
                    {query.data.catalogSupplierVariants.items.map(variant => (
                        <Link
                            key={variant.id}
                            to={`/catalog/products/${variant.productId}?tab=variants`}
                            className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 p-3 hover:border-blue-300"
                        >
                            <span className="min-w-0">
                                <strong className="block truncate text-sm text-slate-900">
                                    {variant.productName} · {variant.name}
                                </strong>
                                <small className="font-mono text-slate-500">{variant.sku}</small>
                            </span>
                            <span className="shrink-0 text-xs text-slate-500">
                                {variant.enabled ? '启用' : '停用'}
                            </span>
                        </Link>
                    ))}
                </div>
            )}
        </Modal>
    );
}

function Modal({
    title,
    onClose,
    children,
}: {
    title: string;
    onClose: () => void;
    children: React.ReactNode;
}) {
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4">
            <AccessibleDialogSurface
                accessibleName={title}
                onRequestClose={onClose}
                className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-2xl bg-white p-6 shadow-2xl"
            >
                <div className="mb-5 flex items-center justify-between gap-3">
                    <h2 className="text-base font-bold text-slate-900">{title}</h2>
                    <button type="button" onClick={onClose} aria-label="关闭" className="rounded-lg p-2">
                        <X className="h-4 w-4" />
                    </button>
                </div>
                {children}
            </AccessibleDialogSurface>
        </div>
    );
}

function Field({
    label,
    value,
    onChange,
    type = 'text',
    className = '',
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    type?: string;
    className?: string;
}) {
    return (
        <label className={`text-xs font-bold text-slate-700 ${className}`}>
            {label}
            <input
                type={type}
                value={value}
                onChange={event => onChange(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal"
            />
        </label>
    );
}

function PagerButton({
    label,
    disabled,
    onClick,
    children,
}: {
    label: string;
    disabled: boolean;
    onClick: () => void;
    children: React.ReactNode;
}) {
    return (
        <button
            type="button"
            aria-label={label}
            disabled={disabled}
            onClick={onClick}
            className="rounded-lg border p-2 disabled:opacity-40"
        >
            {children}
        </button>
    );
}

function Notice({
    tone,
    message,
    onClose,
}: {
    tone: 'success' | 'error';
    message: string;
    onClose: () => void;
}) {
    return (
        <div
            role={tone === 'error' ? 'alert' : 'status'}
            className={`flex items-center justify-between rounded-lg border px-4 py-3 text-xs ${tone === 'error' ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}
        >
            <span>{message}</span>
            <button type="button" onClick={onClose} aria-label="关闭提示">
                <X className="h-4 w-4" />
            </button>
        </div>
    );
}
