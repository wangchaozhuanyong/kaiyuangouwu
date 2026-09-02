import { AlertCircle, CheckCircle2, LoaderCircle, X } from 'lucide-react';
import type React from 'react';
import { useAccessibleDialog } from '../../hooks/use-accessible-dialog';
import { toUserFacingError } from '../../utils/user-facing-error';

// ─── Shared CSS class constants ──────────────────────────────────────────────
// These were previously duplicated across StoreSettingsModule, RolesModule,
// SystemOpsModule, StoreFinancePanel, UsdtPaymentManagementModule, and
// UsdtPaymentSetupPanel.

export const inputClass =
    'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-normal text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-50 disabled:text-slate-400';
export const primaryButton =
    'tablet-touch-target flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50';
export const secondaryButton =
    'tablet-touch-target flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50';
export const theadClass = 'border-b border-slate-200 bg-slate-50 text-[10px] font-bold text-slate-500';

// ─── TabButton ───────────────────────────────────────────────────────────────

export function TabButton({
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
            className={`tablet-touch-target flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-bold ${active ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-50'}`}
        >
            {icon}
            {children}
        </button>
    );
}

// ─── Modal ───────────────────────────────────────────────────────────────────

export function Modal({
    title,
    description,
    onClose,
    width = 'max-w-3xl',
    children,
}: {
    title: string;
    description?: string;
    onClose: () => void;
    width?: string;
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
                className={`max-h-[94vh] w-full ${width} overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl outline-none`}
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

// ─── ModalActions ────────────────────────────────────────────────────────────

export function ModalActions({
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

// ─── Field ───────────────────────────────────────────────────────────────────

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <label className="block text-xs font-bold text-slate-700">
            <span className="mb-1.5 block">{label}</span>
            {children}
        </label>
    );
}

// ─── EmptyState ──────────────────────────────────────────────────────────────

export function EmptyState({
    icon,
    title,
    detail,
}: {
    icon: React.ReactNode;
    title: string;
    detail: string;
}) {
    return (
        <div className="flex min-h-96 flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-slate-400">
            {icon}
            <h2 className="mt-3 text-sm font-bold text-slate-700">{title}</h2>
            <p className="mt-1 max-w-md text-xs">{detail}</p>
        </div>
    );
}

// ─── LoadingState ────────────────────────────────────────────────────────────

export function LoadingState() {
    return (
        <div className="flex min-h-96 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white text-xs text-slate-500">
            <LoaderCircle className="h-4 w-4 animate-spin" />
            正在读取真实店铺配置…
        </div>
    );
}

// ─── ErrorState ──────────────────────────────────────────────────────────────

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
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

// ─── Message ─────────────────────────────────────────────────────────────────

export function Message({
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

// ─── StoreInfo ───────────────────────────────────────────────────────────────

export function StoreInfo({
    label,
    value,
    tone,
}: {
    label: string;
    value: string;
    tone?: 'green' | 'amber';
}) {
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

// ─── StatusBadge ─────────────────────────────────────────────────────────────

export function StatusBadge({ status, operational }: { status: string; operational: boolean }) {
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

// ─── ImpactStat ──────────────────────────────────────────────────────────────

export function ImpactStat({ label, value }: { label: string; value: string | number }) {
    return (
        <div className="rounded-lg bg-slate-50 p-3 text-center">
            <div className="text-lg font-bold text-slate-800">{value}</div>
            <div className="text-[10px] text-slate-500">{label}</div>
        </div>
    );
}

// ─── Utility functions ───────────────────────────────────────────────────────

export function errorText(error: unknown) {
    return toUserFacingError(error, '店铺设置操作失败，请稍后重试');
}

export function splitCodes(value: string) {
    return [
        ...new Set(
            value
                .split(/[，,\s]+/)
                .map(item => item.trim())
                .filter(Boolean),
        ),
    ];
}

export function mergeById<T extends { id: string }>(current: T[], next: T[]) {
    return [...new Map([...current, ...next].map(item => [item.id, item])).values()];
}
