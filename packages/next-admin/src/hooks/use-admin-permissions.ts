import { createContext, useContext } from 'react';
import type { AdminPermission } from '../utils/admin-permissions';

export interface AdminPermissionsContextValue {
    permissions: readonly AdminPermission[];
    hasAnyPermission: (permissions: readonly AdminPermission[]) => boolean;
}

export const AdminPermissionsContext = createContext<AdminPermissionsContextValue>({
    permissions: [],
    hasAnyPermission: permissions => permissions.length === 0,
});

export function useAdminPermissions() {
    return useContext(AdminPermissionsContext);
}
