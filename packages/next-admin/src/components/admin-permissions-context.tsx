import { useCallback, useMemo, type ReactNode } from 'react';

import type { AdminCapabilitySnapshot } from '../../../common/src/admin-capabilities';
import { AdminCapabilitiesContext } from '../hooks/use-admin-capabilities';
import { AdminPermissionsContext } from '../hooks/use-admin-permissions';
import { hasAnyAdminPermission, type AdminPermission } from '../utils/admin-permissions';

export function AdminPermissionsProvider({
    children,
    permissions,
    capabilities = null,
}: {
    children: ReactNode;
    permissions: readonly AdminPermission[];
    capabilities?: AdminCapabilitySnapshot | null;
}) {
    const hasAnyPermission = useCallback(
        (required: readonly AdminPermission[]) => hasAnyAdminPermission(permissions, required),
        [permissions],
    );
    const value = useMemo(() => ({ permissions, hasAnyPermission }), [hasAnyPermission, permissions]);
    return (
        <AdminPermissionsContext.Provider value={value}>
            <AdminCapabilitiesContext.Provider value={capabilities}>
                {children}
            </AdminCapabilitiesContext.Provider>
        </AdminPermissionsContext.Provider>
    );
}
