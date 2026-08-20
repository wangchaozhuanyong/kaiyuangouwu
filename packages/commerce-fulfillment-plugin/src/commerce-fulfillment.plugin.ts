import { configureDefaultOrderProcess, LanguageCode, PluginCommonModule, VendurePlugin } from '@vendure/core';

import { AfterSalesAdminResolver, AfterSalesShopResolver } from './after-sales.resolver';
import { AfterSalesService } from './after-sales.service';
import { adminApiExtensions, shopApiExtensions } from './api-extensions';
import { AuthenticatedOrderByCodeAccessStrategy } from './authenticated-order-by-code-access-strategy';
import { CommerceI18nService } from './commerce-i18n.service';
import { commerceOrderProcess } from './commerce-order-process';
import { commercePaymentProcess } from './commerce-payment-process';
import { CommerceShippingLineAssignmentStrategy } from './commerce-shipping-line-assignment-strategy';
import {
    physicalSubtotalShippingCalculator,
    supportedDestinationEligibilityChecker,
} from './commerce-shipping-options';
import { CustomerOrderCancellationService } from './customer-order-cancellation.service';
import { DigitalDeliveryTokenService } from './digital-delivery-token.service';
import { DigitalDeliveryController } from './digital-delivery.controller';
import { DigitalDeliveryService } from './digital-delivery.service';
import { digitalFulfillmentHandler } from './digital-fulfillment-handler';
import { AfterSalesEvent } from './entities/after-sales-event.entity';
import { AfterSalesItem } from './entities/after-sales-item.entity';
import { AfterSalesRequest } from './entities/after-sales-request.entity';
import { FulfillmentModelService } from './fulfillment-model.service';
import { OrderConfirmationTokenService } from './order-confirmation-token.service';
import { OrderConfirmationResolver } from './order-confirmation.resolver';
import { CustomerOrderCancellationResolver, OrderFulfillmentResolver } from './order-fulfillment.resolver';
import { OrderOperationsAdminResolver } from './order-operations.resolver';
import { OrderOperationsService } from './order-operations.service';
import { PhysicalOnlyStockAllocationStrategy } from './physical-only-stock-allocation-strategy';
import './types';

@VendurePlugin({
    imports: [PluginCommonModule],
    entities: [AfterSalesRequest, AfterSalesItem, AfterSalesEvent],
    controllers: [DigitalDeliveryController],
    providers: [
        AfterSalesService,
        FulfillmentModelService,
        CommerceI18nService,
        CustomerOrderCancellationService,
        DigitalDeliveryService,
        DigitalDeliveryTokenService,
        OrderConfirmationTokenService,
        OrderOperationsService,
    ],
    adminApiExtensions: {
        schema: adminApiExtensions,
        resolvers: [AfterSalesAdminResolver, OrderOperationsAdminResolver],
    },
    shopApiExtensions: {
        schema: shopApiExtensions,
        resolvers: [
            OrderFulfillmentResolver,
            OrderConfirmationResolver,
            CustomerOrderCancellationResolver,
            AfterSalesShopResolver,
        ],
    },
    configuration: config => {
        config.customFields.ProductVariant.push({
            name: 'fulfillmentType',
            type: 'string',
            defaultValue: 'physical',
            public: true,
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
        config.customFields.OrderLine.push({
            name: 'fulfillmentTypeSnapshot',
            type: 'string',
            defaultValue: 'physical',
            public: true,
            readonly: true,
            ui: { dashboard: false },
        });

        config.shippingOptions.fulfillmentHandlers.push(digitalFulfillmentHandler);
        config.shippingOptions.shippingCalculators.push(physicalSubtotalShippingCalculator);
        config.shippingOptions.shippingEligibilityCheckers.push(supportedDestinationEligibilityChecker);
        config.shippingOptions.shippingLineAssignmentStrategy = new CommerceShippingLineAssignmentStrategy();
        config.orderOptions.stockAllocationStrategy = new PhysicalOnlyStockAllocationStrategy();
        config.orderOptions.orderByCodeAccessStrategy = new AuthenticatedOrderByCodeAccessStrategy();
        config.orderOptions.process = [
            commerceOrderProcess,
            configureDefaultOrderProcess({
                arrangingPaymentRequiresShipping: false,
                arrangingPaymentRequiresStock: false,
            }),
        ];
        config.paymentOptions.process = [...(config.paymentOptions.process ?? []), commercePaymentProcess];
        return config;
    },
    compatibility: '^3.7.0',
})
export class CommerceFulfillmentPlugin {}
