import { useContext, useLayoutEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AdminOverlayContext } from '../runtime/admin-overlay-context';

/** Own the complete backdrop as well as the dialog; portals cannot escape an inactive page. */
export function AdminOverlayHost({
    owner,
    active = true,
    children,
}: {
    owner: string;
    active?: boolean;
    children: ReactNode;
}) {
    const [host] = useState(() => document.createElement('div'));
    useLayoutEffect(() => {
        host.setAttribute('data-admin-overlay-owner', owner);
        document.body.append(host);
        return () => host.remove();
    }, [host, owner]);
    useLayoutEffect(() => {
        host.toggleAttribute('hidden', !active);
        host.toggleAttribute('inert', !active);
        host.setAttribute('aria-hidden', String(!active));
    }, [host, active]);
    return <AdminOverlayContext.Provider value={host}>{children}</AdminOverlayContext.Provider>;
}

export function AdminOverlayPortal({
    children,
    ownerHost,
}: {
    children: ReactNode;
    ownerHost?: HTMLElement | null;
}) {
    const host = useContext(AdminOverlayContext);
    return createPortal(children, ownerHost ?? host ?? document.body);
}
