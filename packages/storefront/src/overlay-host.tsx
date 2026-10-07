import {
    createContext,
    HTMLAttributes,
    ReactNode,
    useContext,
    useId,
    useLayoutEffect,
    useRef,
    useState,
    useSyncExternalStore,
} from 'react';
import { createPortal } from 'react-dom';

import { isInputMethodKey } from './input-method';
import { acquireBodyScrollLock } from './scroll-lock';

import './styles/overlay-host.css';

const OverlayOwnerContext = createContext('document');
const subscribeClient = () => () => undefined;
const clientSnapshot = () => true;
const serverSnapshot = () => false;

export function useOverlayOwnerKey(): string {
    return useContext(OverlayOwnerContext);
}

interface OverlayEntry {
    owner: string;
    layer: HTMLDivElement;
    dialog: HTMLElement;
    initialFocus: 'first' | 'dialog';
    previousFocus: HTMLElement | null;
    close(): void;
    releaseScroll(): void;
    focusFrame?: number;
}

function visible(element: HTMLElement): boolean {
    if (!element.isConnected) return false;
    for (let node: HTMLElement | null = element; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (
            node.hidden ||
            node.hasAttribute('inert') ||
            node.getAttribute('aria-hidden') === 'true' ||
            style.display === 'none' ||
            style.visibility === 'hidden'
        )
            return false;
    }
    return true;
}

function focusable(dialog: HTMLElement): HTMLElement[] {
    return Array.from(
        dialog.querySelectorAll<HTMLElement>(
            'a[href],button,input,select,textarea,[tabindex],[contenteditable="true"]',
        ),
    ).filter(element => element.tabIndex >= 0 && !element.matches(':disabled') && visible(element));
}

/** One stack per document, also shared by standalone previews and component fixtures. */
class OverlayStack {
    private entries: OverlayEntry[] = [];
    private inertBefore = new Map<HTMLElement, string | null>();
    private observer?: MutationObserver;

    constructor(private readonly document: Document) {}

    private top() {
        return this.entries.at(-1);
    }

    private focus(entry: OverlayEntry) {
        const preferred = entry.dialog.querySelector<HTMLElement>('[data-overlay-autofocus]');
        const target =
            entry.initialFocus === 'dialog'
                ? entry.dialog
                : preferred && !preferred.matches(':disabled') && visible(preferred)
                  ? preferred
                  : focusable(entry.dialog)[0];
        (target ?? entry.dialog).focus({ preventScroll: true });
    }

