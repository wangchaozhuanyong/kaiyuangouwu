import { configureDefaultOrderProcess, LanguageCode, PluginCommonModule, VendurePlugin } from '@vendure/core';

import { shopApiExtensions } from './api-extensions';
import { commerceOrderProcess } from './commerce-order-process';
import { CommerceShippingLineAssignmentStrategy } from './commerce-shipping-line-assignment-strategy';
import { digitalFulfillmentHandler } from './digital-fulfillment-handler';
import { FulfillmentModelService } from './fulfillment-model.service';
import { OrderFulfillmentResolver } from './order-fulfillment.resolver';
import { PhysicalOnlyStockAllocationStrategy } from './physical-only-stock-allocation-strategy';
import './types';

@VendurePlugin({
    imports: [PluginCommonModule],
    providers: [FulfillmentModelService],
    shopApiExtensions: {
        schema: shopApiExtensions,
        resolvers: [OrderFulfillmentResolver],
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
        config.shippingOptions.shippingLineAssignmentStrategy = new CommerceShippingLineAssignmentStrategy();
        config.orderOptions.stockAllocationStrategy = new PhysicalOnlyStockAllocationStrategy();

        config.orderOptions.process = [
            commerceOrderProcess,
            configureDefaultOrderProcess({
                arrangingPaymentRequiresShipping: false,
                arrangingPaymentRequiresStock: false,
            }),
        ];
        return config;
    },
    compatibility: '^3.0.0',
})
export class CommerceFulfillmentPlugin {}
