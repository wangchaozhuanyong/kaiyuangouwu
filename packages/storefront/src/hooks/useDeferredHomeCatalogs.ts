import { useEffect, useState } from 'react';

/** Enable below-fold home reads near the viewport; the existing queries still own data and errors. */
export function useDeferredHomeCatalogs(scope: string, enabled: boolean) {
    const [activation, setActivation] = useState({ scope: '', sales: false, recommended: false });
    const current = activation.scope === scope ? activation : { scope, sales: false, recommended: false };
    useEffect(() => {
        if (!enabled || (current.sales && current.recommended)) return;
        const pending = { sales: !current.sales, recommended: !current.recommended };
        let active = true;
        const enable = (kind: 'sales' | 'recommended') => {
            if (!active || !pending[kind]) return;
            pending[kind] = false;
            setActivation(previous => ({
                ...(previous.scope === scope ? previous : { scope, sales: false, recommended: false }),
                [kind]: true,
            }));
        };
        if (typeof IntersectionObserver === 'undefined') {
            enable('sales');
            enable('recommended');
            return () => {
                active = false;
            };
        }
        const observer = new IntersectionObserver(
            entries => {
                for (const entry of entries) {
                    if (!entry.isIntersecting || !entry.target.isConnected) continue;
                    const kind = (entry.target as HTMLElement).dataset.homeCatalog;
                    if (kind === 'sales' || kind === 'recommended') enable(kind);
                    observer.unobserve(entry.target);
                    if (!pending.sales && !pending.recommended) mounts?.disconnect();
                }
            },
            { rootMargin: '300px' },
        );
        const seen = new WeakSet<Element>();
        const observeTargets = () => {
            document.querySelectorAll('[data-home-catalog]').forEach(element => {
                const kind = (element as HTMLElement).dataset.homeCatalog;
                if ((kind !== 'sales' && kind !== 'recommended') || !pending[kind] || seen.has(element))
                    return;
                seen.add(element);
                observer.observe(element);
            });
        };
        // Route components may commit after this parent hook, or replace snapshot nodes.
        // Observe those DOM mounts instead of polling or depending on a particular chunk timing.
        const mounts =
            typeof MutationObserver === 'undefined' ? undefined : new MutationObserver(observeTargets);
        mounts?.observe(document.body, { childList: true, subtree: true });
        observeTargets();
        return () => {
            active = false;
            observer.disconnect();
            mounts?.disconnect();
        };
    }, [scope, enabled]);
    return current;
}
