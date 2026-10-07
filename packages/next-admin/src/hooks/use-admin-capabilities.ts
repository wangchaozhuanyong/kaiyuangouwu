import { createContext, useContext } from 'react';
import {
    adminCapabilityAllows,
    adminCapabilityForPath,
    type AdminCapabilitySnapshot,
} from '../../../common/src/admin-capabilities';
import { getStandaloneAdminRedirect } from '../navigation/admin-navigation';

export const AdminCapabilitiesContext = createContext<AdminCapabilitySnapshot | null>(null);
export function useAdminCapabilities() {
    const snapshot = useContext(AdminCapabilitiesContext);
    const canUseCapability = (id: string, operation: 'read' | 'write' | 'configure' = 'read') =>
        adminCapabilityAllows(snapshot, id, operation);
    const canAccessPath = (path: string, operation: 'read' | 'write' | 'configure' = 'read') => {
        const canonical = getStandaloneAdminRedirect(path) ?? path;
        const definition = adminCapabilityForPath(canonical);
        return Boolean(definition && canUseCapability(definition.id, operation));
    };
    return { snapshot, canUseCapability, canAccessPath };
}
