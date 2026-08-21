import { CommerceFulfillment1786514145999 } from './1786514145999-commerce-fulfillment';
import { AddRegionalChannels1786514500000 } from './1786514500000-add-regional-channels';
import { LocalizeAndAssignShippingMethods1786514683000 } from './1786514683000-localize-and-assign-shipping-methods';
import { SeedRegionalChannelCatalog1786514968000 } from './1786514968000-seed-regional-channel-catalog';
import { AddMainlandChineseCatalogContent1786515300000 } from './1786515300000-add-mainland-chinese-catalog-content';
import { LocalizeOperationalData1786515600000 } from './1786515600000-localize-operational-data';
import { AddStoreDomains1786515900000 } from './1786515900000-add-store-domains';
import { LocalizeDefaultActors1786516200000 } from './1786516200000-localize-default-actors';
import { LocalizeDefaultRoles1786516500000 } from './1786516500000-localize-default-roles';
import { LocalizeDefaultStockLocation1786516800000 } from './1786516800000-localize-default-stock-location';
import { AddStorefrontCart1786517100000 } from './1786517100000-add-storefront-cart';
import { AlignStorefrontMysqlSchema1786517400000 } from './1786517400000-align-storefront-mysql-schema';
import { AddStorefrontNames1786517700000 } from './1786517700000-add-storefront-names';
import { RepairRegionalChannels1786760401000 } from './1786760401000-repair-regional-channels';
import { AddStorefrontContent1786762500000 } from './1786762500000-add-storefront-content';
import { AddCustomerOrderNote1786764000000 } from './1786764000000-add-customer-order-note';
import { AddStoreProfiles1786765800000 } from './1786765800000-add-store-profiles';
import { AddStoreAdministratorAccess1786767600000 } from './1786767600000-add-store-administrator-access';
import { HardenStoreAdministratorPermissions1786769400000 } from './1786769400000-harden-store-administrator-permissions';
import { EnableMainlandChineseLanguage1786771200000 } from './1786771200000-enable-mainland-chinese-language';
import { EnableSearchStockIndex1786773000000 } from './1786773000000-enable-search-stock-index';
import { AddAfterSalesCenter1787203000000 } from './1787203000000-add-after-sales-center';
import { AddStorefrontReviews1787204800000 } from './1787204800000-add-storefront-reviews';
import { AddOrderDeliveryEmail1787206600000 } from './1787206600000-add-order-delivery-email';
import { AlignSearchStockDefaults1787328000000 } from './1787328000000-align-search-stock-defaults';
import { NormalizeSearchStockMysqlColumns1787331600000 } from './1787331600000-normalize-search-stock-mysql-columns';

export const devServerMigrations = [
    CommerceFulfillment1786514145999,
    AddRegionalChannels1786514500000,
    LocalizeAndAssignShippingMethods1786514683000,
    SeedRegionalChannelCatalog1786514968000,
    AddMainlandChineseCatalogContent1786515300000,
    LocalizeOperationalData1786515600000,
    AddStoreDomains1786515900000,
    LocalizeDefaultActors1786516200000,
    LocalizeDefaultRoles1786516500000,
    LocalizeDefaultStockLocation1786516800000,
    AddStorefrontCart1786517100000,
    AlignStorefrontMysqlSchema1786517400000,
    AddStorefrontNames1786517700000,
    RepairRegionalChannels1786760401000,
    AddStorefrontContent1786762500000,
    AddCustomerOrderNote1786764000000,
    AddStoreProfiles1786765800000,
    AddStoreAdministratorAccess1786767600000,
    HardenStoreAdministratorPermissions1786769400000,
    EnableMainlandChineseLanguage1786771200000,
    EnableSearchStockIndex1786773000000,
    AddAfterSalesCenter1787203000000,
    AddStorefrontReviews1787204800000,
    AddOrderDeliveryEmail1787206600000,
    AlignSearchStockDefaults1787328000000,
    NormalizeSearchStockMysqlColumns1787331600000,
];
