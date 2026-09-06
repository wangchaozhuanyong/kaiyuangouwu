import {
    AlertCircle,
    BadgePercent,
    Check,
    ChevronLeft,
    ChevronRight,
    LoaderCircle,
    Search,
    X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { PageSizeSelect } from '../../components/PageSizeSelect';
import { useAccessibleDialog } from '../../hooks/use-accessible-dialog';
import { toUserFacingError } from '../../utils/user-facing-error';

export function MultiSelector<T extends { id: string; name: string }>({
    title,
    items,
    totalItems,
    loading,
    error,
    selectedIds,
    search,
    setSearch,
    onChange,
}: {
    title: string;
    items: T[];
    totalItems: number;
    loading: boolean;
    error?: string;
    selectedIds: string[];
    search: string;
    setSearch: (value: string) => void;
    onChange: (ids: string[]) => void;
}) {
    const visible = items.filter(
        item => !search.trim() || item.name.toLowerCase().includes(search.trim().toLowerCase()),
    );
    return (
        <div className="mt-4 rounded-xl border border-slate-200 p-3">
            <div className="flex items-center justify-between gap-3">
                <div>
                    <h3 className="text-xs font-bold text-slate-800">{title}</h3>
                    <p className="mt-0.5 text-[9px] text-slate-400">
                        {loading ? '正在查询…' : `匹配 ${totalItems} 条，当前显示前 ${items.length} 条`}
                    </p>
                </div>
                <div className="relative">
                    <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
                    <input
                        value={search}
                        onChange={event => setSearch(event.target.value)}
                        aria-label={`搜索${title}`}
                        placeholder="搜索"
                        className="w-48 rounded-lg border border-slate-300 py-1.5 pl-8 pr-2 text-[11px]"
                    />
                </div>
            </div>
            <div className="mt-2 max-h-52 overflow-y-auto rounded-lg bg-slate-50 p-2">
                {error && (
                    <p className="p-3 text-center text-[11px] text-rose-600">
                        {toUserFacingError(error, '列表读取失败')}
                    </p>
                )}
                <div className="grid gap-1 sm:grid-cols-2">
                    {visible.map(item => (
                        <label
                            key={item.id}
                            className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-[11px] hover:bg-white"
                        >
                            <input
                                type="checkbox"
                                checked={selectedIds.includes(item.id)}
                                onChange={event =>
                                    onChange(
                                        event.target.checked
                                            ? [...selectedIds, item.id]
                                            : selectedIds.filter(id => id !== item.id),
                                    )
                                }
                            />
                            <span className="truncate">{item.name}</span>
                        </label>
                    ))}
                </div>
                {!loading && !error && !visible.length && (
                    <p className="py-5 text-center text-[11px] text-slate-400">没有匹配项</p>
                )}
            </div>
        </div>
    );
}

export function CampaignState({
    enabled,
    startsAt,
    endsAt,
}: {
    enabled: boolean;
    startsAt: string | null;
    endsAt: string | null;
}) {
    const [currentTime, setCurrentTime] = useState(() => Date.now());
    useEffect(() => {
        const timer = window.setInterval(() => setCurrentTime(Date.now()), 60_000);
        return () => window.clearInterval(timer);
    }, []);
    const start = startsAt ? Date.parse(startsAt) : null;
    const end = endsAt ? Date.parse(endsAt) : null;
    let label = enabled ? '进行中' : '已停用';
    let cls = enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600';
    if (enabled && start && start > currentTime) {
        label = '待开始';
        cls = 'bg-blue-100 text-blue-700';
    }
    if (end && end <= currentTime) {
        label = '已结束';
        cls = 'bg-slate-100 text-slate-600';
    }
    return <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${cls}`}>{label}</span>;
}

export function OverviewMetric({ label, value, detail }: { label: string; value: string; detail: string }) {
    return (
        <div className="border-b border-slate-200 p-4 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0">
            <div className="text-[11px] font-bold text-slate-400">{label}</div>
            <strong className="mt-1 block text-xl text-slate-900">{value}</strong>
            <div className="mt-1 text-[10px] text-slate-500">{detail}</div>
        </div>
    );
}

export function SmallMetric({ label, value }: { label: string; value: string }) {
    return (
        <div>
            <div className="text-[10px] font-bold text-slate-400">{label}</div>
            <div className="mt-1 truncate font-mono text-xs font-bold text-slate-800">{value}</div>
        </div>
    );
}

export function TabButton({
    active,
    onClick,
    icon: Icon,
    label,
}: {
    active: boolean;
    onClick: () => void;
    icon: typeof BadgePercent;
    label: string;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`flex shrink-0 items-center gap-1.5 rounded-lg px-4 py-2 font-bold ${active ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'}`}
        >
            <Icon className="h-3.5 w-3.5" />
            {label}
        </button>
    );
}

export function FormInput({
    label,
    value,
    onChange,
    type = 'text',
    placeholder,
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    type?: string;
    placeholder?: string;
}) {
    return (
        <label className="block text-[11px] font-bold text-slate-600">
            {label}
            <input
                type={type}
                value={value}
                onChange={event => onChange(event.target.value)}
                placeholder={placeholder}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-normal text-slate-900 outline-none focus:border-blue-500"
            />
        </label>
    );
}

export function DateInput(props: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    type: 'date' | 'datetime-local';
}) {
    return <FormInput {...props} />;
}

