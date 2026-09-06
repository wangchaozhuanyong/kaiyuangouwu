import { ContentTranslationPlugin } from '@vendure/content-translation-plugin';
import { configureDefaultOrderProcess, LanguageCode, PluginCommonModule, VendurePlugin } from '@vendure/core';
import { StorefrontCartPlugin } from '@vendure/storefront-cart-plugin';

import { AfterSalesAdminResolver, AfterSalesShopResolver } from './after-sales.resolver';
import { AfterSalesService } from './after-sales.service';
import { adminApiExtensions, shopApiExtensions } from './api-extensions';
import { AuthenticatedOrderByCodeAccessStrategy } from './authenticated-order-by-code-access-strategy';
import { AutoCardCipherService } from './auto-card-cipher.service';
import { AutoCardEmailResultService } from './auto-card-email-result.service';
import { autoCardFulfillmentHandler } from './auto-card-fulfillment-handler';
import { reconcileAutoCardDeliveriesTask } from './auto-card-tasks';
import { autoCardAdminResolvers, autoCardShopResolvers } from './auto-card.resolver';
import { AutoCardService } from './auto-card.service';
import { CartDeliveryCommandAdapter } from './cart-delivery-command.adapter';
import { CommerceI18nService } from './commerce-i18n.service';
import { CommerceModeAdminResolver, CommerceModeShopResolver } from './commerce-mode.resolver';
import { CommerceModeService } from './commerce-mode.service';
import { commerceOrderProcess } from './commerce-order-process';
import { commercePaymentProcess } from './commerce-payment-process';
import { CommerceShippingLineAssignmentStrategy } from './commerce-shipping-line-assignment-strategy';
import {
    physicalSubtotalShippingCalculator,
    supportedDestinationEligibilityChecker,
} from './commerce-shipping-options';
import { CustomerDeliveryEmailShopResolver } from './customer-delivery-email.resolver';
import { CustomerDeliveryEmailService } from './customer-delivery-email.service';
import { CustomerOrderCancellationService } from './customer-order-cancellation.service';
import { DigitalDeliveryTokenService } from './digital-delivery-token.service';
import { DigitalDeliveryController } from './digital-delivery.controller';
import { DigitalDeliveryService } from './digital-delivery.service';
import { digitalFulfillmentHandler } from './digital-fulfillment-handler';
import { AfterSalesEvent } from './entities/after-sales-event.entity';
import { AfterSalesItem } from './entities/after-sales-item.entity';
import { AfterSalesRequest } from './entities/after-sales-request.entity';
import { AutoCardConfig } from './entities/auto-card-config.entity';
import { AutoCardDeliveryEvent } from './entities/auto-card-delivery-event.entity';
import { AutoCardDelivery } from './entities/auto-card-delivery.entity';
import { AutoCardPoolItem } from './entities/auto-card-pool-item.entity';
import { CustomerDeliveryEmail } from './entities/customer-delivery-email.entity';
import { ManualDigitalDeliveryEvent } from './entities/manual-digital-delivery-event.entity';
import { ManualDigitalDelivery } from './entities/manual-digital-delivery.entity';
import { PackagingUnpackEvent } from './entities/packaging-unpack-event.entity';
import { ProductPackagingRule } from './entities/product-packaging-rule.entity';
import { FulfillmentModelService } from './fulfillment-model.service';
import { ManualDigitalDeliveryEmailResultService } from './manual-digital-delivery-email-result.service';
import { reconcileManualDigitalDeliveriesTask } from './manual-digital-delivery-tasks';
import {
    ManualDigitalDeliveryAdminResolver,
    ManualDigitalDeliveryOrderResolver,
} from './manual-digital-delivery.resolver';
import { ManualDigitalDeliveryService } from './manual-digital-delivery.service';
import { manualServiceFulfillmentHandler } from './manual-service-fulfillment-handler';
import { OrderConfirmationTokenService } from './order-confirmation-token.service';
import { OrderConfirmationResolver } from './order-confirmation.resolver';
import { CustomerOrderCancellationResolver, OrderFulfillmentResolver } from './order-fulfillment.resolver';
import { OrderOperationsAdminResolver } from './order-operations.resolver';
import { OrderOperationsService } from './order-operations.service';
import { PackagingStockLocationStrategy } from './packaging-stock-location-strategy';
import { PhysicalOnlyStockAllocationStrategy } from './physical-only-stock-allocation-strategy';
import { ProductPackagingAdminResolver, ProductPackagingProductResolver } from './product-packaging.resolver';
import { ProductPackagingService } from './product-packaging.service';
import './types';

