import { LanguageCode } from '@vendure/common/lib/generated-types';

import { FulfillmentHandler } from './fulfillment-handler';

export const manualFulfillmentHandler = new FulfillmentHandler({
    code: 'manual-fulfillment',
    description: [
        { languageCode: LanguageCode.en, value: 'Enter shipping and tracking details manually' },
        { languageCode: LanguageCode.zh_Hans, value: '手动填写发货与物流信息' },
    ],
    args: {
        method: {
            type: 'string',
            required: false,
            label: [
                { languageCode: LanguageCode.en, value: 'Shipping method' },
                { languageCode: LanguageCode.zh_Hans, value: '配送方式' },
            ],
            description: [
                { languageCode: LanguageCode.en, value: 'Name of the carrier or delivery method used.' },
                { languageCode: LanguageCode.zh_Hans, value: '填写实际使用的承运商或配送方式。' },
            ],
        },
        trackingCode: {
            type: 'string',
            required: false,
            label: [
                { languageCode: LanguageCode.en, value: 'Tracking number' },
                { languageCode: LanguageCode.zh_Hans, value: '物流单号' },
            ],
            description: [
                { languageCode: LanguageCode.en, value: 'Tracking number provided by the carrier.' },
                { languageCode: LanguageCode.zh_Hans, value: '填写承运商提供的物流查询单号。' },
            ],
        },
    },
    createFulfillment: (ctx, orders, orderItems, args) => {
        return {
            method: args.method,
            trackingCode: args.trackingCode,
        };
    },
});