export function FormSelect({
    label,
    value,
    onChange,
    options,
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    options: string[][];
}) {
    return (
        <label className="block text-[11px] font-bold text-slate-600">
            {label}
            <select
                value={value}
                onChange={event => onChange(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-normal text-slate-900"
            >
                {options.map(([optionValue, labelValue]) => (
                    <option key={optionValue} value={optionValue}>
                        {labelValue}
                    </option>
                ))}
            </select>
        </label>
    );
}

export function ModalFooter({
    onCancel,
    onConfirm,
    pending,
    disabled,
    confirmLabel,
    danger = false,
}: {
    onCancel: () => void;
    onConfirm: () => void;
    pending: boolean;
    disabled: boolean;
    confirmLabel: string;
    danger?: boolean;
}) {
    return (
        <div className="mt-5 flex justify-end gap-2 border-t border-slate-100 pt-4">
            <button
                type="button"
                onClick={onCancel}
                className="rounded-lg bg-slate-100 px-4 py-2 text-xs font-bold text-slate-700"
            >
                取消
            </button>
            <button
                type="button"
                onClick={onConfirm}
                disabled={pending || disabled}
                className={`rounded-lg px-4 py-2 text-xs font-bold text-white disabled:opacity-50 ${danger ? 'bg-rose-600' : 'bg-blue-600'}`}
            >
                {pending ? '处理中…' : confirmLabel}
            </button>
        </div>
    );
}

export function SimplePagination({
    loading = false,
    pageSize,
    onPageSizeChange,
    page,
    totalPages,
    totalItems,
    onPageChange,
}: {
    loading?: boolean;
    pageSize: number;
    onPageSizeChange: (size: number) => void;
    page: number;
    totalPages: number;
    totalItems: number;
    onPageChange: (value: number) => void;
}) {
    return (
        <div className="flex flex-wrap gap-y-3 gap-x-4 items-center justify-between border-t border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500">
            <span>
                共 {totalItems} 条，第 {page + 1}/{totalPages} 页
            </span>
            <div className="flex flex-wrap items-center gap-2">
                <PageSizeSelect pageSize={pageSize} onPageSizeChange={onPageSizeChange} disabled={loading} />
                <button
                    type="button"
                    disabled={loading || page === 0}
                    onClick={() => onPageChange(page - 1)}
                    aria-label="上一页"
                    className="rounded border border-slate-300 bg-white p-1.5 disabled:opacity-40"
                >
                    <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                    type="button"
                    disabled={loading || page + 1 >= totalPages}
                    onClick={() => onPageChange(page + 1)}
                    aria-label="下一页"
                    className="rounded border border-slate-300 bg-white p-1.5 disabled:opacity-40"
                >
                    <ChevronRight className="h-4 w-4" />
                </button>
            </div>
        </div>
    );
}

export function Message({
    kind,
    children,
    onClose,
}: {
    kind: 'success' | 'error';
    children: React.ReactNode;
    onClose: () => void;
}) {
    return (
        <div
            className={`my-3 flex items-center gap-2 rounded-xl border p-3 text-xs ${kind === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'}`}
        >
            {kind === 'success' ? <Check className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
            <span className="flex-1">{children}</span>
            <button type="button" onClick={onClose} aria-label="关闭提示">
                <X className="h-4 w-4" />
            </button>
        </div>
    );
}

export function LoadingState({ label }: { label: string }) {
    return (
        <div className="flex min-h-52 items-center justify-center rounded-xl border border-slate-200 bg-white text-xs text-slate-500">
            <LoaderCircle className="mr-2 h-5 w-5 animate-spin text-blue-600" />
            {label}
        </div>
    );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
    return (
        <div className="rounded-xl border border-rose-200 bg-white p-10 text-center">
            <AlertCircle className="mx-auto h-8 w-8 text-rose-500" />
            <h3 className="mt-3 text-sm font-bold text-slate-900">营销数据读取失败</h3>
            <p className="mt-1 text-xs text-rose-600">{toUserFacingError(message)}</p>
            <button
                type="button"
                onClick={onRetry}
                className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-xs font-bold text-white"
            >
                重新加载
            </button>
        </div>
    );
}

export function EmptyState({
    icon: Icon,
    title,
    detail,
    action,
    onAction,
}: {
    icon: typeof BadgePercent;
    title: string;
    detail: string;
    action: string;
    onAction: () => void;
}) {
    return (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-14 text-center">
            <Icon className="mx-auto h-10 w-10 text-slate-300" />
            <h3 className="mt-3 text-sm font-bold text-slate-800">{title}</h3>
            <p className="mt-1 text-xs text-slate-400">{detail}</p>
            <button
                type="button"
                onClick={onAction}
                className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white"
            >
                {action}
            </button>
        </div>
    );
}

export function Modal({
    title,
    description,
    onClose,
    width,
    children,
}: {
    title: string;
    description?: string;
    onClose: () => void;
    width: string;
    children: React.ReactNode;
}) {
    const { dialogRef, titleId } = useAccessibleDialog(onClose);
    return (
        <div
            className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-2xs"
            onMouseDown={event => {
                if (event.target === event.currentTarget) onClose();
            }}
        >
            <div
                ref={dialogRef as React.RefObject<HTMLDivElement>}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                tabIndex={-1}
                className={`max-h-[92vh] w-full ${width} overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-2xl outline-none`}
            >
                <div className="sticky top-0 z-10 flex items-start justify-between border-b border-slate-100 bg-white px-5 py-4">
                    <div>
                        <h2 id={titleId} className="text-base font-bold text-slate-900">
                            {title}
                        </h2>
                        {description && <p className="mt-1 text-[11px] text-slate-500">{description}</p>}
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded p-1 text-slate-400 hover:bg-slate-100"
                        aria-label="关闭"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>
                <div className="p-5">{children}</div>
            </div>
        </div>
    );
}
