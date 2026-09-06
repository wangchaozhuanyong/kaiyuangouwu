import { ArrowUp, ChevronLeft, ChevronRight } from 'lucide-react';
import { PageSizeSelect } from '../../components/PageSizeSelect';
import { type StorefrontLanguageCode } from '../../graphql/storefront.graphql';
import { inputClass } from './storefront-editor-model';

export function InlinePager({
    loading = false,
    page,
    pageSize,
    onPageSizeChange,
    totalItems,
    onPageChange,
}: {
    loading?: boolean;
    page: number;
    pageSize: number;
    onPageSizeChange: (size: number) => void;
    totalItems: number;
    onPageChange: (page: number) => void;
}) {
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    return (
        <div className="mt-3 flex flex-wrap gap-y-3 gap-x-4 items-center justify-between border-t border-slate-100 pt-3 text-[10px] text-slate-400">
            <span>
                共 {totalItems} 条 · {Math.min(page + 1, totalPages)} / {totalPages} 页
            </span>
            <div className="flex flex-wrap items-center gap-2">
                <PageSizeSelect pageSize={pageSize} onPageSizeChange={onPageSizeChange} disabled={loading} />
                <button
                    type="button"
                    onClick={() => onPageChange(Math.max(0, page - 1))}
                    disabled={loading || page === 0}
                    className="rounded-lg border border-slate-200 p-1.5 disabled:opacity-30"
                    aria-label="上一页"
                >
                    <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                <button
                    type="button"
                    onClick={() => onPageChange(Math.min(totalPages - 1, page + 1))}
                    disabled={loading || page >= totalPages - 1}
                    className="rounded-lg border border-slate-200 p-1.5 disabled:opacity-30"
                    aria-label="下一页"
                >
                    <ChevronRight className="h-3.5 w-3.5" />
                </button>
            </div>
        </div>
    );
}

export function LanguageSwitch({
    value,
    onChange,
}: {
    value: StorefrontLanguageCode;
    onChange: (value: StorefrontLanguageCode) => void;
}) {
    return (
        <div className="flex rounded-lg bg-slate-100 p-1 text-[11px] font-bold">
            <button
                type="button"
                onClick={() => onChange('zh_Hans')}
                className={`rounded-md px-3 py-1.5 ${value === 'zh_Hans' ? 'bg-white text-blue-700 shadow-2xs' : 'text-slate-500'}`}
            >
                中文
            </button>
            <button
                type="button"
                onClick={() => onChange('en')}
                className={`rounded-md px-3 py-1.5 ${value === 'en' ? 'bg-white text-blue-700 shadow-2xs' : 'text-slate-500'}`}
            >
                English
            </button>
        </div>
    );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <label className="block text-xs font-bold text-slate-700">
            <span className="mb-1.5 block">{label}</span>
            {children}
        </label>
    );
}

export function ColorInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
    return (
        <div className="flex flex-wrap gap-2">
            <input
                type="color"
                value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#ffffff'}
                onChange={event => onChange(event.target.value)}
                className="h-9 w-11 rounded border border-slate-300 bg-white p-1"
            />
            <input
                value={value}
                onChange={event => onChange(event.target.value)}
                placeholder="继承"
                className={`${inputClass} min-w-0 flex-1 font-mono`}
            />
            <button
                type="button"
                onClick={() => onChange('')}
                disabled={!value}
                className="shrink-0 text-xs text-blue-700 disabled:text-slate-400"
            >
                恢复继承
            </button>
        </div>
    );
}

export function IconButton({
    label,
    disabled,
    onClick,
    icon: Icon,
    danger = false,
}: {
    label: string;
    disabled: boolean;
    onClick: () => void;
    icon: typeof ArrowUp;
    danger?: boolean;
}) {
    return (
        <button
            type="button"
            title={label}
            aria-label={label}
            disabled={disabled}
            onClick={onClick}
            className={`rounded-md p-1.5 disabled:opacity-30 ${danger ? 'text-rose-500 hover:bg-rose-50' : 'text-slate-500 hover:bg-white'}`}
        >
            <Icon className="h-3.5 w-3.5" />
        </button>
    );
}
