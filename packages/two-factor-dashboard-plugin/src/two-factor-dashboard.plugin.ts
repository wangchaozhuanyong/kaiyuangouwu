import { VendurePlugin } from '@vendure/core';

@VendurePlugin({
    dashboard: '../src/dashboard/index.tsx',
    compatibility: '^3.7.0',
})
export class TwoFactorDashboardPlugin {}
