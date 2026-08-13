import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { I18nService } from '@vendure/core';

const translations = {
    en: {
        message: {
            'commerce-physical-order-requires-complete-address':
                'This order contains physical products. Enter a complete shipping address, postcode and phone number for the active sales channel',
            'commerce-physical-order-requires-shipping-method':
                'This order contains physical products. Select a shipping method before payment',
            'commerce-physical-product-insufficient-stock':
                'Physical product "{ productVariantName }" does not have enough stock',
        },
    },
    zh_Hans: {
        message: {
            'commerce-physical-order-requires-complete-address':
                '订单包含实物商品，请填写完整收货地址、邮编和联系电话，并确认国家或地区与当前店铺一致',
            'commerce-physical-order-requires-shipping-method': '订单包含实物商品，请先选择配送方式',
            'commerce-physical-product-insufficient-stock':
                '实物商品“{ productVariantName }”库存不足，请调整购买数量',
        },
    },
} as const;

@Injectable()
export class CommerceI18nService implements OnApplicationBootstrap {
    constructor(private readonly i18nService: I18nService) {}

    onApplicationBootstrap(): void {
        for (const [languageCode, resources] of Object.entries(translations)) {
            this.i18nService.addTranslation(languageCode, resources);
        }
    }
}
