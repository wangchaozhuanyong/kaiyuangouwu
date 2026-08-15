import { APP_INTERCEPTOR } from '@nestjs/core';
import { PluginCommonModule, VendurePlugin } from '@vendure/core';

import { adminApiExtensions, shopApiExtensions } from './api-extensions';
import { storeProfilePermission } from './constants';
import { StoreAdministratorAccess } from './entities/store-administrator-access.entity';
import { StoreProfile } from './entities/store-profile.entity';
import { MerchantInitialPasswordInterceptor } from './merchant-initial-password.interceptor';
import { MerchantInitialPasswordResolver } from './merchant-initial-password.resolver';
import { MerchantInitialPasswordService } from './merchant-initial-password.service';
import { StoreProfileAdminResolver, StoreProfileShopResolver } from './store-profile.resolver';
import { StoreProfileService } from './store-profile.service';
import { StoreProvisioningResolver } from './store-provisioning.resolver';
import { StoreProvisioningService } from './store-provisioning.service';

@VendurePlugin({
    imports: [PluginCommonModule],
    entities: [StoreAdministratorAccess, StoreProfile],
    providers: [
        MerchantInitialPasswordService,
        StoreProfileService,
        StoreProvisioningService,
        {
            provide: APP_INTERCEPTOR,
            useClass: MerchantInitialPasswordInterceptor,
        },
    ],
    configuration: config => {
        config.authOptions.customPermissions.push(storeProfilePermission);
        return config;
    },
    adminApiExtensions: {
        schema: adminApiExtensions,
        resolvers: [MerchantInitialPasswordResolver, StoreProvisioningResolver, StoreProfileAdminResolver],
    },
    shopApiExtensions: {
        schema: shopApiExtensions,
        resolvers: [StoreProfileShopResolver],
    },
    dashboard: '../src/dashboard/index.tsx',
    compatibility: '^3.7.0',
})
export class StoreManagementPlugin {}
