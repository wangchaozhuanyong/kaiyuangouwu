import type { VendureConfig } from '@vendure/core';
import { LanguageCode } from '@vendure/core';

// These existing public fields and validators mirror dev-server/dev-config.ts.
// The isolated Nest fixture needs the real object schema used by ShopApi fragments;
export const browserNativeCustomFields: NonNullable<VendureConfig['customFields']> = {
    Channel: [
        {
            name: 'storefrontNameZh',
            type: 'string',
            length: 32,
            nullable: false,
            defaultValue: '云桥Ai',
            public: true,
            validate: validateStorefrontName,
        },
        {
            name: 'storefrontNameEn',
            type: 'string',
            length: 32,
            nullable: false,
            defaultValue: 'Yunqiao Ai',
            public: true,
            validate: (value: string) => (value.trim() ? validateStorefrontName(value) : undefined),
        },
    ],
    Order: [
        {
            name: 'customerNote',
            type: 'text',
            nullable: true,
            public: true,
            validate: (value: string) =>
                value.length > 500
                    ? [
                          { languageCode: LanguageCode.zh_Hans, value: '订单备注不能超过 500 个字符' },
                          { languageCode: LanguageCode.en, value: 'Order note cannot exceed 500 characters' },
                      ]
                    : undefined,
        },
    ],
};

function validateStorefrontName(value: string) {
    const displayUnits = Array.from(value.trim()).reduce(
        (total, character) => total + (/[\p{Script=Han}\uFF01-\uFF60]/u.test(character) ? 2 : 1),
        0,
    );
    return displayUnits < 1 || displayUnits > 16
        ? [
              {
                  languageCode: LanguageCode.zh_Hans,
                  value: '网站名称须为 1 至 16 个显示单位（中文按 2 个计算）',
              },
              { languageCode: LanguageCode.en, value: 'Website name must use 1 to 16 display units' },
          ]
        : undefined;
}
