import { APP_INTERCEPTOR } from '@nestjs/core';
import { PluginCommonModule, VendurePlugin } from '@vendure/core';

import { adminApiExtensions } from './api-extensions';
import { DashboardTwoFactorAccount } from './entities/dashboard-two-factor-account.entity';
import {
    AdminTwoFactorChallenge,
    AdminTwoFactorCredential,
    AdminTwoFactorRateLimit,
    AdminTwoFactorSession,
} from './login/admin-two-factor.entity';
import { AdminTwoFactorInterceptor } from './login/admin-two-factor.interceptor';
import { AdminTwoFactorResolver } from './login/admin-two-factor.resolver';
import { AdminTwoFactorService } from './login/admin-two-factor.service';
import { AdminTwoFactorNativeStrategy } from './login/admin-two-factor.strategy';
import { TwoFactorAccountResolver } from './two-factor-account.resolver';
import { TwoFactorAccountService } from './two-factor-account.service';
import { TwoFactorCipherService } from './two-factor-cipher.service';

@VendurePlugin({
    imports: [PluginCommonModule],
    entities: [
        DashboardTwoFactorAccount,
        AdminTwoFactorCredential,
        AdminTwoFactorChallenge,
        AdminTwoFactorSession,
        AdminTwoFactorRateLimit,
    ],
    providers: [
        TwoFactorAccountService,
        TwoFactorCipherService,
        AdminTwoFactorService,
        { provide: APP_INTERCEPTOR, useClass: AdminTwoFactorInterceptor },
    ],
    configuration: config => {
        config.authOptions.adminAuthenticationStrategy = (
            config.authOptions.adminAuthenticationStrategy ?? []
        )
            .filter(strategy => strategy.name !== 'native')
            .concat(new AdminTwoFactorNativeStrategy());
        return config;
    },
    adminApiExtensions: {
        schema: adminApiExtensions,
        resolvers: [TwoFactorAccountResolver, AdminTwoFactorResolver],
    },
    dashboard: '../src/dashboard/index.tsx',
    compatibility: '^3.7.0',
})
export class TwoFactorDashboardPlugin {}
