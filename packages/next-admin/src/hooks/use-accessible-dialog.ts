import { useContext, useEffect, useId, useRef, type RefObject } from 'react';

import { TabPageContext } from '../layouts/tab-page-context';
import { PageRuntimeContext } from '../runtime/page-runtime-context';
import { isInputMethodKey } from '../utils/input-method';

const activeDialogStack: Array<{ key: symbol; modal: boolean; element: HTMLElement | null }> = [];
let previousBodyOverflow = '';
let bodyLocked = false;
function releaseDialog(key: symbol) {
    const index = activeDialogStack.findIndex(entry => entry.key === key);
    if (index >= 0) activeDialogStack.splice(index, 1);
    if (bodyLocked && !activeDialogStack.some(entry => entry.modal)) {
        document.body.style.overflow = previousBodyOverflow;
        bodyLocked = false;
    }
}
function visibleFocusTarget(element: HTMLElement | null): element is HTMLElement {
    return Boolean(element?.isConnected && !element.closest('[hidden], [inert], [aria-hidden="true"]'));
}

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
export function useAccessibleDialog(
    onClose: () => void,
    active = true,
    {
        modal = true,
        autoFocus = true,
        returnFocusRef,
    }: {
        modal?: boolean;
        autoFocus?: boolean;
        returnFocusRef?: RefObject<HTMLElement | null>;
    } = {},
) {
    const tabPage = useContext(TabPageContext);
    const page = useContext(PageRuntimeContext);
    const dialogActive = active && (tabPage?.active ?? true) && (page?.active ?? true);
    const dialogRef = useRef<HTMLElement>(null);
    const dialogKeyRef = useRef(Symbol('accessible-dialog'));
    const titleId = useId();
    const closeRef = useRef(onClose);

    useEffect(() => {
        closeRef.current = onClose;
    }, [onClose]);

    useEffect(() => {
        if (!dialogActive) return;
        const dialogKey = dialogKeyRef.current;
        if (modal && !activeDialogStack.some(entry => entry.modal)) {
            previousBodyOverflow = document.body.style.overflow;
            document.body.style.overflow = 'hidden';
            bodyLocked = true;
        }
        const previousFocus =
            returnFocusRef?.current ??
            (document.activeElement instanceof HTMLElement ? document.activeElement : null);
        const dialog = dialogRef.current;
        // Expose the active modal lifecycle to the shared page layer, including retained drawers.
        dialog?.toggleAttribute('data-admin-modal-active', modal);
        // Child effects mount before parent effects; an ancestor must stay below an open child.
        const childIndex = activeDialogStack.findIndex(
            entry => entry.element && dialog?.contains(entry.element),
        );
        activeDialogStack.splice(childIndex < 0 ? activeDialogStack.length : childIndex, 0, {
            key: dialogKey,
            modal,
            element: dialog,
        });
        if (
            autoFocus &&
            activeDialogStack.at(-1)?.key === dialogKey &&
            !dialog?.contains(document.activeElement)
        )
            dialog?.focus();

        const handleKeyDown = (event: KeyboardEvent) => {
            if (isInputMethodKey(event)) return;
            if (activeDialogStack.at(-1)?.key !== dialogKey) return;
            if (event.key === 'Escape') {
                event.preventDefault();
                closeRef.current();
                return;
            }
            if (event.key !== 'Tab' || !dialog || !modal) return;

            const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
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

        const containFocus = (event: FocusEvent) => {
            // React autoFocus commits before the new dialog's effect joins the stack.
            // Do not pull its focus back into the lower dialog during that commit.
            const incoming =
                event.target instanceof Element
                    ? event.target.closest<HTMLElement>('[role="dialog"], [role="alertdialog"]')
                    : null;
            if (
                incoming &&
                incoming !== dialog &&
                visibleFocusTarget(incoming) &&
                !activeDialogStack.some(entry => entry.element === incoming)
            )
                return;
            if (
                modal &&
                activeDialogStack.at(-1)?.key === dialogKey &&
                dialog &&
                !dialog.contains(event.target as Node)
            )
                dialog.focus();
        };
        document.addEventListener('keydown', handleKeyDown);
        document.addEventListener('focusin', containFocus);
        return () => {
            dialog?.removeAttribute('data-admin-modal-active');
            document.removeEventListener('keydown', handleKeyDown);
            const wasTopDialog = activeDialogStack.at(-1)?.key === dialogKey;
            const shouldRestoreFocus = autoFocus || dialog?.contains(document.activeElement);
            document.removeEventListener('focusin', containFocus);
            releaseDialog(dialogKey);
            if (wasTopDialog && shouldRestoreFocus && visibleFocusTarget(previousFocus))
                previousFocus.focus();
        };
    }, [dialogActive, modal, autoFocus, returnFocusRef]);

    return { dialogRef, titleId };
}