    private keydown = (event: KeyboardEvent) => {
        const entry = this.top();
        if (!entry || event.defaultPrevented || isInputMethodKey(event)) return;
        if (event.key !== 'Escape' && event.key !== 'Tab') return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.key === 'Escape') {
            entry.close();
            return;
        }
        const items = focusable(entry.dialog);
        if (!items.length) {
            entry.dialog.focus({ preventScroll: true });
            return;
        }
        const current = items.indexOf(this.document.activeElement as HTMLElement);
        const next = event.shiftKey
            ? current <= 0
                ? items.length - 1
                : current - 1
            : current < 0 || current === items.length - 1
              ? 0
              : current + 1;
        items[next].focus({ preventScroll: true });
    };

    private focusin = (event: FocusEvent) => {
        const entry = this.top();
        if (entry && event.target instanceof Node && !entry.dialog.contains(event.target)) this.focus(entry);
    };

    private sync = () => {
        const top = this.top();
        this.entries.forEach((entry, index) => {
            entry.layer.style.setProperty('--overlay-stack-index', String(index));
            entry.layer.toggleAttribute('data-overlay-top', entry === top);
        });
        for (const child of Array.from(this.document.body.children)) {
            if (!(child instanceof HTMLElement)) continue;
            if (!this.inertBefore.has(child)) this.inertBefore.set(child, child.getAttribute('inert'));
            if (top && child !== top.layer && !child.contains(top.layer)) child.setAttribute('inert', '');
            else this.restoreInert(child);
        }
    };

    private restoreInert(element: HTMLElement) {
        const original = this.inertBefore.get(element);
        if (original === null) element.removeAttribute('inert');
        else if (original !== undefined) element.setAttribute('inert', original);
    }

    add(entry: OverlayEntry): (restoreFocus?: boolean) => void {
        if (!this.entries.length) {
            this.document.addEventListener('keydown', this.keydown, true);
            this.document.addEventListener('focusin', this.focusin, true);
            this.observer = new MutationObserver(this.sync);
            this.observer.observe(this.document.body, { childList: true });
        }
        this.entries.push(entry);
        this.sync();
        entry.focusFrame = requestAnimationFrame(() => {
            if (this.top() === entry) this.focus(entry);
        });
        return (restoreFocus = true) => this.remove(entry, restoreFocus);
    }

    private remove(entry: OverlayEntry, restoreFocus = true) {
        const index = this.entries.indexOf(entry);
        if (index < 0) return;
        const wasTop = this.top() === entry;
        if (entry.focusFrame !== undefined) cancelAnimationFrame(entry.focusFrame);
        this.entries.splice(index, 1);
        // An outer dialog may close first. Preserve its visible trigger for the remaining dialog.
        for (const remaining of this.entries)
            if (remaining.previousFocus && entry.layer.contains(remaining.previousFocus))
                remaining.previousFocus = entry.previousFocus;
        entry.releaseScroll();
        this.sync();
        if (!this.entries.length) {
            this.observer?.disconnect();
            this.document.removeEventListener('keydown', this.keydown, true);
            this.document.removeEventListener('focusin', this.focusin, true);
            for (const element of this.inertBefore.keys()) this.restoreInert(element);
            this.inertBefore.clear();
        }
        if (!wasTop || !restoreFocus) return;
        if (entry.previousFocus && visible(entry.previousFocus))
            entry.previousFocus.focus({ preventScroll: true });
        else {
            const nextTop = this.top();
            if (nextTop) this.focus(nextTop);
        }
    }

    releaseOwner(owner: string) {
        for (const entry of [...this.entries].reverse()) if (entry.owner === owner) this.remove(entry, false);
    }
}

const stacks = new WeakMap<Document, OverlayStack>();
function stackFor(document: Document): OverlayStack {
    let stack = stacks.get(document);
    if (!stack) {
        stack = new OverlayStack(document);
        stacks.set(document, stack);
    }
    return stack;
}

/** Owner includes the current page, store, currency, language and customer identity. */
export function OverlayHost({ ownerKey, children }: { ownerKey: string; children: ReactNode }) {
    useLayoutEffect(() => () => stackFor(document).releaseOwner(ownerKey), [ownerKey]);
    return <OverlayOwnerContext.Provider value={ownerKey}>{children}</OverlayOwnerContext.Provider>;
}

interface OverlayProps extends HTMLAttributes<HTMLDivElement> {
    onClose: () => void;
    initialFocus?: 'first' | 'dialog';
}

/** Business markup retains its dialog/alertdialog semantics and layout; lifecycle lives here. */
export function Overlay({ onClose, initialFocus = 'first', children, ...props }: OverlayProps) {
    const client = useSyncExternalStore(subscribeClient, clientSnapshot, serverSnapshot);
    const owner = useOverlayOwnerKey();
    const [originOwner] = useState(owner);
    const [detached, setDetached] = useState(false);
    const currentOwner = useRef(owner);
    currentOwner.current = owner;
    const close = useRef(onClose);
    close.current = onClose;
    const layer = useRef<HTMLDivElement>(null);
    const id = useId();
    useLayoutEffect(() => {
        if (owner !== originOwner) {
            if (!detached) {
                setDetached(true);
                close.current();
            }
            return;
        }
        if (detached) return;
        const element = layer.current;
        const dialog = element?.querySelector<HTMLElement>('[role="dialog"], [role="alertdialog"]');
        if (!element || !dialog) return;
        if (!dialog.hasAttribute('tabindex')) dialog.tabIndex = -1;
        const remove = stackFor(document).add({
            owner,
            layer: element,
            dialog,
            initialFocus,
            previousFocus: document.activeElement instanceof HTMLElement ? document.activeElement : null,
            close: () => close.current(),
            releaseScroll: acquireBodyScrollLock(),
        });
        return () => remove(currentOwner.current === owner);
    }, [owner, originOwner, initialFocus, detached]);
    if (owner !== originOwner || detached) return null;
    const content = (
        <div {...props} ref={layer} data-overlay-layer={id}>
            {children}
        </div>
    );
    return client ? createPortal(content, document.body) : content;
}
