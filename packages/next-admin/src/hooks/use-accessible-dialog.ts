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
    'details > summary:first-of-type',
    'iframe',
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
            if (event.key === 'Escape') {
                if (activeDialogStack.at(-1)?.key !== dialogKey) return;
                event.preventDefault();
                closeRef.current();
                return;
            }
            if (event.key !== 'Tab' || !dialog || !modal || event.ctrlKey || event.altKey || event.metaKey)
                return;
            const modalIndex = activeDialogStack.findLastIndex(entry => entry.modal);
            if (activeDialogStack[modalIndex]?.key !== dialogKey) return;
            // Non-modal help portals remain inside their owning modal's keyboard boundary.
            const focusable = [
                ...new Set(
                    activeDialogStack
                        .slice(modalIndex)
                        .flatMap(entry =>
                            Array.from(
                                entry.element?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? [],
                            ),
                        ),
                ),
            ]
                .filter(
                    element =>
                        element.tabIndex >= 0 &&
                        !element.matches(':disabled') &&
                        visibleFocusTarget(element) &&
                        element.getClientRects().length > 0 &&
                        getComputedStyle(element).visibility !== 'hidden',
                )
                .filter((element, _index, elements) => {
                    if (!(element instanceof HTMLInputElement) || element.type !== 'radio' || !element.name)
                        return true;
                    const group = elements.filter(
                        (item): item is HTMLInputElement =>
                            item instanceof HTMLInputElement &&
                            item.type === 'radio' &&
                            item.name === element.name &&
                            item.form === element.form,
                    );
                    return element === (group.find(item => item.checked) ?? group[0]);
                })
                .sort((a, b) => (a.tabIndex || Infinity) - (b.tabIndex || Infinity));
            event.preventDefault();
            if (!focusable.length) {
                dialog.focus();
                return;
            }
            // Own the sequence even when the browser's default Tab mode skips buttons.
            const current = focusable.indexOf(document.activeElement as HTMLElement);
            const next = event.shiftKey
                ? (current <= 0 ? focusable.length : current) - 1
                : (current + 1) % focusable.length;
            focusable[next].focus();
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
            const modalIndex = activeDialogStack.findLastIndex(entry => entry.modal);
            if (
                modal &&
                activeDialogStack[modalIndex]?.key === dialogKey &&
                dialog &&
                !activeDialogStack
                    .slice(modalIndex)
                    .some(entry => entry.element?.contains(event.target as Node))
            )
                dialog.focus();
        };
        document.addEventListener('keydown', handleKeyDown);
        document.addEventListener('focusin', containFocus);
        return () => {
            dialog?.removeAttribute('data-admin-modal-active');
            document.removeEventListener('keydown', handleKeyDown);
            // Closing a modal also dismisses its help portals, even if their cleanup runs later.
            const shouldReturnFocus =
                activeDialogStack.at(-1)?.key === dialogKey ||
                (modal && activeDialogStack.findLast(entry => entry.modal)?.key === dialogKey);
            const shouldRestoreFocus = autoFocus || dialog?.contains(document.activeElement);
            document.removeEventListener('focusin', containFocus);
            releaseDialog(dialogKey);
            if (shouldReturnFocus && shouldRestoreFocus && visibleFocusTarget(previousFocus))
                previousFocus.focus();
        };
    }, [dialogActive, modal, autoFocus, returnFocusRef]);

    return { dialogRef, titleId };
}
