import { FulfillmentHandler, LanguageCode } from '@vendure/core';

export const manualServiceFulfillmentHandler = new FulfillmentHandler({
    code: 'manual-service-fulfillment',
    description: [
        {
            languageCode: LanguageCode.zh_Hans,
            value: '人工数字服务处理完成后使用，不生成物流单号、下载地址或卡密',
        },
        {
            languageCode: LanguageCode.en,
            value: 'Use when a manually processed digital service is complete; no tracking, file or credential is generated',
        },
    ],
    args: {},
    createFulfillment: () => ({
        method: 'manual-digital-service',
        trackingCode: '',
    }),
});
