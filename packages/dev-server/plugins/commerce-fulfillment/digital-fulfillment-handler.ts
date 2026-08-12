import { FulfillmentHandler, LanguageCode } from '@vendure/core';

export const digitalFulfillmentHandler = new FulfillmentHandler({
    code: 'digital-fulfillment',
    description: [
        {
            languageCode: LanguageCode.zh_Hans,
            value: '记录虚拟商品已进入电子交付流程，不生成虚假的下载地址或兑换码',
        },
        {
            languageCode: LanguageCode.en,
            value: 'Records digital items for electronic delivery without generating placeholder links or keys',
        },
    ],
    args: {},
    createFulfillment: ctx => ({
        method: ctx.languageCode === LanguageCode.zh_Hans ? '电子交付' : 'Digital delivery',
        trackingCode: '',
    }),
});
