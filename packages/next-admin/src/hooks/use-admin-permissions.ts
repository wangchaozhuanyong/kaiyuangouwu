import { createContext, useContext } from 'react';
import { UNSAFE_LocationContext } from 'react-router-dom';
import { adminCapabilityAllows, adminCapabilityForPath } from '../../../common/src/admin-capabilities';
import type { AdminPermission } from '../utils/admin-permissions';
import { AdminCapabilitiesContext } from './use-admin-capabilities';

export interface AdminPermissionsContextValue {
    permissions: readonly AdminPermission[];
    hasAnyPermission: (permissions: readonly AdminPermission[]) => boolean;
}

export const AdminPermissionsContext = createContext<AdminPermissionsContextValue>({
    permissions: [],
    hasAnyPermission: permissions => permissions.length === 0,
});

export function useAdminPermissions() {
    const permissions = useContext(AdminPermissionsContext);
    const snapshot = useContext(AdminCapabilitiesContext);
    const location = useContext(UNSAFE_LocationContext);
    const definition = location ? adminCapabilityForPath(location.location.pathname) : undefined;
    return {
        ...permissions,
        hasAnyPermission: (required: readonly AdminPermission[]) => {
            if (!snapshot || !definition || definition.scope === 'PERSONAL')
                return permissions.hasAnyPermission(required);
            return (
                required.length === 0 ||
                required.some(permission => {
                    if (!permissions.hasAnyPermission([permission])) return false;
                    const mutation = /^(Create|Update|Delete|Manage|Adjust)/u.test(permission);
                    return mutation
                        ? adminCapabilityAllows(snapshot, definition.id, 'write') ||
                              adminCapabilityAllows(snapshot, definition.id, 'configure')
                        : adminCapabilityAllows(snapshot, definition.id);
                })
            );
        },
    };
}
