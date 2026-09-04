import { AlertTriangle, CheckCircle2, Info, LoaderCircle, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
    publishAdminFeedback,
    subscribeAdminFeedback,
    type AdminFeedback,
    type AdminFeedbackKind,
} from '../utils/admin-feedback';

const maximumVisibleFeedback = 5;

export function AdminFeedbackCenter() {
    const [items, setItems] = useState<AdminFeedback[]>([]);
    const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

    const dismiss = useCallback((id: string) => {
        const timer = timers.current.get(id);
        if (timer) clearTimeout(timer);
        timers.current.delete(id);
        setItems(current => current.filter(item => item.id !== id));
    }, []);

    useEffect(() => {
        const activeTimers = timers.current;
        const unsubscribe = subscribeAdminFeedback(feedback => {
            const existingTimer = activeTimers.get(feedback.id);
            if (existingTimer) clearTimeout(existingTimer);

            setItems(current => {
                const existingIndex = current.findIndex(item => item.id === feedback.id);
                const next =
                    existingIndex >= 0
                        ? current.map(item => (item.id === feedback.id ? feedback : item))
                        : [...current, feedback];
                return next.slice(-maximumVisibleFeedback);
            });

            if (feedback.kind !== 'loading') {
                const duration = feedback.durationMs ?? (feedback.kind === 'error' ? 10_000 : 4_500);
                activeTimers.set(
                    feedback.id,
                    setTimeout(() => dismiss(feedback.id), duration),
                );
            }
        });

        return () => {
            unsubscribe();
            activeTimers.forEach(timer => clearTimeout(timer));
            activeTimers.clear();
        };
    }, [dismiss]);

    useEffect(() => {
        let validationBatchTimer: ReturnType<typeof setTimeout> | undefined;
        const onInvalid = (event: Event) => {
            // 原生表单会在一次提交中按顺序触发多个 invalid 事件，只提示并聚焦的第一个字段。
            if (validationBatchTimer) return;
            const control = event.target;
            if (!(
                control instanceof HTMLInputElement ||
                control instanceof HTMLSelectElement ||
                control instanceof HTMLTextAreaElement
            )) {
                return;
            }
            validationBatchTimer = setTimeout(() => {
                validationBatchTimer = undefined;
            }, 0);
            publishAdminFeedback({
                id: 'admin-form-validation',
                kind: 'error',
                title: '暂时无法提交',
                message: getInvalidControlMessage(control),
            });
        };

        document.addEventListener('invalid', onInvalid, true);
        return () => {
            document.removeEventListener('invalid', onInvalid, true);
            if (validationBatchTimer) clearTimeout(validationBatchTimer);
        };
    }, []);

    if (!items.length) return null;

    return (
        <aside
            aria-label="操作通知"
            className="pointer-events-none fixed right-4 top-20 z-[120] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2 sm:right-6"
        >
            {items.map(item => (
                <article
                    key={item.id}
                    role={item.kind === 'error' ? 'alert' : 'status'}
                    aria-atomic="true"
                    data-admin-feedback-kind={item.kind}
                    className={`pointer-events-auto flex items-start gap-3 rounded-xl border p-4 shadow-xl backdrop-blur ${feedbackClassName(item.kind)}`}
                >
                    <FeedbackIcon kind={item.kind} />
                    <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold leading-5">{item.title}</p>
                        {item.message && <p className="mt-1 text-xs leading-5 opacity-90">{item.message}</p>}
                    </div>
                    {item.kind !== 'loading' && (
                        <button
                            type="button"
                            onClick={() => dismiss(item.id)}
                            className="-mr-1 -mt-1 rounded-md p-1 opacity-60 hover:bg-black/5 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current"
                            aria-label="关闭通知"
                        >
                            <X className="h-4 w-4" />
                        </button>
                    )}
                </article>
            ))}
        </aside>
    );
}

function FeedbackIcon({ kind }: { kind: AdminFeedbackKind }) {
    const className = 'mt-0.5 h-5 w-5 shrink-0';
    if (kind === 'loading')
        return <LoaderCircle className={`${className} animate-spin`} aria-hidden="true" />;
    if (kind === 'success') return <CheckCircle2 className={className} aria-hidden="true" />;
    if (kind === 'error') return <AlertTriangle className={className} aria-hidden="true" />;
    return <Info className={className} aria-hidden="true" />;
}

function feedbackClassName(kind: AdminFeedbackKind) {
    if (kind === 'success') {
        return 'border-emerald-200 bg-emerald-50/95 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/95 dark:text-emerald-100';
    }
    if (kind === 'error') {
        return 'border-red-200 bg-red-50/95 text-red-900 dark:border-red-800 dark:bg-red-950/95 dark:text-red-100';
    }
    if (kind === 'loading') {
        return 'border-blue-200 bg-blue-50/95 text-blue-900 dark:border-blue-800 dark:bg-blue-950/95 dark:text-blue-100';
    }
    return 'border-slate-200 bg-white/95 text-slate-800 dark:border-slate-700 dark:bg-slate-900/95 dark:text-slate-100';
}

function getInvalidControlMessage(control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement) {
    const label = getControlLabel(control);
    if (control.validity.valueMissing) return `${label}为必填项，请填写后再保存`;
    if (control.validity.typeMismatch) return `${label}格式不正确，请检查后再保存`;
    if (control.validity.patternMismatch) return `${label}不符合要求，请检查输入格式`;
    if (control.validity.tooShort) return `${label}内容过短，请继续填写`;
    if (control.validity.tooLong) return `${label}内容过长，请删减后再保存`;
    if (control.validity.rangeUnderflow || control.validity.rangeOverflow) return `${label}超出允许范围`;
    return `${label}填写有误，请检查标红字段后再保存`;
}

function getControlLabel(control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement) {
    const explicitLabel = control.labels?.[0]?.textContent?.replace(/\s+/gu, ' ').trim();
    const placeholder = 'placeholder' in control ? control.placeholder : '';
    const candidate = control.getAttribute('aria-label') || explicitLabel || placeholder || control.name;
    return candidate && candidate.length <= 40 ? `“${candidate}”` : '当前字段';
}
