import { createContext, useCallback, useContext, useMemo } from 'react';
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
    const { permissions, hasAnyPermission: hasBasePermission } = useContext(AdminPermissionsContext);
    const snapshot = useContext(AdminCapabilitiesContext);
    const location = useContext(UNSAFE_LocationContext);
    const definition = location ? adminCapabilityForPath(location.location.pathname) : undefined;
    const capabilityId = definition?.id;
    const capabilityScope = definition?.scope;
    const hasAnyPermission = useCallback(
        (required: readonly AdminPermission[]) => {
            if (!snapshot || !capabilityId || capabilityScope === 'PERSONAL')
                return hasBasePermission(required);
            return (
                required.length === 0 ||
                required.some(permission => {
                    if (!hasBasePermission([permission])) return false;
                    const mutation = /^(Create|Update|Delete|Manage|Adjust)/u.test(permission);
                    return mutation
                        ? adminCapabilityAllows(snapshot, capabilityId, 'write') ||
                              adminCapabilityAllows(snapshot, capabilityId, 'configure')
                        : adminCapabilityAllows(snapshot, capabilityId);
                })
            );
        },
        [hasBasePermission, snapshot, capabilityId, capabilityScope],
    );
    // Dynamic extension documents depend on this callback. Stable permissions must
    // not rebuild their document/Observable on every query status render.
    return useMemo(() => ({ permissions, hasAnyPermission }), [permissions, hasAnyPermission]);
}
