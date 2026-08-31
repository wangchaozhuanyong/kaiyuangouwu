import { PluginCommonModule, VendurePlugin } from '@vendure/core';

import { adminApiExtensions } from './api-extensions';
import { DashboardTwoFactorAccount } from './entities/dashboard-two-factor-account.entity';
import { TwoFactorAccountResolver } from './two-factor-account.resolver';
import { TwoFactorAccountService } from './two-factor-account.service';
import { TwoFactorCipherService } from './two-factor-cipher.service';

@VendurePlugin({
    imports: [PluginCommonModule],
    entities: [DashboardTwoFactorAccount],
    providers: [TwoFactorAccountService, TwoFactorCipherService],
    adminApiExtensions: {
        schema: adminApiExtensions,
        resolvers: [TwoFactorAccountResolver],
    },
    dashboard: '../src/dashboard/index.tsx',
    compatibility: '^3.7.0',
})
export class TwoFactorDashboardPlugin {}
