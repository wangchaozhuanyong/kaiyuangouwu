import { useEffect, useId, useRef } from 'react';

const activeDialogStack: symbol[] = [];

const FOCUSABLE_SELECTOR = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * 为项目内自定义弹窗统一补齐 Escape、焦点限制与关闭后焦点返回。
 */
export function useAccessibleDialog(onClose: () => void, active = true) {
    const dialogRef = useRef<HTMLElement>(null);
    const dialogKeyRef = useRef(Symbol('accessible-dialog'));
    const titleId = useId();
    const closeRef = useRef(onClose);

    useEffect(() => {
        closeRef.current = onClose;
    }, [onClose]);

    useEffect(() => {
        if (!active) return;
        const dialogKey = dialogKeyRef.current;
        activeDialogStack.push(dialogKey);
        const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const dialog = dialogRef.current;
        if (!dialog?.contains(document.activeElement)) dialog?.focus();

        const handleKeyDown = (event: KeyboardEvent) => {
            if (activeDialogStack[activeDialogStack.length - 1] !== dialogKey) return;
            if (event.key === 'Escape') {
                event.preventDefault();
                closeRef.current();
                return;
            }
            if (event.key !== 'Tab' || !dialog) return;

            const focusable = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter(
                element =>
                    !element.hidden &&
                    element.getAttribute('aria-hidden') !== 'true' &&
                    element.getClientRects().length > 0,
            );
            if (!focusable.length) {
                event.preventDefault();
                dialog.focus();
                return;
            }

            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            const wasTopDialog = activeDialogStack[activeDialogStack.length - 1] === dialogKey;
            const stackIndex = activeDialogStack.lastIndexOf(dialogKey);
            if (stackIndex >= 0) activeDialogStack.splice(stackIndex, 1);
            if (wasTopDialog) previousFocus?.focus();
        };
    }, [active]);

    return { dialogRef, titleId };
}
