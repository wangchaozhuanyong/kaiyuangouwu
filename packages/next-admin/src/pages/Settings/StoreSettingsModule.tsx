import { useQuery } from '@apollo/client/react';
import {
    ADMINISTRATOR_ACCESS_SCOPE_QUERY,
    type AdministratorAccessScopeResult,
} from '../../graphql/management.graphql';
import { useAdminPermissions } from '../../hooks/use-admin-permissions';
import { toUserFacingError } from '../../utils/user-facing-error';
import { MyStoreSettingsModule } from './MyStoreSettingsModule';
import { PlatformGovernanceCenter } from './PlatformGovernanceCenter';
import { PlatformGovernanceReviewCenter } from './PlatformGovernanceReviewCenter';
import { ErrorState, SettingsContentSkeleton } from './settings-ui';
export function StoreSettingsModule() {
    const { hasAnyPermission } = useAdminPermissions();
    const accessQuery = useQuery<AdministratorAccessScopeResult>(ADMINISTRATOR_ACCESS_SCOPE_QUERY, {
        fetchPolicy: 'cache-and-network',
    });
    if (!accessQuery.data && !accessQuery.error) {
        return <SettingsContentSkeleton label="正在识别管理账号范围" sections={2} />;
    }
    if (accessQuery.error || !accessQuery.data) {
        return (
            <ErrorState
                message={toUserFacingError(accessQuery.error, '无法识别当前管理账号范围')}
                onRetry={() => void accessQuery.refetch()}
            />
        );
    }
    if (accessQuery.data.myAdministratorAccess.scope === 'STORE') return <MyStoreSettingsModule />;
    if (hasAnyPermission(['ManageStoreLifecycle', 'SuperAdmin'])) {
        return (
            <PlatformGovernanceCenter
                allowPermanentDeprovision={accessQuery.data.myAdministratorAccess.authority === 'OWNER'}
            />
        );
    }
    if (hasAnyPermission(['ReviewStoreGovernance'])) return <PlatformGovernanceReviewCenter />;
    return <ErrorState message="当前平台岗位没有店铺治理权限" onRetry={() => void accessQuery.refetch()} />;
}
