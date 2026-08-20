import { APP_INTERCEPTOR } from '@nestjs/core';
import { PluginCommonModule, VendurePlugin } from '@vendure/core';

import { adminApiExtensions } from './api-extensions';
import { storeProfilePermission } from './constants';
import { StoreAdministratorAccess } from './entities/store-administrator-access.entity';
import { StoreProfile } from './entities/store-profile.entity';
import { MerchantCatalogAccessInterceptor } from './merchant-catalog-access.interceptor';
import { MerchantCatalogAccessService } from './merchant-catalog-access.service';
import { MerchantInitialPasswordInterceptor } from './merchant-initial-password.interceptor';
import { MerchantInitialPasswordResolver } from './merchant-initial-password.resolver';
import { MerchantInitialPasswordService } from './merchant-initial-password.service';
import { StoreCommerceSettingsResolver } from './store-commerce-settings.resolver';
import { StoreCommerceSettingsService } from './store-commerce-settings.service';
import { StoreProfileAdminResolver } from './store-profile.resolver';
import { StoreProfileService } from './store-profile.service';
import { StoreProvisioningResolver } from './store-provisioning.resolver';
import { StoreProvisioningService } from './store-provisioning.service';

@VendurePlugin({
    imports: [PluginCommonModule],
    entities: [StoreAdministratorAccess, StoreProfile],
    providers: [
        MerchantCatalogAccessService,
        MerchantInitialPasswordService,
        StoreProfileService,
        StoreCommerceSettingsService,
        StoreProvisioningService,
        {
            provide: APP_INTERCEPTOR,
            useClass: MerchantInitialPasswordInterceptor,
        },
        {
            provide: APP_INTERCEPTOR,
            useClass: MerchantCatalogAccessInterceptor,
        },
    ],
    configuration: config => {
        config.authOptions.customPermissions.push(storeProfilePermission);
        return config;
    },
    adminApiExtensions: {
        schema: adminApiExtensions,
        resolvers: [
            MerchantInitialPasswordResolver,
            StoreProvisioningResolver,
            StoreProfileAdminResolver,
            StoreCommerceSettingsResolver,
        ],
    },
    dashboard: '../src/dashboard/index.tsx',
    compatibility: '^3.7.0',
})
export class StoreManagementPlugin {}
