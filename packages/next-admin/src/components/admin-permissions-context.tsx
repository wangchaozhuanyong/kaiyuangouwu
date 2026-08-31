import { useCallback, useMemo, type ReactNode } from 'react';
import { AdminPermissionsContext } from '../hooks/use-admin-permissions';
import { hasAnyAdminPermission, type AdminPermission } from '../utils/admin-permissions';

export function AdminPermissionsProvider({
    children,
    permissions,
}: {
    children: ReactNode;
    permissions: readonly AdminPermission[];
}) {
    const hasAnyPermission = useCallback(
        (required: readonly AdminPermission[]) => hasAnyAdminPermission(permissions, required),
        [permissions],
    );
    const value = useMemo(() => ({ permissions, hasAnyPermission }), [hasAnyPermission, permissions]);
    return <AdminPermissionsContext.Provider value={value}>{children}</AdminPermissionsContext.Provider>;
}
