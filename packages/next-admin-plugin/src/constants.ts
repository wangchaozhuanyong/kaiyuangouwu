import { RwPermissionDefinition } from '@vendure/core';

export const loggerCtx = 'NextAdminPlugin';
// Preserve the existing Admin API permission and stored settings contract.
export const manageDashboardGlobalViews = new RwPermissionDefinition('DashboardGlobalViews');
