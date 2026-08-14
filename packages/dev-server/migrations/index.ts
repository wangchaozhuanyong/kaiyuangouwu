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
];
