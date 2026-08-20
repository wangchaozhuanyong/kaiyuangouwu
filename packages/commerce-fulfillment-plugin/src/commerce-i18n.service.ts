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
            'commerce-order-cancel-reason-required': 'Enter a cancellation reason',
            'commerce-order-cancel-reason-too-long': 'The cancellation reason cannot exceed 500 characters',
            'commerce-order-cancel-not-owned': 'The order does not exist or cannot be cancelled by this account',
            'commerce-order-cancel-not-authorized':
                'Only an unshipped order with an authorized, unsettled payment can be cancelled here',
            'commerce-order-cancel-digital-not-supported':
                'Orders containing digital products cannot be cancelled after delivery',
            'commerce-order-cancel-already-fulfilled': 'This order has entered fulfillment and cannot be cancelled here',
            'commerce-order-cancel-payment-settled':
                'This payment has been settled. Contact support to request a refund',
            'commerce-order-cancel-payment-not-cancellable':
                'No cancellable authorized payment was found for this order',
        },
    },
    zh_Hans: {
        message: {
            'commerce-physical-order-requires-complete-address':
                '订单包含实物商品，请填写完整收货地址、邮编和联系电话，并确认国家或地区与当前店铺一致',
            'commerce-physical-order-requires-shipping-method': '订单包含实物商品，请先选择配送方式',
            'commerce-physical-product-insufficient-stock':
                '实物商品“{ productVariantName }”库存不足，请调整购买数量',
            'commerce-order-cancel-reason-required': '请输入取消原因',
            'commerce-order-cancel-reason-too-long': '取消原因不能超过 500 个字符',
            'commerce-order-cancel-not-owned': '订单不存在，或当前账号无权取消该订单',
            'commerce-order-cancel-not-authorized': '这里只能取消未发货且尚未扣款的已授权订单',
            'commerce-order-cancel-digital-not-supported': '含数字商品的订单交付后不能直接取消',
            'commerce-order-cancel-already-fulfilled': '订单已进入履约流程，不能在这里取消',
            'commerce-order-cancel-payment-settled': '订单已经扣款，请联系客服申请退款',
            'commerce-order-cancel-payment-not-cancellable': '订单没有可撤销的已授权支付',
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
