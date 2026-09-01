import { ShieldAlert, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { AccessibleDialogSurface } from './AccessibleDialogSurface';

export function SensitiveActionDialog({
    open,
    title,
    description,
    confirmLabel,
    loading = false,
    error = '',
    onClose,
    onConfirm,
}: {
    open: boolean;
    title: string;
    description: string;
    confirmLabel: string;
    loading?: boolean;
    error?: string;
    onClose: () => void;
    onConfirm: (currentPassword: string) => void | Promise<void>;
}) {
    const [password, setPassword] = useState('');

    /* oxlint-disable react/set-state-in-effect -- clear credentials whenever the controlled dialog closes. */
    useEffect(() => {
        if (!open) setPassword('');
    }, [open]);
    /* oxlint-enable react/set-state-in-effect */

    if (!open) return null;
    return (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/60 p-4">
            <AccessibleDialogSurface
                accessibleName={title}
                onRequestClose={() => !loading && onClose()}
                className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
            >
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <h2 className="flex items-center gap-2 text-base font-bold text-slate-900">
                            <ShieldAlert className="h-5 w-5 text-amber-600" /> {title}
                        </h2>
                        <p className="mt-2 text-xs leading-5 text-slate-500">{description}</p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={loading}
                        aria-label="关闭"
                        className="rounded-lg p-2 text-slate-500 disabled:opacity-40"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>
                <label className="mt-5 block text-xs font-bold text-slate-700">
                    当前管理员密码
                    <input
                        type="password"
                        autoComplete="current-password"
                        value={password}
                        onChange={event => setPassword(event.target.value)}
                        onKeyDown={event => {
                            if (event.key === 'Enter' && password && !loading) void onConfirm(password);
                        }}
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm"
                    />
                </label>
                {error && (
                    <p
                        className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800"
                        role="alert"
                    >
                        {error}
                    </p>
                )}
                <div className="mt-6 flex justify-end gap-2 border-t border-slate-100 pt-4">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={loading}
                        className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-bold text-slate-700 disabled:opacity-40"
                    >
                        取消
                    </button>
                    <button
                        type="button"
                        onClick={() => void onConfirm(password)}
                        disabled={!password || loading}
                        className="rounded-lg bg-amber-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-40"
                    >
                        {loading ? '后端校验中…' : confirmLabel}
                    </button>
                </div>
            </AccessibleDialogSurface>
        </div>
    );
}