@VendurePlugin({
    imports: [PluginCommonModule, ContentTranslationPlugin, StorefrontCartPlugin],
    entities: [
        AfterSalesRequest,
        AfterSalesItem,
        AfterSalesEvent,
        AutoCardConfig,
        AutoCardPoolItem,
        AutoCardDelivery,
        AutoCardDeliveryEvent,
        ProductPackagingRule,
        PackagingUnpackEvent,
        ManualDigitalDelivery,
        ManualDigitalDeliveryEvent,
        CustomerDeliveryEmail,
    ],
    controllers: [DigitalDeliveryController],
    providers: [
        CartDeliveryCommandAdapter,
        AfterSalesService,
        AutoCardCipherService,
        AutoCardService,
        AutoCardEmailResultService,
        FulfillmentModelService,
        CommerceI18nService,
        CommerceModeService,
        CustomerOrderCancellationService,
        DigitalDeliveryService,
        DigitalDeliveryTokenService,
        OrderConfirmationTokenService,
        OrderOperationsService,
        ProductPackagingService,
        ManualDigitalDeliveryService,
        ManualDigitalDeliveryEmailResultService,
        CustomerDeliveryEmailService,
    ],
    adminApiExtensions: {
        schema: adminApiExtensions,
        resolvers: [
            AfterSalesAdminResolver,
            OrderOperationsAdminResolver,
            ...autoCardAdminResolvers,
            CommerceModeAdminResolver,
            ProductPackagingAdminResolver,
            ProductPackagingProductResolver,
            ManualDigitalDeliveryAdminResolver,
            ManualDigitalDeliveryOrderResolver,
        ],
    },
    shopApiExtensions: {
        schema: shopApiExtensions,
        resolvers: [
            OrderFulfillmentResolver,
            OrderConfirmationResolver,
            CustomerOrderCancellationResolver,
            AfterSalesShopResolver,
            ...autoCardShopResolvers,
            CommerceModeShopResolver,
            ProductPackagingProductResolver,
            ManualDigitalDeliveryOrderResolver,
            CustomerDeliveryEmailShopResolver,
        ],
    },
    configuration: config => {
        config.customFields.Channel.push({
            name: 'commerceMode',
            type: 'string',
            defaultValue: 'DIGITAL_ONLY',
            public: false,
            label: [
                { languageCode: LanguageCode.zh_Hans, value: '店铺经营模式' },
                { languageCode: LanguageCode.en, value: 'Store commerce mode' },
            ],
            options: [
                {
                    value: 'DIGITAL_ONLY',
                    label: [
                        { languageCode: LanguageCode.zh_Hans, value: '仅虚拟商品' },
                        { languageCode: LanguageCode.en, value: 'Digital products only' },
                    ],
                },
                {
                    value: 'PHYSICAL_ONLY',
                    label: [
                        { languageCode: LanguageCode.zh_Hans, value: '仅实物商品' },
                        { languageCode: LanguageCode.en, value: 'Physical products only' },
                    ],
                },
                {
                    value: 'HYBRID',
                    label: [
                        { languageCode: LanguageCode.zh_Hans, value: '实物与虚拟混合经营' },
                        { languageCode: LanguageCode.en, value: 'Physical and digital' },
                    ],
                },
            ],
            ui: { dashboard: false },
        });
        config.customFields.Product.push({
            name: 'fulfillmentType',
            type: 'string',
            defaultValue: 'digital',
            public: true,
            label: [
                { languageCode: LanguageCode.zh_Hans, value: '商品类型' },
                { languageCode: LanguageCode.en, value: 'Product type' },
            ],
            options: [
                {
                    value: 'physical',
                    label: [
                        { languageCode: LanguageCode.zh_Hans, value: '实物商品' },
                        { languageCode: LanguageCode.en, value: 'Physical product' },
                    ],
                },
                {
                    value: 'digital',
                    label: [
                        { languageCode: LanguageCode.zh_Hans, value: '虚拟商品' },
                        { languageCode: LanguageCode.en, value: 'Digital product' },
                    ],
                },
            ],
            ui: { dashboard: false },
        });
        config.customFields.Product.push({
            name: 'refundPolicy',
            type: 'string',
            defaultValue: 'MERCHANT_REVIEW',
            public: true,
            label: [
                { languageCode: LanguageCode.zh_Hans, value: '退款政策' },
                { languageCode: LanguageCode.en, value: 'Refund policy' },
            ],
            options: [
                {
                    value: 'MERCHANT_REVIEW',
                    label: [
                        { languageCode: LanguageCode.zh_Hans, value: '可申请退款（商家审核）' },
                        { languageCode: LanguageCode.en, value: 'Refund request with merchant review' },
                    ],
                },
                {
                    value: 'SEVEN_DAY_NO_REASON',
                    label: [
                        { languageCode: LanguageCode.zh_Hans, value: '7 天无理由' },
                        { languageCode: LanguageCode.en, value: 'Seven-day no-reason return' },
                    ],
                },
                {
                    value: 'NON_REFUNDABLE',
                    label: [
                        { languageCode: LanguageCode.zh_Hans, value: '不支持退款' },
                        { languageCode: LanguageCode.en, value: 'Non-refundable' },
                    ],
                },
            ],
            ui: { dashboard: false },
        });
        config.customFields.Product.push({
            name: 'manualDeliverySlaMinutes',
            type: 'int',
            defaultValue: 1440,
            min: 5,
            max: 525600,
            public: true,
            label: [
                { languageCode: LanguageCode.zh_Hans, value: '人工交付预计时长（分钟）' },
                { languageCode: LanguageCode.en, value: 'Manual delivery SLA (minutes)' },
            ],
            ui: { dashboard: false },
        });
        config.customFields.ProductVariant.push({
            name: 'fulfillmentType',
            type: 'string',
            defaultValue: 'digital',
            public: true,
            readonly: true,
            ui: { dashboard: false },
            label: [
                { languageCode: LanguageCode.zh_Hans, value: '商品交付类型' },
                { languageCode: LanguageCode.en, value: 'Product fulfillment type' },
            ],
            description: [
                {
                    languageCode: LanguageCode.zh_Hans,
                    value: '实物商品需要收货地址、配送方式并占用库存；虚拟商品不要求收货地址和配送，付款后进入电子交付流程。改为虚拟商品会自动关闭库存跟踪。',
                },
                {
                    languageCode: LanguageCode.en,
                    value:
                        'Physical products require a shipping address, shipping method and stock. ' +
                        'Digital products skip address and shipping, then enter electronic delivery after payment. ' +
                        'Selecting digital disables inventory tracking.',
                },
            ],
            options: [
                {
                    value: 'physical',
                    label: [
                        { languageCode: LanguageCode.zh_Hans, value: '实物商品（需要配送）' },
                        { languageCode: LanguageCode.en, value: 'Physical product (shipping required)' },
                    ],
                },
                {
                    value: 'digital',
                    label: [
                        { languageCode: LanguageCode.zh_Hans, value: '虚拟商品（电子交付）' },
                        { languageCode: LanguageCode.en, value: 'Digital product (electronic delivery)' },
                    ],
                },
            ],
        });
        config.customFields.ProductVariant.push({
            name: 'digitalDeliveryMode',
            type: 'string',
            defaultValue: 'manual_service',
            public: true,
            ui: { dashboard: false },
            label: [
                { languageCode: LanguageCode.zh_Hans, value: '虚拟商品交付方式' },
                { languageCode: LanguageCode.en, value: 'Digital delivery mode' },
            ],
            description: [
                {
                    languageCode: LanguageCode.zh_Hans,
                    value: '人工数字服务由商家付款后处理；文件下载需要为 SKU 配置数字文件；自动发卡从号池按顺序取出卡密并发送到下单邮箱。',
                },
                {
                    languageCode: LanguageCode.en,
                    value:
                        'Manual digital services are processed by the merchant after payment. File downloads use ' +
                        'a configured SKU file. Auto-card delivery allocates credentials from the SKU pool in order ' +
                        'and sends them to the checkout email.',
                },
            ],
            options: [
                {
                    value: 'manual_service',
                    label: [
                        { languageCode: LanguageCode.zh_Hans, value: '人工数字服务' },
                        { languageCode: LanguageCode.en, value: 'Manual digital service' },
                    ],
                },
                {
                    value: 'file_download',
                    label: [
                        { languageCode: LanguageCode.zh_Hans, value: '文件下载' },
                        { languageCode: LanguageCode.en, value: 'File download' },
                    ],
                },
                {
                    value: 'auto_card',
                    label: [
                        { languageCode: LanguageCode.zh_Hans, value: '号池自动发卡' },
                        { languageCode: LanguageCode.en, value: 'Credential pool auto-delivery' },
                    ],
                },
            ],
        });
        config.customFields.ProductVariant.push({
            name: 'digitalStockPolicy',
            type: 'string',
            defaultValue: 'limited',
            public: true,
            ui: { dashboard: false },
            label: [
                { languageCode: LanguageCode.zh_Hans, value: '虚拟商品库存方式' },
                { languageCode: LanguageCode.en, value: 'Digital stock policy' },
            ],
            options: [
                {
                    value: 'pool_derived',
                    label: [
                        { languageCode: LanguageCode.zh_Hans, value: '按号池实时库存' },
                        { languageCode: LanguageCode.en, value: 'Derived from credential pool' },
                    ],
                },
                {
                    value: 'limited',
                    label: [
                        { languageCode: LanguageCode.zh_Hans, value: '手动限制库存' },
                        { languageCode: LanguageCode.en, value: 'Manually limited stock' },
                    ],
                },
                {
                    value: 'unlimited',
                    label: [
                        { languageCode: LanguageCode.zh_Hans, value: '无限库存' },
                        { languageCode: LanguageCode.en, value: 'Unlimited stock' },
                    ],
                },
            ],
        });
        config.customFields.OrderLine.push({
            name: 'fulfillmentTypeSnapshot',
            type: 'string',
            defaultValue: 'physical',
            public: true,
            readonly: true,
            ui: { dashboard: false },
        });
        config.customFields.OrderLine.push({
            name: 'digitalDeliveryModeSnapshot',
            type: 'string',
            defaultValue: 'manual_service',
            public: true,
            readonly: true,
            ui: { dashboard: false },
        });
        config.customFields.OrderLine.push({
            name: 'refundPolicySnapshot',
            type: 'string',
            defaultValue: 'MERCHANT_REVIEW',
            public: true,
            readonly: true,
            ui: { dashboard: false },
        });
        config.customFields.OrderLine.push({
            name: 'manualDeliverySlaMinutesSnapshot',
            type: 'int',
            defaultValue: 1440,
            public: true,
            readonly: true,
            ui: { dashboard: false },
        });

        config.shippingOptions.fulfillmentHandlers.push(digitalFulfillmentHandler);
        config.shippingOptions.fulfillmentHandlers.push(autoCardFulfillmentHandler);
        config.shippingOptions.fulfillmentHandlers.push(manualServiceFulfillmentHandler);
        config.shippingOptions.shippingCalculators.push(physicalSubtotalShippingCalculator);
        config.shippingOptions.shippingEligibilityCheckers.push(supportedDestinationEligibilityChecker);
        config.shippingOptions.shippingLineAssignmentStrategy = new CommerceShippingLineAssignmentStrategy();
        config.orderOptions.stockAllocationStrategy = new PhysicalOnlyStockAllocationStrategy();
        config.catalogOptions.stockLocationStrategy = new PackagingStockLocationStrategy();
        config.orderOptions.orderByCodeAccessStrategy = new AuthenticatedOrderByCodeAccessStrategy();
        config.orderOptions.process = [
            commerceOrderProcess,
            configureDefaultOrderProcess({
                arrangingPaymentRequiresShipping: false,
                arrangingPaymentRequiresStock: false,
            }),
        ];
        config.paymentOptions.process = [...(config.paymentOptions.process ?? []), commercePaymentProcess];
        config.schedulerOptions.tasks.push(reconcileAutoCardDeliveriesTask);
        config.schedulerOptions.tasks.push(reconcileManualDigitalDeliveriesTask);
        return config;
    },
    compatibility: '^3.7.0',
})
export class CommerceFulfillmentPlugin {}
