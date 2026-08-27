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
import { AddStorefrontContentSettings1787335200000 } from './1787335200000-add-storefront-content-settings';
import { AddStorefrontPromotionPages1787338800000 } from './1787338800000-add-storefront-promotion-pages';
import { AddStoreProfileNotesAndTemplates1787500800000 } from './1787500800000-add-store-profile-notes-and-templates';
import { UpgradeStorefrontContentEditor1787551200000 } from './1787551200000-upgrade-storefront-content-editor';
import { AddSystemAnnouncements1787554800000 } from './1787554800000-add-system-announcements';
import { AddAutoCardDelivery1787594400000 } from './1787594400000-add-auto-card-delivery';
import { AlignAutoCardDeliverySchema1787598000000 } from './1787598000000-align-auto-card-delivery-schema';
import { BackfillMissingStoreProfiles1787605200000 } from './1787605200000-backfill-missing-store-profiles';
import { AddAutoCardBilingualInstructions1787608800000 } from './1787608800000-add-auto-card-bilingual-instructions';
import { CompleteBilingualServiceCatalog1787612400000 } from './1787612400000-complete-bilingual-service-catalog';
import { AddManualDigitalServiceMode1787616000000 } from './1787616000000-add-manual-digital-service-mode';
import { RestrictContentLanguages1787662800000 } from './1787662800000-restrict-content-languages';
import { AddContentTranslationState1787666400000 } from './1787666400000-add-content-translation-state';
import { LocalizeCustomerServiceContent1787670000000 } from './1787670000000-localize-customer-service-content';
import { AddCouponLifecycle1787677200000 } from './1787677200000-add-coupon-lifecycle';
import { AlignAfterSalesAutoCardSchema1787680800000 } from './1787680800000-align-after-sales-auto-card-schema';
import { AlignProductionMysqlSchema1787682600000 } from './1787682600000-align-production-mysql-schema';
import { SeedSimplifiedChineseSourceTranslations1787684400000 } from './1787684400000-seed-simplified-chinese-source-translations';
import { AddStorefrontMultiCurrency1787763600000 } from './1787763600000-add-storefront-multi-currency';
import { AlignStorefrontMultiCurrency1787767200000 } from './1787767200000-align-storefront-multi-currency';
import { NormalizeStorefrontExchangeRate1787770800000 } from './1787770800000-normalize-storefront-exchange-rate';
import { AddReferralRebate1787774400000 } from './1787774400000-add-referral-rebate';
import { AddStorefrontUsdtDisplay1787778000000 } from './1787778000000-add-storefront-usdt-display';
import { AddUsdtTrc20Payments1787781600000 } from './1787781600000-add-usdt-trc20-payments';
import { AlignUsdtTrc20Schema1787785200000 } from './1787785200000-align-usdt-trc20-schema';
import { AddUsdtRateSchedule1787788800000 } from './1787788800000-add-usdt-rate-schedule';

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
    AddStorefrontContentSettings1787335200000,
    AddStorefrontPromotionPages1787338800000,
    AddStoreProfileNotesAndTemplates1787500800000,
    UpgradeStorefrontContentEditor1787551200000,
    AddSystemAnnouncements1787554800000,
    AddAutoCardDelivery1787594400000,
    AlignAutoCardDeliverySchema1787598000000,
    BackfillMissingStoreProfiles1787605200000,
    AddAutoCardBilingualInstructions1787608800000,
    CompleteBilingualServiceCatalog1787612400000,
    AddManualDigitalServiceMode1787616000000,
    RestrictContentLanguages1787662800000,
    AddContentTranslationState1787666400000,
    LocalizeCustomerServiceContent1787670000000,
    AddCouponLifecycle1787677200000,
    AlignAfterSalesAutoCardSchema1787680800000,
    AlignProductionMysqlSchema1787682600000,
    SeedSimplifiedChineseSourceTranslations1787684400000,
    AddStorefrontMultiCurrency1787763600000,
    AlignStorefrontMultiCurrency1787767200000,
    NormalizeStorefrontExchangeRate1787770800000,
    AddReferralRebate1787774400000,
    AddStorefrontUsdtDisplay1787778000000,
    AddUsdtTrc20Payments1787781600000,
    AlignUsdtTrc20Schema1787785200000,
    AddUsdtRateSchedule1787788800000,
];
