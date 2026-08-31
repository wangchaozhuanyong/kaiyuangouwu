import { useCallback, useId, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, HelpCircle, ShieldAlert } from 'lucide-react';
import {
  ConfirmDialogContext,
  type ConfirmDialogResult,
  type ConfirmDialogOptions,
  type RequestConfirmation,
} from './confirm-dialog-context';
import { useAccessibleDialog } from '../hooks/use-accessible-dialog';

export function ConfirmDialogProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<ConfirmDialogOptions | null>(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const resolverRef = useRef<((result: ConfirmDialogResult) => void) | null>(null);
  const descriptionId = useId();

  const settle = useCallback((result: ConfirmDialogResult) => {
    resolverRef.current?.(result);
    resolverRef.current = null;
    setCurrentPassword('');
    setOptions(null);
  }, []);
  const { dialogRef, titleId } = useAccessibleDialog(() => settle(false), Boolean(options));

  const requestConfirmation = useCallback<RequestConfirmation>(nextOptions => new Promise(resolve => {
    resolverRef.current?.(false);
    resolverRef.current = resolve;
    setCurrentPassword('');
    setOptions(nextOptions);
  }), []);

  const tone = options?.tone ?? 'default';
  const Icon = tone === 'danger' ? ShieldAlert : tone === 'warning' ? AlertTriangle : HelpCircle;
  const iconClass = tone === 'danger'
    ? 'bg-rose-50 text-rose-600'
    : tone === 'warning'
      ? 'bg-amber-50 text-amber-600'
      : 'bg-blue-50 text-blue-600';
  const confirmClass = tone === 'danger'
    ? 'bg-rose-600 hover:bg-rose-700 focus:ring-rose-200'
    : tone === 'warning'
      ? 'bg-amber-600 hover:bg-amber-700 focus:ring-amber-200'
      : 'bg-blue-600 hover:bg-blue-700 focus:ring-blue-200';

  return (
    <ConfirmDialogContext.Provider value={requestConfirmation}>
      {children}
      {options && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-xs"
          onMouseDown={event => {
            if (event.target === event.currentTarget) settle(false);
          }}
        >
          <section
            ref={dialogRef as React.RefObject<HTMLElement>}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
            tabIndex={-1}
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl outline-none"
          >
            <div className={`flex h-11 w-11 items-center justify-center rounded-full ${iconClass}`}>
              <Icon className="h-5 w-5" />
            </div>
            <h2 id={titleId} className="mt-4 text-base font-bold text-slate-900">{options.title}</h2>
            <p id={descriptionId} className="mt-2 whitespace-pre-line text-xs leading-5 text-slate-500">
              {options.description}
            </p>
            {options.requireCurrentPassword && (
              <label className="mt-5 block text-xs font-bold text-slate-700">
                当前管理员密码
                <input
                  type="password"
                  value={currentPassword}
                  onChange={event => setCurrentPassword(event.target.value)}
                  autoComplete="current-password"
                  autoFocus
                  placeholder="仅用于本次操作校验，不会保存"
                  className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-normal text-slate-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50"
                />
              </label>
            )}
            <div className="mt-6 flex flex-col-reverse gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => settle(false)}
                autoFocus={!options.requireCurrentPassword}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-slate-100"
              >
                {options.cancelLabel ?? '取消'}
              </button>
              <button
                type="button"
                onClick={() => settle({
                  currentPassword: options.requireCurrentPassword ? currentPassword : undefined,
                })}
                disabled={options.requireCurrentPassword && !currentPassword}
                className={`rounded-lg px-4 py-2 text-xs font-bold text-white focus:outline-none focus:ring-4 disabled:cursor-not-allowed disabled:opacity-50 ${confirmClass}`}
              >
                {options.confirmLabel ?? '确认'}
              </button>
            </div>
          </section>
        </div>
      )}
    </ConfirmDialogContext.Provider>
  );
}
