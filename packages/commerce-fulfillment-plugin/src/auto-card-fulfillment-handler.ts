import { FulfillmentHandler, LanguageCode } from '@vendure/core';

export const autoCardFulfillmentHandler = new FulfillmentHandler({
    code: 'auto-card-fulfillment',
    description: [
        {
            languageCode: LanguageCode.zh_Hans,
            value: '记录号池卡密已分配并成功发送到订单交付邮箱',
        },
        {
            languageCode: LanguageCode.en,
            value: 'Records credentials allocated from a pool and sent to the order delivery email',
        },
    ],
    args: {},
    createFulfillment: () => ({
        method: 'auto-card-email',
        trackingCode: '',
    }),
});
