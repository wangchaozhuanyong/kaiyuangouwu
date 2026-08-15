import { PluginCommonModule, VendurePlugin } from '@vendure/core';

import { adminApiExtensions, shopApiExtensions } from './api-extensions';
import { StoreProfile } from './entities/store-profile.entity';
import { StoreProfileAdminResolver, StoreProfileShopResolver } from './store-profile.resolver';
import { StoreProfileService } from './store-profile.service';
import { StoreProvisioningResolver } from './store-provisioning.resolver';
import { StoreProvisioningService } from './store-provisioning.service';

@VendurePlugin({
    imports: [PluginCommonModule],
    entities: [StoreProfile],
    providers: [StoreProfileService, StoreProvisioningService],
    adminApiExtensions: {
        schema: adminApiExtensions,
        resolvers: [StoreProvisioningResolver, StoreProfileAdminResolver],
    },
    shopApiExtensions: {
        schema: shopApiExtensions,
        resolvers: [StoreProfileShopResolver],
    },
    dashboard: '../src/dashboard/index.tsx',
    compatibility: '^3.7.0',
})
export class StoreManagementPlugin {}
